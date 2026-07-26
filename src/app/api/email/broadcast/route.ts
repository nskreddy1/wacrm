import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendEmail, loadAccountEmailSettings } from '@/lib/email/mailer';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { logAuditEvent } from '@/lib/audit-events';
import { checkMonthlyQuota, consumeMonthlyQuota } from '@/lib/quotas';
import { quotaExceededResponse } from '@/lib/quotas/response';

interface EmailBroadcastRecipient {
  email: string;
  /** Fully rendered subject — variables resolved client-side. */
  subject: string;
  /** Fully rendered body — variables resolved client-side. */
  body: string;
}

interface EmailBroadcastResult {
  email: string;
  status: 'sent' | 'failed';
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Minimal HTML wrapper: preserve line breaks, nothing else. */
function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escaped}</div>`;
}

/**
 * Email broadcast fan-out — counterpart of /api/sms/broadcast.
 *
 * Accepts pre-rendered per-recipient subject/body pairs and sends
 * each through the workspace email layer (tenant provider first,
 * then platform Resend → Mailtrap fallback).
 *
 * Compliance: content rules (unsubscribe link for marketing email —
 * CAN-SPAM, CASL, India DPDP) are validated at template-save time;
 * this route enforces transport-level rules: valid addresses, the
 * per-user campaign rate budget, and skipping contacts that
 * unsubscribed (email_opted_out).
 *
 * GET reports availability so the wizard knows whether to offer the
 * email channel at all.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json({ available: false });
    }

    const settings = await loadAccountEmailSettings(supabase, accountId);
    const available = Boolean(
      settings ||
        process.env.RESEND_API_KEY ||
        process.env.MAILTRAP_API_TOKEN
    );
    return NextResponse.json({ available });
  } catch {
    return NextResponse.json({ available: false });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Same per-user campaign budget as WhatsApp/SMS broadcasts.
    const limit = await checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const recipients: EmailBroadcastRecipient[] = Array.isArray(
      body?.recipients
    )
      ? body.recipients
      : [];
    if (recipients.length === 0) {
      return NextResponse.json(
        {
          error:
            '`recipients` must be a non-empty array of { email, subject, body }',
        },
        { status: 400 }
      );
    }
    if (
      recipients.some(
        (r) =>
          typeof r.subject !== 'string' ||
          !r.subject.trim() ||
          typeof r.body !== 'string' ||
          !r.body.trim()
      )
    ) {
      return NextResponse.json(
        { error: 'Every recipient needs a non-empty subject and body' },
        { status: 400 }
      );
    }

    // Plan quota: monthly broadcast-recipient budget, checked for the
    // WHOLE batch before any send so a campaign never half-delivers
    // on a quota boundary. Consumed after the loop by actual sends.
    const quota = await checkMonthlyQuota(
      accountId,
      'broadcast_recipients',
      recipients.length
    );
    if (!quota.allowed) {
      return quotaExceededResponse(quota, 'Monthly broadcast recipient');
    }

    // Opt-out compliance: skip contacts that unsubscribed from
    // marketing email (CAN-SPAM / CASL / India DPDP).
    const addresses = recipients
      .map((r) => r.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e && EMAIL_RE.test(e)));
    const { data: optedOutRows } = await supabase
      .from('contacts')
      .select('email')
      .eq('account_id', accountId)
      .eq('email_opted_out', true)
      .in('email', addresses);
    const optedOut = new Set(
      (optedOutRows ?? []).map((row) => (row.email as string).toLowerCase())
    );

    const results: EmailBroadcastResult[] = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      const email = recipient.email?.trim().toLowerCase() ?? '';
      if (!EMAIL_RE.test(email)) {
        results.push({
          email: recipient.email ?? '',
          status: 'failed',
          error: 'Invalid email address',
        });
        failedCount++;
        continue;
      }
      if (optedOut.has(email)) {
        results.push({
          email: recipient.email,
          status: 'failed',
          error: 'Recipient unsubscribed from email',
        });
        failedCount++;
        continue;
      }

      const result = await sendEmail(supabase, accountId, {
        to: email,
        subject: recipient.subject,
        html: toHtml(recipient.body),
        text: recipient.body,
      });
      if (result.sent) {
        results.push({ email: recipient.email, status: 'sent' });
        sentCount++;
      } else {
        results.push({
          email: recipient.email,
          status: 'failed',
          error: result.error ?? 'Send failed',
        });
        failedCount++;
      }
    }

    // Meter actual deliveries only (fire-and-forget — metering loss
    // must never fail a delivered campaign).
    if (sentCount > 0) {
      void consumeMonthlyQuota(accountId, 'broadcast_recipients', sentCount);
    }

    // Audit: counts only — no message bodies or addresses.
    await logAuditEvent(supabase, {
      accountId,
      actorId: user.id,
      action: 'broadcast.sent',
      entity: 'email:broadcast',
      meta: {
        channel: 'email',
        total: recipients.length,
        sent: sentCount,
        failed: failedCount,
      },
    });

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    });
  } catch (error) {
    console.error('Error in email broadcast POST:', error);
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    );
  }
}

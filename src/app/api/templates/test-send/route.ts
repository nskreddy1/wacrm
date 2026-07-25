import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import { withSampleValues } from '@/features/templates/lib/studio-types';
import { sendEmail } from '@/lib/email/mailer';

/**
 * POST /api/templates/test-send
 *
 * End-to-end test delivery for EMAIL templates: loads the saved
 * template (RLS-scoped to the caller's account), fills variables
 * with sample values, wraps the plain-text body in a minimal HTML
 * shell, and sends it through the workspace email layer (tenant
 * SMTP/Resend/MSG91 first, platform Resend fallback).
 *
 * Compliance guardrails:
 * - Test sends go to ONE explicit address typed by the operator —
 *   never to contact lists (no unsolicited bulk risk).
 * - The subject is prefixed with [Test] so a stray forward is never
 *   mistaken for a real campaign.
 * - Marketing-tier templates (newsletter/promotional) must contain
 *   unsubscribe language before a test can be sent, mirroring the
 *   save-time compliance audit (CAN-SPAM s.5, India DPDP consent
 *   norms, GDPR ePrivacy).
 */

const bodySchema = z.object({
  templateId: z.string().uuid(),
  to: z.string().trim().email().max(320),
});

/** Minimal HTML escape for the plain-text template body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toHtmlShell(bodyText: string): string {
  const paragraphs = escapeHtml(bodyText)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;line-height:1.6;">${p.replace(/\n/g, '<br />')}</p>`
    )
    .join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:14px;"><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">${paragraphs}</div></body></html>`;
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent');

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Provide a valid templateId and recipient email.' },
        { status: 400 }
      );
    }
    const { templateId, to } = parsed.data;

    // RLS also scopes this, but filter explicitly for defense in depth.
    const { data: tpl, error } = await supabase
      .from('message_templates')
      .select('id, channel, category, subject_text, body_text, sample_values')
      .eq('id', templateId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (error || !tpl) {
      return NextResponse.json(
        { error: 'Template not found. Save it before sending a test.' },
        { status: 404 }
      );
    }
    if (tpl.channel !== 'email') {
      return NextResponse.json(
        { error: 'Test sends are only available for email templates.' },
        { status: 400 }
      );
    }

    // Marketing email must carry opt-out language even in tests —
    // same rule the save-time compliance audit enforces.
    const marketingTier =
      tpl.category === 'newsletter' || tpl.category === 'promotional';
    if (marketingTier && !/unsub|opt[ -]?out/i.test(tpl.body_text)) {
      return NextResponse.json(
        {
          error:
            'Add an unsubscribe link to this marketing template before test-sending (CAN-SPAM / DPDP requirement).',
        },
        { status: 422 }
      );
    }

    const subject = `[Test] ${withSampleValues(tpl.subject_text ?? 'No subject')}`;
    const bodyText = withSampleValues(tpl.body_text);

    const result = await sendEmail(supabase, accountId, {
      to,
      subject,
      html: toHtmlShell(bodyText),
      text: bodyText,
    });

    if (!result.sent) {
      return NextResponse.json(
        {
          error:
            result.error === 'no email provider configured'
              ? 'No email provider is configured. Add one in Settings → Channels, or contact your admin.'
              : `Send failed: ${result.error ?? 'unknown error'}`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ sent: true, provider: result.provider });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import {
  encryptEmailCredentials,
  loadAccountEmailSettings,
  sendWithSettings,
  type AccountEmailSettings,
  type EmailCredentials,
  type EmailProvider,
} from '@/lib/email/mailer';
import { logAuditEvent } from '@/lib/audit-events';

export const runtime = 'nodejs';

const PROVIDERS: EmailProvider[] = ['smtp', 'resend', 'msg91'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and normalize the credentials payload for a provider.
 * Returns null when the shape is invalid. Secrets are never echoed
 * back in errors.
 */
function parseCredentials(
  provider: EmailProvider,
  raw: unknown
): EmailCredentials | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (provider) {
    case 'smtp': {
      const host = String(c.host ?? '').trim();
      const port = Number(c.port ?? 0);
      const username = String(c.username ?? '').trim();
      const password = String(c.password ?? '');
      if (!host || !username || !password) return null;
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      return { host, port, secure: Boolean(c.secure), username, password };
    }
    case 'resend': {
      const apiKey = String(c.apiKey ?? '').trim();
      return apiKey ? { apiKey } : null;
    }
    case 'msg91': {
      const authKey = String(c.authKey ?? '').trim();
      const domain = String(c.domain ?? '').trim();
      return authKey && domain ? { authKey, domain } : null;
    }
    default:
      return null;
  }
}

/** Public (non-secret) view of the stored settings. */
function toClientSettings(s: AccountEmailSettings | null) {
  if (!s) return null;
  return {
    provider: s.provider,
    fromEmail: s.fromEmail,
    fromName: s.fromName,
    // Marker only — credentials never leave the server.
    credentialsSaved: true,
  };
}

// GET — current settings (secrets redacted)
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const settings = await loadAccountEmailSettings(supabase, accountId);
    return NextResponse.json({ settings: toClientSettings(settings) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PUT — create/replace settings; body may include test: true to
// send a verification email before saving.
export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const body = (await request.json()) as {
      provider?: string;
      fromEmail?: string;
      fromName?: string;
      credentials?: unknown;
      /** When set, send a test email to this address before saving. */
      testTo?: string;
    };

    const provider = String(body.provider ?? '') as EmailProvider;
    if (!PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
    }
    const fromEmail = String(body.fromEmail ?? '').trim();
    if (!EMAIL_RE.test(fromEmail)) {
      return NextResponse.json(
        { error: 'A valid from address is required' },
        { status: 400 }
      );
    }
    const fromName = String(body.fromName ?? '').trim() || null;
    const credentials = parseCredentials(provider, body.credentials);
    if (!credentials) {
      return NextResponse.json(
        { error: 'Incomplete credentials for the selected provider' },
        { status: 400 }
      );
    }

    const candidate: AccountEmailSettings = {
      provider,
      fromEmail,
      fromName,
      credentials,
    };

    // Optional pre-save verification: prove the credentials work by
    // sending a real email. Saves only on success.
    if (body.testTo) {
      const testTo = String(body.testTo).trim();
      if (!EMAIL_RE.test(testTo)) {
        return NextResponse.json(
          { error: 'Invalid test recipient' },
          { status: 400 }
        );
      }
      const test = await sendWithSettings(candidate, {
        to: testTo,
        subject: 'Email delivery test',
        html: '<p>Your workspace email delivery is configured correctly.</p>',
        text: 'Your workspace email delivery is configured correctly.',
      });
      if (!test.sent) {
        return NextResponse.json(
          { error: `Test send failed: ${test.error ?? 'unknown error'}` },
          { status: 422 }
        );
      }
    }

    const { error } = await supabase.from('account_email_settings').upsert(
      {
        account_id: accountId,
        provider,
        from_email: fromEmail,
        from_name: fromName,
        credentials_encrypted: encryptEmailCredentials(credentials),
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    );
    if (error) {
      console.error('[email-settings PUT] upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to save settings' },
        { status: 500 }
      );
    }

    // Audit: record the config change — provider + from only, never
    // credentials.
    await logAuditEvent(supabase, {
      accountId,
      actorId: userId,
      action: 'email_settings.updated',
      entity: 'email_settings',
      meta: { provider, from_email: fromEmail, tested: Boolean(body.testTo) },
    });

    return NextResponse.json({
      settings: toClientSettings(candidate),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE — remove workspace email settings (fall back to platform).
export async function DELETE() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const { error } = await supabase
      .from('account_email_settings')
      .delete()
      .eq('account_id', accountId);
    if (error) {
      console.error('[email-settings DELETE] error:', error);
      return NextResponse.json(
        { error: 'Failed to remove settings' },
        { status: 500 }
      );
    }
    await logAuditEvent(supabase, {
      accountId,
      actorId: userId,
      action: 'email_settings.removed',
      entity: 'email_settings',
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

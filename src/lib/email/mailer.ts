// ============================================================
// Generic email delivery layer (provider-agnostic).
//
// Any feature that needs to send email calls sendEmail() — it
// never talks to a provider directly. Resolution order:
//
//   1. Workspace settings (account_email_settings row): the
//      tenant's own provider — SMTP, Resend, or MSG91.
//   2. Platform fallback: RESEND_API_KEY env (v0/ops-level).
//
// Adding a provider = add one adapter function + a case in
// sendWithSettings(). Credentials are stored as an AES-256-GCM
// encrypted JSON blob, so new providers need no schema change.
// This mirrors the SMS layer's goal: never lock into one vendor
// (Twilio/MSG91/Gupshup for SMS; SMTP/Resend/MSG91 for email).
// ============================================================

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from '@/features/whatsapp/lib/encryption';

export type EmailProvider = 'smtp' | 'resend' | 'msg91' | 'mailtrap';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text alternative. */
  text?: string;
}

export interface EmailSendResult {
  sent: boolean;
  /** Which adapter actually handled the send. */
  provider: EmailProvider | 'platform_resend' | 'platform_mailtrap' | null;
  error?: string;
}

export interface SmtpCredentials {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export interface ResendCredentials {
  apiKey: string;
}

export interface Msg91Credentials {
  authKey: string;
  /** Verified sending domain registered with MSG91. */
  domain: string;
}

export interface MailtrapCredentials {
  /** Mailtrap API token (Sending → API Tokens). */
  token: string;
}

export type EmailCredentials =
  | SmtpCredentials
  | ResendCredentials
  | Msg91Credentials
  | MailtrapCredentials;

export interface AccountEmailSettings {
  provider: EmailProvider;
  fromEmail: string;
  fromName: string | null;
  credentials: EmailCredentials;
}

// ------------------------------------------------------------
// Settings load / save helpers
// ------------------------------------------------------------

/**
 * Load and decrypt a workspace's email settings. Returns null when
 * the account has not configured email delivery (callers fall back
 * to the platform default).
 */
export async function loadAccountEmailSettings(
  db: SupabaseClient,
  accountId: string
): Promise<AccountEmailSettings | null> {
  const { data, error } = await db
    .from('account_email_settings')
    .select('provider, from_email, from_name, credentials_encrypted')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  try {
    const credentials = JSON.parse(
      decrypt(data.credentials_encrypted)
    ) as EmailCredentials;
    return {
      provider: data.provider as EmailProvider,
      fromEmail: data.from_email,
      fromName: data.from_name,
      credentials,
    };
  } catch (err) {
    // Decryption failure = rotated key or tampered row. Fail closed
    // (no send) but never leak details to callers.
    console.error('[mailer] failed to decrypt email settings:', err);
    return null;
  }
}

/** Encrypt a credentials object for storage. */
export function encryptEmailCredentials(creds: EmailCredentials): string {
  return encrypt(JSON.stringify(creds));
}

function formatFrom(fromEmail: string, fromName: string | null): string {
  return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
}

/**
 * Load email settings from the workspace's connected email CHANNEL
 * (`channel_connections`), which is what Settings → Channels → Email
 * actually writes.
 *
 * Why this exists: this module originally read only
 * `account_email_settings`, a second table written exclusively by an
 * API route whose UI panel is mounted nowhere. In practice that table
 * is always empty, so `sendEmail()` always skipped the tenant and fell
 * through to platform env keys — and with no env keys set, invitation
 * email could never send no matter what an admin configured in the UI.
 * Reading the channel closes that gap and makes the visible,
 * test-before-enable connection the real source of truth.
 *
 * Only `status = 'connected'` rows qualify: that status is set after
 * the adapter's verify() succeeds, so we never try to send through a
 * half-configured or known-broken transport.
 */
async function loadEmailChannelSettings(
  db: SupabaseClient,
  accountId: string
): Promise<AccountEmailSettings | null> {
  const { data, error } = await db
    .from('channel_connections')
    .select(
      'provider, external_identity, configuration, credentials_encrypted, status'
    )
    .eq('account_id', accountId)
    .eq('channel', 'email')
    .eq('status', 'connected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.credentials_encrypted || !data.external_identity) {
    return null;
  }

  const config = (data.configuration ?? {}) as Record<string, unknown>;
  const fromName =
    typeof config.fromName === 'string' && config.fromName.trim()
      ? config.fromName.trim()
      : null;

  try {
    // Channel credentials are a discriminated { provider, value } blob,
    // unlike the flat shape used by account_email_settings — map it
    // onto this module's AccountEmailSettings so both paths converge on
    // the same sendWithSettings() dispatch.
    const parsed = JSON.parse(decrypt(data.credentials_encrypted)) as {
      provider: string;
      value: Record<string, unknown>;
    };
    if (parsed.provider !== data.provider) return null;

    let credentials: EmailCredentials;
    if (parsed.provider === 'smtp') {
      const port = Number(config.port);
      if (!config.host || !Number.isFinite(port)) return null;
      credentials = {
        host: String(config.host),
        port,
        secure: config.secure === true,
        username: String(parsed.value.username ?? ''),
        password: String(parsed.value.password ?? ''),
      };
    } else if (parsed.provider === 'resend') {
      credentials = { apiKey: String(parsed.value.apiKey ?? '') };
    } else if (parsed.provider === 'mailtrap') {
      credentials = { token: String(parsed.value.token ?? '') };
    } else {
      // google/twilio/meta are not transactional-email transports here.
      return null;
    }

    return {
      provider: parsed.provider as EmailProvider,
      fromEmail: data.external_identity,
      fromName,
      credentials,
    };
  } catch (err) {
    console.error('[mailer] failed to decrypt email channel:', err);
    return null;
  }
}

// ------------------------------------------------------------
// Adapter: SMTP (nodemailer) — Gmail, Zoho, Outlook, cPanel, ...
// ------------------------------------------------------------
async function sendViaSmtp(
  s: AccountEmailSettings,
  msg: EmailMessage
): Promise<EmailSendResult> {
  const creds = s.credentials as SmtpCredentials;
  try {
    // Dynamic import keeps nodemailer out of edge/client bundles.
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: { user: creds.username, pass: creds.password },
      // Do not hang a request on a slow SMTP server.
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
    await transporter.sendMail({
      from: formatFrom(s.fromEmail, s.fromName),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return { sent: true, provider: 'smtp' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'smtp error';
    console.error('[mailer] smtp send failed:', detail);
    return { sent: false, provider: 'smtp', error: detail };
  }
}

// ------------------------------------------------------------
// Adapter: Resend REST API (tenant's own key)
// ------------------------------------------------------------
async function sendViaResendKey(
  apiKey: string,
  from: string,
  msg: EmailMessage,
  provider: EmailSendResult['provider']
): Promise<EmailSendResult> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[mailer] resend send failed:', res.status, detail);
      return { sent: false, provider, error: `resend ${res.status}` };
    }
    return { sent: true, provider };
  } catch (err) {
    console.error('[mailer] resend network error:', err);
    return { sent: false, provider, error: 'network error' };
  }
}

// ------------------------------------------------------------
// Adapter: MSG91 transactional email API (low-cost, India-first)
// ------------------------------------------------------------
async function sendViaMsg91(
  s: AccountEmailSettings,
  msg: EmailMessage
): Promise<EmailSendResult> {
  const creds = s.credentials as Msg91Credentials;
  try {
    const res = await fetch('https://control.msg91.com/api/v5/email/send', {
      method: 'POST',
      headers: {
        authkey: creds.authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipients: [{ to: [{ email: msg.to }] }],
        from: { email: s.fromEmail, name: s.fromName ?? undefined },
        domain: creds.domain,
        subject: msg.subject,
        body: [{ type: 'text/html', data: msg.html }],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[mailer] msg91 send failed:', res.status, detail);
      return { sent: false, provider: 'msg91', error: `msg91 ${res.status}` };
    }
    return { sent: true, provider: 'msg91' };
  } catch (err) {
    console.error('[mailer] msg91 network error:', err);
    return { sent: false, provider: 'msg91', error: 'network error' };
  }
}

// ------------------------------------------------------------
// Adapter: Mailtrap Email Sending API
// ------------------------------------------------------------
async function sendViaMailtrapToken(
  token: string,
  fromEmail: string,
  fromName: string | null,
  msg: EmailMessage,
  provider: EmailSendResult['provider']
): Promise<EmailSendResult> {
  try {
    const res = await fetch('https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { email: fromEmail, ...(fromName ? { name: fromName } : {}) },
        to: [{ email: msg.to }],
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[mailer] mailtrap send failed:', res.status, detail);
      return { sent: false, provider, error: `mailtrap ${res.status}` };
    }
    return { sent: true, provider };
  } catch (err) {
    console.error('[mailer] mailtrap network error:', err);
    return { sent: false, provider, error: 'network error' };
  }
}

// ------------------------------------------------------------
// Dispatch
// ------------------------------------------------------------

/** Send using explicit settings (used by the test-send endpoint). */
export async function sendWithSettings(
  settings: AccountEmailSettings,
  msg: EmailMessage
): Promise<EmailSendResult> {
  switch (settings.provider) {
    case 'smtp':
      return sendViaSmtp(settings, msg);
    case 'resend':
      return sendViaResendKey(
        (settings.credentials as ResendCredentials).apiKey,
        formatFrom(settings.fromEmail, settings.fromName),
        msg,
        'resend'
      );
    case 'msg91':
      return sendViaMsg91(settings, msg);
    case 'mailtrap':
      return sendViaMailtrapToken(
        (settings.credentials as MailtrapCredentials).token,
        settings.fromEmail,
        settings.fromName,
        msg,
        'mailtrap'
      );
    default:
      return { sent: false, provider: null, error: 'unknown provider' };
  }
}

/**
 * Send an email on behalf of a workspace. Tries the tenant's own
 * provider first, then the platform Resend fallback. Never throws —
 * delivery is best-effort and callers decide how to surface failure.
 */
export async function sendEmail(
  db: SupabaseClient,
  accountId: string,
  msg: EmailMessage
): Promise<EmailSendResult> {
  // Tenant transports, in order of trustworthiness: the connected
  // email channel (verified by a real test send before it was marked
  // 'connected') first, then the legacy account_email_settings row.
  // Trying both keeps any existing legacy config working while making
  // the channel the primary, UI-visible source of truth.
  const tenantSettings = [
    await loadEmailChannelSettings(db, accountId),
    await loadAccountEmailSettings(db, accountId),
  ].filter((s): s is AccountEmailSettings => s !== null);

  for (const settings of tenantSettings) {
    const result = await sendWithSettings(settings, msg);
    if (result.sent) return result;
    // Tenant config broken (expired password, revoked key...) —
    // fall through to the next transport so mail still goes out.
  }

  // Platform fallback chain: Resend first, then Mailtrap. Each is
  // tried only when its env key exists; a Resend failure (unverified
  // domain, revoked key) falls through to Mailtrap so mail still
  // goes out.
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from =
      process.env.EMAIL_FROM?.trim() ||
      'Workspace Notifications <onboarding@resend.dev>';
    const result = await sendViaResendKey(
      resendKey,
      from,
      msg,
      'platform_resend'
    );
    if (result.sent) return result;
  }

  const mailtrapToken = process.env.MAILTRAP_API_TOKEN;
  if (mailtrapToken) {
    const fromEmail =
      process.env.MAILTRAP_FROM_EMAIL?.trim() || 'hello@demomailtrap.co';
    return sendViaMailtrapToken(
      mailtrapToken,
      fromEmail,
      'Workspace Notifications',
      msg,
      'platform_mailtrap'
    );
  }

  return { sent: false, provider: null, error: 'no email provider configured' };
}

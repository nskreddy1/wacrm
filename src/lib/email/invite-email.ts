// ============================================================
// Invite email delivery
//
// Two providers, resolved at send time:
//
//   1. Resend  — production path. Used when RESEND_API_KEY is
//      set. Sends a branded HTML email through the Resend REST
//      API (plain fetch — no SDK dependency needed).
//   2. Supabase — default / testing path. Falls back to
//      `auth.admin.inviteUserByEmail`, which delivers Supabase's
//      built-in invite email and redirects the user to our
//      /join/<token> accept page after they authenticate.
//
// Email delivery is BEST-EFFORT: the invitation row + link are
// already created by the time we get here, so a failed send never
// fails the API call. We report `{ sent, provider }` and the UI
// can still surface the copyable link.
// ============================================================

import { createClient } from '@supabase/supabase-js';

export interface InviteEmailParams {
  to: string;
  firstName: string | null;
  lastName: string | null;
  /** Workspace (account) display name for the email copy. */
  accountName: string;
  /** Inviter's display name for the email copy. */
  inviterName: string;
  /** The one-time invite accept URL (/join/<token>). */
  inviteUrl: string;
  expiresInDays: number;
}

export interface InviteEmailResult {
  sent: boolean;
  provider: 'resend' | 'supabase' | null;
  error?: string;
}

function greetingName(p: InviteEmailParams): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return name || p.to;
}

function renderHtml(p: InviteEmailParams): string {
  // Table-based layout — the only thing that renders consistently
  // across Gmail/Outlook/Apple Mail. Inline styles only.
  const name = greetingName(p);
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background-color:#0f9d58;padding:20px 32px;">
              <span style="color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(p.accountName)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#1f2937;">You&apos;re invited!</h1>
              <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151;">
                Hi ${escapeHtml(name)},
              </p>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
                ${escapeHtml(p.inviterName)} has invited you to join
                <strong>${escapeHtml(p.accountName)}</strong>. Click the button below to
                accept the invitation and set up your account. This link expires in
                ${p.expiresInDays} day${p.expiresInDays === 1 ? '' : 's'}.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
                <tr>
                  <td style="background-color:#0f9d58;border-radius:24px;">
                    <a href="${p.inviteUrl}" style="display:inline-block;padding:12px 32px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;">
                      Join the workspace
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">
                If the button doesn&apos;t work, copy and paste this link into your browser:<br />
                <a href="${p.inviteUrl}" style="color:#0f9d58;word-break:break-all;">${p.inviteUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                You received this email because someone invited you to a workspace.
                If you weren&apos;t expecting it, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ------------------------------------------------------------
// Provider: Resend (production)
// ------------------------------------------------------------
async function sendViaResend(p: InviteEmailParams): Promise<InviteEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, provider: null, error: 'no api key' };

  // Without a verified domain Resend only allows onboarding@resend.dev,
  // which can only deliver to the account owner's address. EMAIL_FROM
  // lets operators plug in their verified sender.
  const from =
    process.env.EMAIL_FROM?.trim() ||
    'Workspace Invites <onboarding@resend.dev>';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [p.to],
        subject: `You've been invited to join ${p.accountName}`,
        html: renderHtml(p),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[invite-email] resend send failed:', res.status, detail);
      return { sent: false, provider: 'resend', error: `resend ${res.status}` };
    }
    return { sent: true, provider: 'resend' };
  } catch (err) {
    console.error('[invite-email] resend network error:', err);
    return { sent: false, provider: 'resend', error: 'network error' };
  }
}

// ------------------------------------------------------------
// Provider: Supabase (default / testing)
// ------------------------------------------------------------
async function sendViaSupabase(
  p: InviteEmailParams
): Promise<InviteEmailResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.zepo_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.zepo_SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !serviceKey) {
    return {
      sent: false,
      provider: null,
      error: 'supabase admin not configured',
    };
  }

  try {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Supabase sends its built-in "You have been invited" email.
    // After the user authenticates, they're redirected to our
    // /join/<token> page which redeems the workspace invitation.
    const { error } = await admin.auth.admin.inviteUserByEmail(p.to, {
      redirectTo: p.inviteUrl,
      data: {
        full_name:
          [p.firstName, p.lastName].filter(Boolean).join(' ').trim() ||
          undefined,
        invited_to_account: p.accountName,
      },
    });

    if (error) {
      // Most common: the auth user already exists (they have an
      // account elsewhere). Not fatal — the admin still has the
      // copyable link to share directly.
      console.error('[invite-email] supabase invite failed:', error.message);
      return { sent: false, provider: 'supabase', error: error.message };
    }
    return { sent: true, provider: 'supabase' };
  } catch (err) {
    console.error('[invite-email] supabase invite error:', err);
    return { sent: false, provider: 'supabase', error: 'unexpected error' };
  }
}

/**
 * Send the invitation email. Resend when configured (production),
 * otherwise Supabase's built-in invite email (default / testing).
 * Never throws — delivery is best-effort.
 */
export async function sendInviteEmail(
  p: InviteEmailParams
): Promise<InviteEmailResult> {
  if (process.env.RESEND_API_KEY) {
    const result = await sendViaResend(p);
    // If Resend is configured but the send bounced (e.g. unverified
    // sender domain), fall back to Supabase so the invite still
    // reaches the user in dev/testing setups.
    if (result.sent) return result;
    const fallback = await sendViaSupabase(p);
    return fallback.sent ? fallback : result;
  }
  return sendViaSupabase(p);
}

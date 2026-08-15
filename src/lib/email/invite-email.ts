// ============================================================
// Invite email delivery
//
// Sending is OFF unless a platform super admin turns it on
// (`invite_delivery_mode` in platform_settings — see
// ./invite-delivery-mode.ts). With it off, invites are link-only:
// the admin copies the /join/<token> URL and delivers it however
// they like. That is the safe default, because the invitation row
// and its link are created regardless of whether mail goes out.
//
// When sending IS enabled, the transport is resolved at send time —
// and it is always the PLATFORM's, never a tenant's:
//   1. The operator's configured transport (Platform admin → Invite
//      delivery): SMTP, Resend, or Mailtrap.
//   2. Platform Resend, when RESEND_API_KEY is set (ops/dev escape
//      hatch that predates the UI).
//
// Workspace email settings are deliberately NOT consulted. Invites
// reach people who have no account yet, so allowing each tenant to
// choose the sending server would let any workspace send mail in the
// platform's name, invisibly to the operator. Tenant providers still
// power broadcasts and template test-sends via mailer.sendEmail().
//
// There is deliberately no third fallback. `inviteUserByEmail`
// used to sit here and was removed: it creates an auth user for
// whatever address it is handed, so it both ignored the operator
// gate and allowed pre-creating accounts for arbitrary emails.
//
// Delivery is BEST-EFFORT and never throws — a failed send must
// not fail the invite API call. Callers get `{ sent, provider,
// reason }` and surface the copyable link.
//
// Self-healing: consecutive real send failures (rotted SMTP
// credentials, revoked API key, blocked sender) are counted, and
// after the threshold the platform flips ITSELF back to link-only.
// A workspace that simply hasn't configured email yet does not
// count — that's a setup state, not a broken provider.
// ============================================================

import { sendWithSettings } from './mailer';
import { getPlatformTransport } from './platform-invite-transport';
import {
  getInviteDeliveryMode,
  recordInviteDeliveryFailure,
  resetInviteDeliveryFailures,
} from './invite-delivery-mode';

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

/**
 * Why an invite email was or wasn't delivered. The invite API returns
 * this so the UI can tell the admin the truth — "copy this link,
 * sending is off" reads very differently from "we emailed them".
 */
export type InviteEmailReason =
  | 'sent'
  | 'link_only'
  | 'no_provider'
  | 'send_failed';

export interface InviteEmailResult {
  sent: boolean;
  provider: string | null;
  reason?: InviteEmailReason;
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

/**
 * Send the invitation email — IF the platform operator has enabled
 * email delivery.
 *
 *   mode = 'link_only' (default) → send nothing, return
 *      reason 'link_only'. The caller already has the /join/<token>
 *      URL and shows it for the admin to deliver by hand.
 *   mode = 'email' → try the operator's configured transport
 *      (Platform admin → Invite delivery), then the platform
 *      RESEND_API_KEY env fallback.
 *
 * Never throws — delivery is best-effort and the invitation row
 * exists either way.
 */
/**
 * Health bookkeeping must never be able to fail a send. The helpers
 * already swallow their own errors, but this module must not *depend*
 * on that — a future change there shouldn't be able to turn a handled
 * delivery failure into a 500 on the invite API.
 */
async function safely(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (err) {
    console.error('[invite-email] delivery bookkeeping failed:', err);
  }
}

export async function sendInviteEmail(
  p: InviteEmailParams
): Promise<InviteEmailResult> {
  // Gate FIRST, before touching any provider. Checking the mode
  // after a send attempt would be pointless — the mail would
  // already be gone.
  const mode = await getInviteDeliveryMode();
  if (mode !== 'email') {
    return { sent: false, provider: null, reason: 'link_only' };
  }

  // 1. The platform operator's transport (Platform admin → Invite
  //    delivery). This is the ONLY tenant-independent sender: a
  //    workspace owner cannot point invite mail at their own SMTP
  //    server, because invites go to strangers and must come from
  //    the platform's verified sender, under operator control.
  let lastError: string | null = null;
  const platform = await getPlatformTransport();
  if (platform) {
    const viaPlatform = await sendWithSettings(platform, {
      to: p.to,
      subject: `You've been invited to join ${p.accountName}`,
      html: renderHtml(p),
    });
    if (viaPlatform.sent) {
      await safely(resetInviteDeliveryFailures());
      return { sent: true, provider: viaPlatform.provider, reason: 'sent' };
    }
    // A configured-but-failing transport (rotted password, revoked
    // key, blocked sender) is a real failure and counts toward the
    // auto-disable breaker. "Not configured at all" does not — that
    // is a setup state, handled by falling through below.
    lastError = viaPlatform.error ?? 'platform transport failed';
  }

  // 2. Platform Resend, only when an operator supplied a key.
  if (process.env.RESEND_API_KEY) {
    const result = await sendViaResend(p);
    if (result.sent) {
      await safely(resetInviteDeliveryFailures());
      return { ...result, reason: 'sent' };
    }
    // Every provider we have refused. Count it — enough of these in a
    // row and email auto-disables itself, so admins fall back to the
    // link that always works instead of invites vanishing into a
    // broken SMTP config.
    await safely(recordInviteDeliveryFailure(result.error ?? lastError));
    return { ...result, reason: 'send_failed' };
  }

  // The workspace provider was the only option, and it failed.
  if (lastError) {
    await safely(recordInviteDeliveryFailure(lastError));
    return {
      sent: false,
      provider: null,
      reason: 'send_failed',
      error: lastError,
    };
  }

  // Delivery is on, but nothing is configured to actually deliver.
  // Report it plainly instead of silently reaching for a fallback:
  // the previous code called Supabase's `inviteUserByEmail` here,
  // which CREATES an auth user for the address and mails Supabase's
  // own magic link. That both bypassed this gate and let anyone with
  // invite rights pre-create accounts for arbitrary addresses.
  return {
    sent: false,
    provider: null,
    reason: 'no_provider',
    error: 'no email provider configured',
  };
}

import { supabaseAdmin } from '@/features/flows/lib/admin-client';
import { sendEmail } from '@/lib/email/mailer';
import type {
  AlertAdapter,
  AlertDestination,
  AlertPayload,
  AlertSendResult,
} from '../types';

/**
 * Email alert adapter.
 *
 * Reuses the existing `sendEmail()` mailer, which already implements the
 * tenant-first / platform-fallback chain (account SMTP or Resend key,
 * then the platform Resend, then Mailtrap). No new credentials and no new
 * provider integration are introduced here — an account that can already
 * send email can already receive alerts.
 *
 * ONE recipient per destination, deliberately.
 *
 * The outbox stores a single row per (notification, destination), so a
 * retry re-runs the whole row. If this adapter fanned out to N addresses
 * and address 3 of 5 failed, the retry would re-send to 1 and 2 — the
 * team gets duplicate alerts, and duplicates on an escalation channel
 * train people to ignore it. Keeping it to one address makes the send
 * atomic: it either happened or it didn't.
 *
 * That is also the normal enterprise pattern — point this at a shared
 * inbox or distribution list (`support@`, `oncall@`) and let the mail
 * system handle fan-out, which it does far better than we would. Admins
 * who want several independent addresses add several destinations, and
 * then each gets its own outbox row with its own retry state.
 */

export interface EmailDestinationConfig {
  /** Single address, ideally a shared inbox or distribution list. */
  recipient: string;
}

/** Conservative: rejects the shapes that break SMTP, not a full RFC 5322. */
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(payload: AlertPayload): string {
  // Inline styles only: every real mail client strips <style> blocks.
  const title = escapeHtml(payload.title);
  const body = escapeHtml(payload.body).replace(/\n/g, '<br />');
  const button = payload.url
    ? `<p style="margin:24px 0 0;">
         <a href="${escapeHtml(payload.url)}"
            style="display:inline-block;padding:10px 18px;background:#111827;color:#ffffff;
                   text-decoration:none;border-radius:6px;font-weight:600;">
           Open conversation
         </a>
       </p>`
    : '';

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                      max-width:560px;margin:0 auto;padding:24px;color:#111827;">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;">
    Action needed
  </p>
  <h1 style="margin:0 0 12px;font-size:18px;line-height:1.4;">${title}</h1>
  <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">${body}</p>
  ${button}
</div>`;
}

function renderText(payload: AlertPayload): string {
  return [payload.title, '', payload.body, payload.url ? `\n${payload.url}` : '']
    .filter((line) => line !== undefined)
    .join('\n');
}

export const emailAlertAdapter: AlertAdapter = {
  provider: 'email',

  async send(
    destination: AlertDestination,
    payload: AlertPayload
  ): Promise<AlertSendResult> {
    const config = destination.config as unknown as EmailDestinationConfig;
    const recipient = config?.recipient?.trim();

    if (!recipient || !EMAIL_RE.test(recipient)) {
      // Bad config never heals on its own: dead-letter so the admin sees
      // the reason in settings instead of it retrying silently forever.
      return {
        ok: false,
        retryable: false,
        error: recipient
          ? `Invalid recipient address: ${recipient}`
          : 'No recipient configured',
      };
    }

    const db = supabaseAdmin();
    const result = await sendEmail(db, destination.account_id, {
      to: recipient,
      subject: payload.title,
      html: renderHtml(payload),
      text: renderText(payload),
    });

    if (!result.sent) {
      // sendEmail already walked the whole provider fallback chain, so a
      // failure here means every configured provider refused. Treat as
      // retryable: the usual causes (rate limit, provider blip, expired
      // token being refreshed) clear on their own, and the backoff plus
      // MAX_ATTEMPTS ceiling stops it burning quota indefinitely.
      return {
        ok: false,
        retryable: true,
        error: result.error ?? 'Email send failed',
      };
    }

    return { ok: true };
  },
};

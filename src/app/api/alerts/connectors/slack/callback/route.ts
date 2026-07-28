import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/features/flows/lib/admin-client';
import { encrypt } from '@/features/whatsapp/lib/encryption';
import { verifyOAuthState } from '@/features/alerts/lib/oauth-state';
import { canonicalOrigin } from '@/lib/url/canonical-origin';

/**
 * Slack OAuth v2 callback (popup).
 *
 * Exchanges the one-time `code` for a workspace-scoped bot token via
 * `oauth.v2.access`, stores it AES-256-GCM-encrypted on the alert
 * destination row, then reports back to the opener via postMessage and
 * closes — the same popup pattern proven by the Twilio Connect callback.
 *
 * Security posture:
 * - `state` is HMAC-signed and self-expiring (CSRF; forged or replayed
 *   states are rejected before any Slack call is made).
 * - The bot token is never logged, never rendered into HTML, and never
 *   round-trips to the browser — only "ok"/"error" leaves this route.
 * - Uses the service-role client because the popup carries the user's
 *   cookies but writes with an exact account_id from the verified state,
 *   not from any client-supplied parameter.
 */

function popupHtml(origin: string, ok: boolean, message: string): NextResponse {
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Slack connection</title></head>
  <body style="font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 90vh;">
    <p>${message}</p>
    <script>
      if (window.opener) {
        window.opener.postMessage(
          { source: 'slack-connect', ok: ${ok ? 'true' : 'false'} },
          ${JSON.stringify(origin)},
        );
        setTimeout(function () { window.close(); }, 800);
      }
    </script>
  </body>
</html>`;
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  team?: { id?: string; name?: string };
  bot_user_id?: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Public origin, not the internal one: used both as the postMessage
  // target (a wrong target is silently dropped, hanging the popup) and to
  // rebuild the exact redirect_uri the authorize step sent to Slack.
  const origin = canonicalOrigin(request);

  if (url.searchParams.get('error')) {
    // User clicked "Cancel" on Slack's consent screen — a normal outcome.
    return popupHtml(
      origin,
      false,
      'Connection was cancelled. You can close this window.'
    );
  }

  const code = url.searchParams.get('code') ?? '';
  const state = verifyOAuthState(url.searchParams.get('state') ?? '', 'slack');
  if (!code || !state) {
    return popupHtml(
      origin,
      false,
      'This connection link is invalid or has expired. Please try again from Notification Settings.'
    );
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return popupHtml(origin, false, 'Slack is not configured on this server.');
  }

  // --- Exchange the one-time code for a workspace bot token -------------
  let data: SlackOAuthResponse;
  try {
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/alerts/connectors/slack/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    data = (await res.json()) as SlackOAuthResponse;
  } catch {
    return popupHtml(origin, false, 'Could not reach Slack. Please try again.');
  }

  if (!data.ok || !data.access_token || !data.team?.id) {
    console.error('[slack connect] oauth.v2.access failed:', data.error);
    return popupHtml(
      origin,
      false,
      'Slack rejected the connection. Please try again.'
    );
  }

  // --- Persist: one Slack destination per workspace per account ---------
  const db = supabaseAdmin();
  const teamId = data.team.id;
  const teamName = data.team.name ?? teamId;

  const { data: existing } = await db
    .from('alert_destinations')
    .select('id, config')
    .eq('account_id', state.accountId)
    .eq('provider', 'slack')
    .eq('config->>team_id', teamId)
    .limit(1)
    .maybeSingle();

  const encrypted = encrypt(data.access_token);

  if (existing) {
    // Re-install of the same workspace: rotate the token in place and
    // clear any dead-letter state so deliveries resume immediately.
    const { error: updErr } = await db
      .from('alert_destinations')
      .update({
        credentials_encrypted: encrypted,
        display_name: `Slack — ${teamName}`,
        enabled: true,
        config: { ...(existing.config as object), team_name: teamName },
      })
      .eq('id', existing.id);
    if (updErr) {
      console.error('[slack connect] token rotation failed:', updErr.message);
      return popupHtml(origin, false, 'Could not save the connection.');
    }
  } else {
    const { error: insErr } = await db.from('alert_destinations').insert({
      account_id: state.accountId,
      provider: 'slack',
      display_name: `Slack — ${teamName}`,
      // channel_id intentionally empty: the admin picks the channel in
      // Notification Settings right after connecting.
      config: { team_id: teamId, team_name: teamName, channel_id: '' },
      credentials_encrypted: encrypted,
      created_by: state.userId,
    });
    if (insErr) {
      console.error(
        '[slack connect] destination insert failed:',
        insErr.message
      );
      return popupHtml(origin, false, 'Could not save the connection.');
    }
  }

  return popupHtml(
    origin,
    true,
    'Slack workspace connected. Returning to settings…'
  );
}

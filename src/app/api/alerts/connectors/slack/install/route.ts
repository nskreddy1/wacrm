import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import { createOAuthState } from '@/features/alerts/lib/oauth-state';
import { canonicalOrigin } from '@/lib/url/canonical-origin';

/**
 * Starts the Slack OAuth v2 install flow.
 *
 * Opened in a popup from Notification Settings. The client logs into
 * THEIR OWN workspace on Slack's page — credentials never touch us; we
 * only ever receive a scoped bot token in the callback.
 *
 * Minimal scopes on purpose (least privilege — enterprise review teams
 * reject token-hungry apps):
 *   chat:write            post the alert message
 *   channels:read         list public channels for the picker
 *   chat:write.public     post to public channels without a manual invite
 */
export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (error) {
    return toErrorResponse(error);
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'Slack is not configured (missing SLACK_CLIENT_ID)' },
      { status: 501 }
    );
  }

  // MUST be the public origin, and MUST match the value used in the
  // callback's token exchange or Slack fails with redirect_uri_mismatch.
  const origin = canonicalOrigin(request);
  const state = createOAuthState({
    accountId: ctx.accountId,
    userId: ctx.userId,
    provider: 'slack',
  });

  const authorize = new URL('https://slack.com/oauth/v2/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set(
    'scope',
    'chat:write,channels:read,chat:write.public'
  );
  authorize.searchParams.set('state', state);
  authorize.searchParams.set(
    'redirect_uri',
    `${origin}/api/alerts/connectors/slack/callback`
  );

  return NextResponse.redirect(authorize.toString(), 302);
}

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/features/flows/lib/admin-client';
import { decrypt } from '@/features/whatsapp/lib/encryption';

/**
 * Lists public channels of a connected Slack workspace for the channel
 * picker in Notification Settings.
 *
 * The bot token is decrypted server-side and used for exactly one
 * paginated `conversations.list` call — it never reaches the browser.
 * Capped at 3 pages (600 channels): a picker beyond that needs search,
 * not a longer list, and the cap bounds our Slack API spend per click.
 */
export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (error) {
    return toErrorResponse(error);
  }

  const rate = await checkRateLimit(
    `alerts-slack-channels:${ctx.userId}`,
    RATE_LIMITS.adminAction
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const destinationId = new URL(request.url).searchParams.get('destination');
  if (!destinationId) {
    return NextResponse.json({ error: 'Missing destination' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: destination } = await db
    .from('alert_destinations')
    .select('id, provider, credentials_encrypted')
    .eq('id', destinationId)
    .eq('account_id', ctx.accountId)
    .eq('provider', 'slack')
    .maybeSingle();

  if (!destination?.credentials_encrypted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let token: string;
  try {
    token = decrypt(destination.credentials_encrypted);
  } catch {
    return NextResponse.json(
      { error: 'Stored Slack credentials are unreadable — reconnect the workspace' },
      { status: 409 }
    );
  }

  const channels: Array<{ id: string; name: string }> = [];
  let cursor = '';
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({
      types: 'public_channel',
      exclude_archived: 'true',
      limit: '200',
    });
    if (cursor) params.set('cursor', cursor);

    let body: {
      ok: boolean;
      error?: string;
      channels?: Array<{ id: string; name: string }>;
      response_metadata?: { next_cursor?: string };
    };
    try {
      const res = await fetch(
        `https://slack.com/api/conversations.list?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        }
      );
      body = await res.json();
    } catch {
      return NextResponse.json(
        { error: 'Could not reach Slack' },
        { status: 502 }
      );
    }

    if (!body.ok) {
      // token_revoked / account_inactive → surface as "reconnect".
      const needsReconnect =
        body.error === 'token_revoked' ||
        body.error === 'invalid_auth' ||
        body.error === 'account_inactive';
      return NextResponse.json(
        {
          error: needsReconnect
            ? 'Slack connection expired — reconnect the workspace'
            : `Slack error: ${body.error ?? 'unknown'}`,
        },
        { status: needsReconnect ? 409 : 502 }
      );
    }

    for (const ch of body.channels ?? []) {
      channels.push({ id: ch.id, name: ch.name });
    }
    cursor = body.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }

  channels.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ channels });
}

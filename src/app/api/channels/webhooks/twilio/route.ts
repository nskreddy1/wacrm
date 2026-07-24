import crypto from 'node:crypto';
import { NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/features/flows/lib/admin-client';
import { decryptProviderCredentials } from '@/features/channels/lib/credentials';
import { persistInboundChannelMessage } from '@/features/channels/lib/inbound';
import { orchestrateInboundChannelMessage } from '@/features/channels/lib/orchestrate-inbound';
import {
  applyMessageDeliveryStatus,
  mapTwilioStatus,
} from '@/features/admin/lib/orchestration/status';

export const maxDuration = 30;

/**
 * Twilio's default opt-out / opt-in keyword sets (docs: "Twilio
 * support for opt-out keywords"). Twilio itself blocks further sends
 * after STOP (error 21610); we mirror the state on the contact so
 * broadcasts skip these numbers proactively instead of failing.
 * Matching is case-insensitive on the trimmed whole message.
 */
const SMS_OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
]);
const SMS_OPT_IN_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);

function detectSmsOptEvent(text: string | undefined): 'out' | 'in' | null {
  const keyword = (text ?? '').trim().toUpperCase();
  if (SMS_OPT_OUT_KEYWORDS.has(keyword)) return 'out';
  if (SMS_OPT_IN_KEYWORDS.has(keyword)) return 'in';
  return null;
}

function validSignature(
  url: string,
  params: URLSearchParams,
  signature: string | null,
  authToken: string
) {
  if (!signature) return false;
  const fields = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const payload = fields.reduce(
    (value, [key, field]) => value + key + field,
    url
  );
  const expected = crypto
    .createHmac('sha1', authToken)
    .update(payload)
    .digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Reconstruct the canonical public URL Twilio signed against.
 *
 * Behind Vercel/proxies, `request.url` reflects the internal origin
 * (e.g. `http://localhost:3000/...`), not the public URL Twilio hit —
 * so signature validation against raw `request.url` fails (or worse,
 * could false-pass if an attacker controls the internal host). Order:
 *   1. `NEXT_PUBLIC_SITE_URL` — operator's explicit canonical origin
 *      (same source the Twilio adapter uses for its statusCallback URL).
 *   2. `x-forwarded-proto` / `x-forwarded-host` — set by Vercel and
 *      standard reverse proxies.
 *   3. `request.url` — direct (unproxied) deployments.
 * The original path + query are always preserved.
 */
function canonicalWebhookUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    try {
      const origin = new URL(explicit).origin;
      return `${origin}${requestUrl.pathname}${requestUrl.search}`;
    } catch {
      // Malformed env value — fall through to forwarded headers.
    }
  }
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}${requestUrl.pathname}${requestUrl.search}`;
  }
  return request.url;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  // Twilio address format is the channel discriminator: WhatsApp
  // traffic arrives as `whatsapp:+1555...`, plain SMS as `+1555...`.
  // The same webhook URL serves both, so detect before stripping.
  const rawTo = params.get('To') ?? '';
  const rawFrom = params.get('From') ?? '';
  const channel =
    rawTo.startsWith('whatsapp:') || rawFrom.startsWith('whatsapp:')
      ? 'whatsapp'
      : 'sms';
  const to = rawTo ? rawTo.replace(/^whatsapp:/, '') : undefined;
  const from = rawFrom ? rawFrom.replace(/^whatsapp:/, '') : undefined;
  const messageSid = params.get('MessageSid');
  if (!messageSid)
    return NextResponse.json(
      { error: 'Invalid Twilio payload' },
      { status: 400 }
    );

  // Twilio hits this same URL for two things:
  //   - inbound messages (SmsStatus=received, our number in `To`)
  //   - delivery-status callbacks for our outbound sends
  //     (MessageStatus=queued|sent|delivered|read|failed|…, our number in `From`)
  const messageStatus = params.get('MessageStatus');
  const isStatusCallback = !!messageStatus && messageStatus !== 'received';

  // Our WhatsApp sender number owns the connection in both directions.
  const connectionIdentity = isStatusCallback ? from : to;
  if (!connectionIdentity)
    return NextResponse.json(
      { error: 'Invalid Twilio payload' },
      { status: 400 }
    );

  const db = supabaseAdmin();
  // Channel-scoped lookup: the same Twilio number can hold separate
  // WhatsApp and SMS connections without cross-routing messages.
  let { data: connection } = await db
    .from('channel_connections')
    .select('*')
    .eq('provider', 'twilio')
    .eq('channel', channel)
    .eq('external_identity', connectionIdentity)
    .eq('is_enabled', true)
    .maybeSingle();

  // Status-callback fallback: Messaging Service sends report `From`
  // as the pool sender Twilio picked, which may not equal the
  // connection's stored external_identity. MessageSid is globally
  // unique, so resolve the account through the message row and grab
  // that account's enabled Twilio connection for this channel.
  // Without this, delivery failures are silently dropped and stuck
  // messages show "sent" forever — hiding real outbound problems.
  if (!connection && isStatusCallback) {
    const { data: msgRow } = await db
      .from('messages')
      .select('conversation_id, conversations!inner(account_id)')
      .eq('message_id', messageSid)
      .limit(1)
      .maybeSingle();
    const msgAccountId = (
      msgRow as { conversations?: { account_id?: string } } | null
    )?.conversations?.account_id;
    if (msgAccountId) {
      const { data: fallback } = await db
        .from('channel_connections')
        .select('*')
        .eq('account_id', msgAccountId)
        .eq('provider', 'twilio')
        .eq('channel', channel)
        .eq('is_enabled', true)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle();
      connection = fallback ?? null;
    }
  }

  if (!connection)
    return NextResponse.json({ error: 'Unknown destination' }, { status: 404 });

  const credentials = decryptProviderCredentials(connection);
  if (
    credentials.provider !== 'twilio' ||
    !validSignature(
      canonicalWebhookUrl(request),
      params,
      request.headers.get('x-twilio-signature'),
      credentials.value.authToken
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (isStatusCallback) {
    // Unified delivery tracking (Phase 2c). Ack Twilio immediately;
    // mirrors run in the background. Pre-send churn (queued/sending)
    // maps to null and is deliberately ignored.
    const mapped = mapTwilioStatus(messageStatus);
    if (mapped) {
      const errorCode = params.get('ErrorCode') || undefined;
      after(async () => {
        try {
          await applyMessageDeliveryStatus({
            externalMessageId: messageSid,
            status: mapped,
            occurredAt: new Date().toISOString(),
            errorCode,
            errorMessage: errorCode ? `Twilio error ${errorCode}` : undefined,
          });
        } catch (error) {
          console.error('[twilio-webhook] status apply failed:', error);
        }
      });
    }
    return new Response(null, { status: 204 });
  }

  if (!to)
    return NextResponse.json(
      { error: 'Invalid Twilio payload' },
      { status: 400 }
    );

  const mediaType = params.get('MediaContentType0') || '';
  const contentType = mediaType.startsWith('image/')
    ? 'image'
    : mediaType.startsWith('audio/')
      ? 'audio'
      : mediaType.startsWith('video/')
        ? 'video'
        : mediaType
          ? 'document'
          : 'text';
  const inboundText = params.get('Body') || undefined;
  const result = await persistInboundChannelMessage(db, connection, {
    provider: 'twilio',
    externalMessageId: messageSid,
    externalThreadId: params.get('From') || undefined,
    from: params.get('From') || '',
    to,
    name: params.get('ProfileName') || undefined,
    text: inboundText,
    mediaUrl: params.get('MediaUrl0') || undefined,
    contentType,
    payload: Object.fromEntries(params.entries()),
  });

  // SMS opt-out compliance: mirror STOP/START keywords onto the
  // contact before orchestration so the state is queryable by the
  // time any automation or broadcast reads it. WhatsApp has its own
  // in-platform block mechanism, so this is SMS-only.
  if (channel === 'sms' && !result.duplicate) {
    const optEvent = detectSmsOptEvent(inboundText);
    if (optEvent && result.contactId) {
      const { error: optError } = await db
        .from('contacts')
        .update(
          optEvent === 'out'
            ? {
                sms_opted_out: true,
                sms_opted_out_at: new Date().toISOString(),
              }
            : { sms_opted_out: false, sms_opted_out_at: null }
        )
        .eq('id', result.contactId)
        .eq('account_id', connection.account_id);
      if (optError) {
        console.error(
          '[twilio-webhook] opt-state update failed:',
          optError.message
        );
      }
    }
  }

  if (!result.duplicate) {
    after(async () => {
      await orchestrateInboundChannelMessage({
        accountId: connection.account_id,
        conversationId: result.conversationId,
        contactId: result.contactId,
        externalMessageId: messageSid,
        text: inboundText,
        contentType,
        contactCreated: result.contactCreated,
        isFirstInboundMessage: result.isFirstInboundMessage,
        configOwnerUserId: connection.created_by_user_id ?? '',
      });
    });
  }

  return new Response('<Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

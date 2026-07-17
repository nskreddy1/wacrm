import crypto from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { decryptProviderCredentials } from '@/lib/channels/credentials'
import { persistInboundChannelMessage } from '@/lib/channels/inbound'
import { orchestrateInboundChannelMessage } from '@/lib/channels/orchestrate-inbound'
import { applyMessageDeliveryStatus, mapTwilioStatus } from '@/lib/orchestration/status'

export const maxDuration = 30

function validSignature(url: string, params: URLSearchParams, signature: string | null, authToken: string) {
  if (!signature) return false
  const fields = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const payload = fields.reduce((value, [key, field]) => value + key + field, url)
  const expected = crypto.createHmac('sha1', authToken).update(payload).digest('base64')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
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
  const requestUrl = new URL(request.url)
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) {
    try {
      const origin = new URL(explicit).origin
      return `${origin}${requestUrl.pathname}${requestUrl.search}`
    } catch {
      // Malformed env value — fall through to forwarded headers.
    }
  }
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}${requestUrl.pathname}${requestUrl.search}`
  }
  return request.url
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const params = new URLSearchParams(rawBody)
  const to = params.get('To')?.replace(/^whatsapp:/, '')
  const from = params.get('From')?.replace(/^whatsapp:/, '')
  const messageSid = params.get('MessageSid')
  if (!messageSid) return NextResponse.json({ error: 'Invalid Twilio payload' }, { status: 400 })

  // Twilio hits this same URL for two things:
  //   - inbound messages (SmsStatus=received, our number in `To`)
  //   - delivery-status callbacks for our outbound sends
  //     (MessageStatus=queued|sent|delivered|read|failed|…, our number in `From`)
  const messageStatus = params.get('MessageStatus')
  const isStatusCallback = !!messageStatus && messageStatus !== 'received'

  // Our WhatsApp sender number owns the connection in both directions.
  const connectionIdentity = isStatusCallback ? from : to
  if (!connectionIdentity) return NextResponse.json({ error: 'Invalid Twilio payload' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: connection } = await db.from('channel_connections').select('*')
    .eq('provider', 'twilio').eq('external_identity', connectionIdentity).eq('is_enabled', true).maybeSingle()
  if (!connection) return NextResponse.json({ error: 'Unknown destination' }, { status: 404 })

  const credentials = decryptProviderCredentials(connection)
  if (credentials.provider !== 'twilio' || !validSignature(canonicalWebhookUrl(request), params, request.headers.get('x-twilio-signature'), credentials.value.authToken)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (isStatusCallback) {
    // Unified delivery tracking (Phase 2c). Ack Twilio immediately;
    // mirrors run in the background. Pre-send churn (queued/sending)
    // maps to null and is deliberately ignored.
    const mapped = mapTwilioStatus(messageStatus)
    if (mapped) {
      const errorCode = params.get('ErrorCode') || undefined
      after(async () => {
        try {
          await applyMessageDeliveryStatus({
            externalMessageId: messageSid,
            status: mapped,
            occurredAt: new Date().toISOString(),
            errorCode,
            errorMessage: errorCode ? `Twilio error ${errorCode}` : undefined,
          })
        } catch (error) {
          console.error('[twilio-webhook] status apply failed:', error)
        }
      })
    }
    return new Response(null, { status: 204 })
  }

  if (!to) return NextResponse.json({ error: 'Invalid Twilio payload' }, { status: 400 })

  const mediaType = params.get('MediaContentType0') || ''
  const contentType = mediaType.startsWith('image/') ? 'image' : mediaType.startsWith('audio/') ? 'audio' : mediaType.startsWith('video/') ? 'video' : mediaType ? 'document' : 'text'
  const inboundText = params.get('Body') || undefined
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
  })

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
      })
    })
  }

  return new Response('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

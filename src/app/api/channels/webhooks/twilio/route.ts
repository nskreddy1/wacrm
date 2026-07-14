import crypto from 'node:crypto'
import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { decryptProviderCredentials } from '@/lib/channels/credentials'
import { persistInboundChannelMessage } from '@/lib/channels/inbound'

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

export async function POST(request: Request) {
  const rawBody = await request.text()
  const params = new URLSearchParams(rawBody)
  const to = params.get('To')?.replace(/^whatsapp:/, '')
  const messageSid = params.get('MessageSid')
  if (!to || !messageSid) return NextResponse.json({ error: 'Invalid Twilio payload' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: connection } = await db.from('channel_connections').select('*')
    .eq('provider', 'twilio').eq('external_identity', to).eq('is_enabled', true).maybeSingle()
  if (!connection) return NextResponse.json({ error: 'Unknown destination' }, { status: 404 })

  const credentials = decryptProviderCredentials(connection)
  if (credentials.provider !== 'twilio' || !validSignature(request.url, params, request.headers.get('x-twilio-signature'), credentials.value.authToken)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

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

  // AI auto-reply for plain-text inbound, matching the Meta webhook's
  // behavior. Awaited inside `after()` so Twilio gets its TwiML ack
  // immediately while the LLM call finishes in the background.
  // `dispatchInboundToAiReply` owns its eligibility gates + try/catch
  // and never throws.
  if (!result.duplicate && result.conversationId && result.contactId && inboundText?.trim()) {
    const { conversationId, contactId } = result
    after(async () => {
      await dispatchInboundToAiReply({
        accountId: connection.account_id,
        conversationId,
        contactId,
        configOwnerUserId: connection.created_by_user_id ?? '',
      })
    })
  }

  return new Response('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

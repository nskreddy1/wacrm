import { NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { decryptProviderCredentials } from '@/lib/channels/credentials'
import { persistInboundChannelMessage } from '@/lib/channels/inbound'
import { verifyMetaSignatureWithSecret } from '@/lib/whatsapp/webhook-signature'

export const maxDuration = 30

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  if (params.get('hub.mode') !== 'subscribe' || !token || !challenge) return NextResponse.json({ error: 'Invalid challenge' }, { status: 400 })

  const { data: connections } = await supabaseAdmin().from('channel_connections').select('*').eq('provider', 'meta').eq('is_enabled', true)
  const matched = connections?.some((connection) => {
    try {
      const credentials = decryptProviderCredentials(connection)
      return credentials.provider === 'meta' && credentials.value.verifyToken === token
    } catch { return false }
  })
  return matched ? new Response(challenge, { headers: { 'Content-Type': 'text/plain' } }) : NextResponse.json({ error: 'Invalid token' }, { status: 403 })
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  let body: Record<string, unknown>
  try { body = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const entries = Array.isArray(body.entry) ? body.entry as Array<Record<string, unknown>> : []
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes as Array<Record<string, unknown>> : []
    for (const change of changes) {
      const value = change.value as Record<string, unknown> | undefined
      const metadata = value?.metadata as Record<string, string> | undefined
      const phoneNumberId = metadata?.phone_number_id
      if (!phoneNumberId) continue

      const db = supabaseAdmin()
      const { data: connection } = await db.from('channel_connections').select('*')
        .eq('provider', 'meta').eq('external_account_id', phoneNumberId).eq('is_enabled', true).maybeSingle()
      if (!connection) continue
      const credentials = decryptProviderCredentials(connection)
      if (credentials.provider !== 'meta' || !verifyMetaSignatureWithSecret(rawBody, request.headers.get('x-hub-signature-256'), credentials.value.appSecret)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }

      const contacts = Array.isArray(value?.contacts) ? value.contacts as Array<Record<string, unknown>> : []
      const messages = Array.isArray(value?.messages) ? value.messages as Array<Record<string, unknown>> : []
      for (const message of messages) {
        const from = String(message.from || '')
        const contact = contacts.find((item) => item.wa_id === from)
        const profile = contact?.profile as Record<string, unknown> | undefined
        const text = message.text as Record<string, unknown> | undefined
        const type = String(message.type || 'text')
        const media = message[type] as Record<string, unknown> | undefined
        const timestamp = Number(message.timestamp)
        const inboundText = typeof text?.body === 'string' ? text.body : typeof media?.caption === 'string' ? media.caption : undefined
        const result = await persistInboundChannelMessage(db, connection, {
          provider: 'meta',
          externalMessageId: String(message.id),
          externalThreadId: from,
          from,
          to: metadata.display_phone_number,
          name: typeof profile?.name === 'string' ? profile.name : undefined,
          text: inboundText,
          contentType: ['image', 'document', 'audio', 'video'].includes(type) ? type as 'image' | 'document' | 'audio' | 'video' : 'text',
          occurredAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : undefined,
          payload: message,
        })

        // AI auto-reply for plain-text inbound, mirroring the Twilio
        // channel webhook. Awaited inside `after()` so Meta gets its 200
        // immediately while the LLM call finishes in the background.
        // `dispatchInboundToAiReply` owns its eligibility gates +
        // try/catch and never throws.
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
      }
    }
  }
  return NextResponse.json({ status: 'received' })
}

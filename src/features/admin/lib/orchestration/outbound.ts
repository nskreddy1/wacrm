import { createChannelAdapter } from '@/features/channels/lib/adapters'
import { sendMetaPayload, type MetaSendContext } from '@/features/channels/lib/adapters/meta'
import { channelAdmin } from '@/features/channels/lib/admin-client'
import type { OutboundMessagePayload } from '@/features/channels/lib/contracts'
import { decrypt } from '@/features/whatsapp/lib/encryption'
import {
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/features/whatsapp/lib/phone-utils'
import type { ChannelConnection, ContentType } from '@/types'

// ============================================================
// Unified outbound orchestrator.
//
// Single send path for every outbound message: dashboard reply,
// flow node, automation, AI reply, broadcast recipient.
//
// Resolution order:
//   1. conversation.channel_connection_id (pinned connection)
//   2. account's enabled WhatsApp channel_connection (primary first)
//   3. legacy `whatsapp_config` (accounts not yet migrated) — Meta direct
//
// The orchestrator owns persistence: `messages` row, conversation
// preview update, and contact phone auto-fix. Callers only build
// payloads. Phase 2 replaces the direct send with outbox enqueue.
// ============================================================

export interface SendChannelMessageArgs {
  accountId: string
  conversationId: string
  /** Optional — resolved from the conversation when omitted. */
  contactId?: string
  payload: OutboundMessagePayload
  senderType?: 'agent' | 'bot'
  /** Audit column (messages.sender_id) for agent sends. */
  senderUserId?: string
  aiGenerated?: boolean
  replyToExternalMessageId?: string
  /** Our messages.id of the reply target, persisted as reply_to_message_id. */
  replyToDbMessageId?: string
  /**
   * When true, template/interactive payloads on providers without native
   * support (anything non-Meta today) throw instead of degrading to the
   * preview text. Agent sends set this so the caller can 400; flow sends
   * keep the graceful degradation.
   */
  strictProviderSupport?: boolean
  /** Persisted messages.content_type override (defaults derived from payload). */
  contentTypeOverride?: ContentType
  /** Structured interactive payload persisted for inbox round-trip rendering. */
  interactivePersistPayload?: Record<string, unknown>
  idempotencyKey?: string
}

export interface SendChannelMessageResult {
  externalMessageId: string
  provider: string
  connectionId: string | null
}

function contentTypeFor(payload: OutboundMessagePayload): ContentType {
  switch (payload.kind) {
    case 'text':
      return 'text'
    case 'media':
      return payload.mediaKind as ContentType
    case 'interactive':
      return 'interactive' as ContentType
    case 'template':
    case 'email':
    default:
      return 'text'
  }
}

function previewTextFor(payload: OutboundMessagePayload): string {
  switch (payload.kind) {
    case 'text':
      return payload.text
    case 'media':
      return payload.caption?.trim() || `[${payload.mediaKind}]`
    case 'template':
      return `[template: ${payload.templateName}]`
    case 'interactive': {
      const body = (payload.interactive as { body?: { text?: string } }).body
      return body?.text ?? '[interactive]'
    }
    case 'email':
      return payload.subject
    default:
      return ''
  }
}

/** Legacy Meta-direct send with phone-variant retry (pre-channel_connections accounts). */
async function sendViaLegacyMetaConfig(
  args: SendChannelMessageArgs,
  contact: { id: string; phone: string },
): Promise<SendChannelMessageResult> {
  const db = channelAdmin()
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', args.accountId)
    .single()
  if (error || !config) throw new Error('WhatsApp is not configured for this account')

  const ctx: MetaSendContext = {
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) throw new Error(`contact phone invalid: ${contact.phone}`)

  const variants = phoneVariants(sanitized)
  const candidates = variants.length > 0 ? variants : [sanitized]
  let workingPhone = sanitized
  let externalMessageId = ''
  let lastError: unknown = null

  for (const variant of candidates) {
    try {
      externalMessageId = await sendMetaPayload(
        ctx,
        variant,
        args.payload,
        args.replyToExternalMessageId,
      )
      workingPhone = variant
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  // Persist the variant Meta actually accepted so future sends skip the retry.
  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  return { externalMessageId, provider: 'meta', connectionId: null }
}

async function sendViaConnection(
  args: SendChannelMessageArgs,
  connection: ChannelConnection,
  contact: { id: string; phone: string },
): Promise<SendChannelMessageResult> {
  const adapter = createChannelAdapter(connection.provider, connection.channel)
  const adapterSend = adapter?.send?.bind(adapter)
  if (!adapterSend) {
    throw new Error(`No adapter available for provider "${connection.provider}"`)
  }
  // Strict mode: refuse to silently degrade rich payloads on providers
  // without native support (message text matters — callers map it to 400).
  // Twilio WhatsApp DOES support templates natively via the Content API —
  // a template payload carrying a `contentSid` (HX…) passes through.
  // SMS never supports rich kinds: approved SMS templates are rendered
  // to plain text before they reach the orchestrator.
  const twilioNativeTemplate =
    connection.provider === 'twilio' &&
    connection.channel === 'whatsapp' &&
    args.payload.kind === 'template' &&
    !!args.payload.contentSid
  if (
    args.strictProviderSupport &&
    !(connection.provider === 'meta' && connection.channel === 'whatsapp') &&
    !twilioNativeTemplate &&
    (args.payload.kind === 'template' || args.payload.kind === 'interactive')
  ) {
    throw new Error(
      `${args.payload.kind} messages are not supported on the ${connection.channel} ${connection.provider} channel — send a text message instead.`,
    )
  }
  const sanitized = sanitizePhoneForMeta(contact.phone)
  const identity =
    connection.channel === 'whatsapp' || connection.channel === 'sms'
      ? connection.provider === 'meta'
        ? sanitized
        : `+${sanitized}`
      : contact.phone

  const result = await adapterSend({
    accountId: args.accountId,
    connection,
    recipient: { contactId: contact.id, identity },
    contentType: contentTypeFor(args.payload),
    payload: args.payload,
    // Legacy flat field: adapters without typed-payload support (e.g. Twilio
    // WhatsApp) degrade gracefully to the preview text.
    text: args.payload.kind === 'text' ? args.payload.text : previewTextFor(args.payload),
    mediaUrl: args.payload.kind === 'media' ? args.payload.url : undefined,
    replyToExternalMessageId: args.replyToExternalMessageId,
    idempotencyKey:
      args.idempotencyKey ?? `orch-${args.conversationId}-${Date.now()}`,
  })
  return {
    externalMessageId: result.externalMessageId,
    provider: connection.provider,
    connectionId: connection.id,
  }
}

/**
 * Send an outbound message through the correct channel connection and
 * persist it. The single entry point for all outbound messaging.
 */
export async function sendChannelMessage(
  args: SendChannelMessageArgs,
): Promise<
  SendChannelMessageResult & { dbMessageInserted: boolean; dbMessageId: string }
> {
  const db = channelAdmin()

  // 1. Conversation → contact + channel + pinned connection.
  const { data: conversation, error: convErr } = await db
    .from('conversations')
    .select('id, contact_id, channel, channel_connection_id')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (convErr || !conversation) throw new Error('conversation not found for this account')

  const contactId = args.contactId ?? conversation.contact_id
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) throw new Error('contact not found for this account')

  // 2. Resolve connection: pinned → enabled (primary first) → legacy config.
  let connection: ChannelConnection | null = null
  if (conversation.channel_connection_id) {
    const { data } = await db
      .from('channel_connections')
      .select('*')
      .eq('id', conversation.channel_connection_id)
      .eq('account_id', args.accountId)
      .eq('is_enabled', true)
      .maybeSingle()
    connection = (data as ChannelConnection | null) ?? null
  }
  // Fallback connection lookup honors the conversation's channel so
  // an SMS thread never sends through WhatsApp (and vice versa).
  const conversationChannel = (conversation.channel as ChannelConnection['channel']) ?? 'whatsapp'
  if (!connection) {
    const { data } = await db
      .from('channel_connections')
      .select('*')
      .eq('account_id', args.accountId)
      .eq('channel', conversationChannel)
      .eq('is_enabled', true)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle()
    connection = (data as ChannelConnection | null) ?? null
  }

  // 3. Send. The legacy Meta-config path only applies to WhatsApp —
  // SMS conversations require a Twilio SMS channel connection.
  if (!connection && conversationChannel !== 'whatsapp') {
    throw new Error(
      `No enabled ${conversationChannel} channel connection — connect one in Settings before sending.`,
    )
  }
  const result = connection
    ? await sendViaConnection(args, connection, contact as { id: string; phone: string })
    : await sendViaLegacyMetaConfig(args, contact as { id: string; phone: string })

  // 4. Persist message + conversation preview.
  const preview = previewTextFor(args.payload)
  const { data: insertedMessage, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      sender_type: args.senderType ?? 'bot',
      ...(args.senderUserId ? { sender_id: args.senderUserId } : {}),
      content_type: args.contentTypeOverride ?? contentTypeFor(args.payload),
      content_text:
        args.payload.kind === 'media' ? (args.payload.caption ?? null) : preview,
      ...(args.payload.kind === 'media' ? { media_url: args.payload.url } : {}),
      ...(args.payload.kind === 'template'
        ? { template_name: args.payload.templateName }
        : {}),
      ...(args.interactivePersistPayload
        ? { interactive_payload: args.interactivePersistPayload }
        : {}),
      ...(args.replyToDbMessageId
        ? { reply_to_message_id: args.replyToDbMessageId }
        : {}),
      message_id: result.externalMessageId,
      status: 'sent',
      ai_generated: args.aiGenerated ?? false,
    })
    .select('id')
    .single()
  if (msgErr || !insertedMessage) {
    // The provider accepted the message — surface the persistence failure
    // loudly but include the external id so callers can reconcile.
    throw new Error(
      `sent via ${result.provider} (${result.externalMessageId}) but DB insert failed: ${msgErr?.message ?? 'no row returned'}`,
    )
  }

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { ...result, dbMessageInserted: true, dbMessageId: insertedMessage.id as string }
}

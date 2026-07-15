import { decryptProviderCredentials } from '../credentials'
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelSendResult,
  OutboundChannelMessage,
  OutboundMessagePayload,
} from '../contracts'
import {
  sendMediaMessage,
  sendTextMessage,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { phoneVariants } from '@/lib/whatsapp/phone-utils'
import type { ChannelConnection } from '@/types'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

/** Meta rejects sends to numbers not in the allowed list (sandbox) or with
 *  formatting mismatches — error 131030. We retry across phone variants. */
function isRecipientVariantError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /131030|allowed list|recipient/i.test(message)
}

export interface MetaSendContext {
  phoneNumberId: string
  accessToken: string
}

function resolveSendContext(connection: ChannelConnection & { credentials_encrypted?: string }): MetaSendContext {
  const credentials = decryptProviderCredentials(connection)
  if (credentials.provider !== 'meta') throw new Error('Meta credentials required')
  const phoneNumberId =
    (connection.configuration?.phone_number_id as string | undefined) ??
    connection.external_account_id
  if (!phoneNumberId) throw new Error('Meta phone_number_id is not configured')
  return { phoneNumberId, accessToken: credentials.value.accessToken }
}

async function postMetaMessage(
  ctx: MetaSendContext,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(`${META_API_BASE}/${ctx.phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.accessToken}`,
    },
    body: JSON.stringify(body),
  })
  const data = (await response.json()) as {
    messages?: { id: string }[]
    error?: { message?: string; code?: number }
  }
  if (!response.ok || !data.messages?.[0]?.id) {
    throw new Error(
      data.error?.message ?? `Meta API error: ${response.status} (code ${data.error?.code ?? 'unknown'})`,
    )
  }
  return data.messages[0].id
}

/**
 * Send a typed payload to a specific number via Meta.
 * Exported so the orchestrator's legacy `whatsapp_config` fallback
 * (accounts not yet migrated to channel_connections) shares the exact
 * same send logic as the adapter path.
 */
export async function sendMetaPayload(
  ctx: MetaSendContext,
  to: string,
  payload: OutboundMessagePayload,
  replyToExternalMessageId?: string,
): Promise<string> {
  switch (payload.kind) {
    case 'text': {
      const result = await sendTextMessage({
        phoneNumberId: ctx.phoneNumberId,
        accessToken: ctx.accessToken,
        to,
        text: payload.text,
        contextMessageId: replyToExternalMessageId,
      })
      return result.messageId
    }
    case 'media': {
      const result = await sendMediaMessage({
        phoneNumberId: ctx.phoneNumberId,
        accessToken: ctx.accessToken,
        to,
        kind: payload.mediaKind,
        link: payload.url,
        caption: payload.caption,
        filename: payload.filename,
        contextMessageId: replyToExternalMessageId,
      })
      return result.messageId
    }
    case 'template':
      return postMetaMessage(ctx, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: payload.templateName,
          language: { code: payload.language },
          ...(payload.components ? { components: payload.components } : {}),
        },
      })
    case 'interactive':
      return postMetaMessage(ctx, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: payload.interactive,
      })
    case 'email':
      throw new Error('Meta WhatsApp adapter cannot send email payloads')
    default:
      throw new Error('Unsupported Meta payload kind')
  }
}

/** Derive a typed payload from legacy flat fields for backward compatibility. */
function derivePayload(message: OutboundChannelMessage): OutboundMessagePayload {
  if (message.payload) return message.payload
  if (message.mediaUrl) {
    return { kind: 'media', mediaKind: 'image', url: message.mediaUrl, caption: message.text }
  }
  return { kind: 'text', text: message.text ?? '' }
}

export class MetaWhatsAppAdapter implements ChannelAdapter {
  readonly provider = 'meta' as const
  readonly channel = 'whatsapp' as const
  readonly capabilities = {
    send: true,
    receive: true,
    healthCheck: true,
    oauth: false,
    testMessage: false,
  } as const

  async send(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    const ctx = resolveSendContext(message.connection)
    const payload = derivePayload(message)

    // Phone-variant retry: Meta can reject a valid number over formatting
    // differences (e.g. leading country-code zeros). Try each variant until
    // one is accepted; rethrow non-variant errors immediately.
    const variants = phoneVariants(message.recipient.identity)
    const candidates = variants.length > 0 ? variants : [message.recipient.identity]
    let lastError: unknown = null

    for (const variant of candidates) {
      try {
        const externalMessageId = await sendMetaPayload(
          ctx,
          variant,
          payload,
          message.replyToExternalMessageId,
        )
        return {
          externalMessageId,
          acceptedAt: new Date().toISOString(),
          providerPayload: { to: variant, payloadKind: payload.kind },
        }
      } catch (error) {
        lastError = error
        if (!isRecipientVariantError(error)) throw error
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Meta send failed for all phone variants')
  }

  async checkHealth(connection: ChannelConnection): Promise<ChannelHealth> {
    try {
      const ctx = resolveSendContext(connection)
      const info = await verifyPhoneNumber({
        phoneNumberId: ctx.phoneNumberId,
        accessToken: ctx.accessToken,
      })
      return { ok: Boolean(info), checkedAt: new Date().toISOString() }
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Meta health check failed',
      }
    }
  }
}

import { decryptProviderCredentials } from '../credentials'
import type {
  ChannelAdapter,
  ChannelHealth,
  ChannelSendResult,
  OutboundChannelMessage,
} from '../contracts'
import type { ChannelConnection } from '@/types'

function twilioAddress(value: string): string {
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`
}

/**
 * Public https base URL for Twilio delivery-status callbacks.
 * Skipped for local/preview hosts Twilio can't reach — sends still work,
 * they just don't get delivered/read receipts.
 */
function statusCallbackUrl(): string | null {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null)
  if (!base || !base.startsWith('https://') || base.includes('localhost')) return null
  return `${base.replace(/\/$/, '')}/api/channels/webhooks/twilio`
}

/** Twilio error payloads carry a numeric `code` (e.g. 63016) worth surfacing. */
export class TwilioSendError extends Error {
  constructor(
    message: string,
    readonly twilioCode?: number,
    readonly httpStatus?: number,
  ) {
    super(twilioCode ? `${message} (Twilio error ${twilioCode})` : message)
    this.name = 'TwilioSendError'
  }
}

export class TwilioWhatsAppAdapter implements ChannelAdapter {
  readonly provider = 'twilio' as const
  readonly channel = 'whatsapp' as const
  readonly capabilities = {
    send: true,
    receive: true,
    healthCheck: true,
    oauth: false,
    testMessage: false,
  } as const

  async send(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    const credentials = decryptProviderCredentials(message.connection)
    if (credentials.provider !== 'twilio') throw new Error('Twilio credentials required')
    const from = message.connection.external_identity
    if (!from) throw new Error('Twilio sender number is not configured')

    const body = new URLSearchParams({
      From: twilioAddress(from),
      To: twilioAddress(message.recipient.identity),
    })

    // Typed payload (preferred) → provider params. Falls back to the flat
    // legacy fields so pre-orchestrator callers keep working unchanged.
    const payload = message.payload
    switch (payload?.kind) {
      case 'text':
        body.set('Body', payload.text)
        break
      case 'media':
        body.set('MediaUrl', payload.url)
        if (payload.caption?.trim()) body.set('Body', payload.caption)
        break
      case 'template': {
        if (payload.contentSid) {
          // Twilio Content API template — works outside the 24h session
          // window (the WhatsApp business-initiated / template path).
          body.set('ContentSid', payload.contentSid)
          if (payload.contentVariables && Object.keys(payload.contentVariables).length > 0) {
            body.set('ContentVariables', JSON.stringify(payload.contentVariables))
          }
        } else {
          // No ContentSid — degrade to the preview text (only reachable for
          // non-strict callers; strict callers are rejected upstream).
          body.set('Body', message.text ?? `[template: ${payload.templateName}]`)
        }
        break
      }
      default:
        // Legacy flat fields / unsupported typed kinds (interactive, email).
        body.set('Body', message.text ?? '')
        if (message.mediaUrl) body.set('MediaUrl', message.mediaUrl)
        break
    }

    // Delivery tracking: queued → sent → delivered → read/failed callbacks
    // land on our shared Twilio webhook route.
    const callback = statusCallbackUrl()
    if (callback) body.set('StatusCallback', callback)

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.value.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.value.accountSid}:${credentials.value.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': message.idempotencyKey,
        },
        body,
      },
    )
    const result = (await response.json().catch(() => ({}))) as {
      sid?: string
      message?: string
      code?: number
    }
    if (!response.ok || !result.sid) {
      throw new TwilioSendError(
        result.message ?? `Twilio send failed (${response.status})`,
        result.code,
        response.status,
      )
    }
    return {
      externalMessageId: result.sid,
      acceptedAt: new Date().toISOString(),
      providerPayload: { sid: result.sid },
    }
  }

  async checkHealth(connection: ChannelConnection): Promise<ChannelHealth> {
    try {
      const credentials = decryptProviderCredentials(connection)
      if (credentials.provider !== 'twilio') throw new Error('Twilio credentials required')
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.value.accountSid)}.json`,
        { headers: { Authorization: `Basic ${Buffer.from(`${credentials.value.accountSid}:${credentials.value.authToken}`).toString('base64')}` } },
      )
      return { ok: response.ok, checkedAt: new Date().toISOString(), error: response.ok ? undefined : `Twilio returned ${response.status}` }
    } catch (error) {
      return { ok: false, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Twilio health check failed' }
    }
  }
}

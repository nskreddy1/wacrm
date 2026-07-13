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
      Body: message.text ?? '',
    })
    if (message.mediaUrl) body.set('MediaUrl', message.mediaUrl)

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
    const payload = (await response.json()) as { sid?: string; message?: string }
    if (!response.ok || !payload.sid) {
      throw new Error(payload.message ?? `Twilio send failed (${response.status})`)
    }
    return {
      externalMessageId: payload.sid,
      acceptedAt: new Date().toISOString(),
      providerPayload: { sid: payload.sid },
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

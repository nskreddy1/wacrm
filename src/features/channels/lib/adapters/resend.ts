import { decryptProviderCredentials } from '../credentials'
import type { ChannelAdapter, ChannelHealth, ChannelSendResult, OutboundChannelMessage } from '../contracts'
import type { ChannelConnection } from '@/types'

export class ResendEmailAdapter implements ChannelAdapter {
  readonly provider = 'resend' as const
  readonly channel = 'email' as const
  readonly capabilities = {
    send: true,
    receive: false,
    healthCheck: true,
    oauth: false,
    testMessage: true,
  } as const

  async send(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    const credentials = decryptProviderCredentials(message.connection)
    if (credentials.provider !== 'resend') throw new Error('Resend credentials required')
    const from = message.connection.external_identity
    if (!from) throw new Error('Resend sender identity is not configured')

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.value.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [message.recipient.identity],
        subject: message.subject ?? '(no subject)',
        text: message.text,
        html: message.html,
        headers: message.replyToExternalMessageId
          ? { 'In-Reply-To': message.replyToExternalMessageId }
          : undefined,
      }),
    })
    const payload = (await response.json()) as { id?: string; message?: string }
    if (!response.ok || !payload.id) {
      throw new Error(payload.message ?? `Resend send failed (${response.status})`)
    }
    return { externalMessageId: payload.id, acceptedAt: new Date().toISOString() }
  }

  async checkHealth(connection: ChannelConnection): Promise<ChannelHealth> {
    try {
      const credentials = decryptProviderCredentials(connection)
      if (credentials.provider !== 'resend') throw new Error('Resend credentials required')
      const response = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${credentials.value.apiKey}` },
      })
      return { ok: response.ok, checkedAt: new Date().toISOString(), error: response.ok ? undefined : `Resend returned ${response.status}` }
    } catch (error) {
      return { ok: false, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Resend health check failed' }
    }
  }
}

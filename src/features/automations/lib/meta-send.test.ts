import { beforeEach, describe, expect, it, vi } from 'vitest'

// The automation senders must route through the unified outbound
// orchestrator so accounts configured via channel_connections (e.g.
// Twilio WhatsApp) work — not only legacy Meta whatsapp_config rows.
vi.mock('@/features/admin/lib/orchestration/outbound', () => ({
  sendChannelMessage: vi.fn(async () => ({
    externalMessageId: 'ext-123',
    provider: 'twilio',
    connectionId: 'conn-1',
    dbMessageInserted: true,
    dbMessageId: 'db-1',
  })),
}))

import { sendChannelMessage } from '@/features/admin/lib/orchestration/outbound'
import { engineSendText, engineSendTemplate } from './meta-send'

const baseArgs = {
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
}

describe('automations meta-send (orchestrator wrapper)', () => {
  beforeEach(() => {
    vi.mocked(sendChannelMessage).mockClear()
  })

  it('engineSendText delegates to sendChannelMessage with a text payload', async () => {
    const result = await engineSendText({ ...baseArgs, text: 'hello' })

    expect(sendChannelMessage).toHaveBeenCalledTimes(1)
    expect(sendChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        payload: { kind: 'text', text: 'hello' },
        senderType: 'bot',
      }),
    )
    expect(result).toEqual({ whatsapp_message_id: 'ext-123' })
  })

  it('engineSendTemplate delegates to sendChannelMessage with a template payload', async () => {
    const result = await engineSendTemplate({
      ...baseArgs,
      templateName: 'welcome',
      language: 'en_US',
      params: ['Sunil'],
    })

    expect(sendChannelMessage).toHaveBeenCalledTimes(1)
    expect(sendChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        payload: expect.objectContaining({
          kind: 'template',
          templateName: 'welcome',
          language: 'en_US',
        }),
        senderType: 'bot',
      }),
    )
    expect(result).toEqual({ whatsapp_message_id: 'ext-123' })
  })
})

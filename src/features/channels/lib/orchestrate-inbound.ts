import { dispatchInboundToAiReply } from '@/features/assistant/lib/ai/auto-reply'
import { runAutomationsForTrigger } from '@/features/automations/lib/engine'
import { dispatchInboundToFlows } from '@/features/flows/lib/engine'

export interface OrchestrateInboundChannelMessageInput {
  accountId: string
  conversationId: string
  contactId: string
  externalMessageId: string
  text?: string
  contentType: 'text' | 'image' | 'document' | 'audio' | 'video'
  contactCreated: boolean
  isFirstInboundMessage: boolean
  configOwnerUserId: string
}

/**
 * Applies the provider-neutral inbound precedence contract:
 * deterministic Flow, then Automations, then eligible AI.
 *
 * This function is run from a provider route's `after()` callback and must
 * never reject, because downstream processing cannot change the provider ack.
 */
export async function orchestrateInboundChannelMessage(
  input: OrchestrateInboundChannelMessageInput,
): Promise<void> {
  try {
    const messageText = input.text ?? ''
    const flowResult = await dispatchInboundToFlows({
      accountId: input.accountId,
      userId: input.configOwnerUserId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      isFirstInboundMessage: input.isFirstInboundMessage,
      message: {
        kind: 'text',
        text: messageText,
        // Kept for persisted API compatibility; this may be a Meta or Twilio ID.
        meta_message_id: input.externalMessageId,
      },
    })

    if (flowResult.consumed) return

    const context = {
      message_text: messageText,
      conversation_id: input.conversationId,
    }
    await runAutomationsForTrigger({
      accountId: input.accountId,
      triggerType: 'new_message_received',
      contactId: input.contactId,
      context,
    })
    await runAutomationsForTrigger({
      accountId: input.accountId,
      triggerType: 'keyword_match',
      contactId: input.contactId,
      context,
    })

    if (input.contactCreated) {
      await runAutomationsForTrigger({
        accountId: input.accountId,
        triggerType: 'new_contact_created',
        contactId: input.contactId,
        context,
      })
    }
    if (input.isFirstInboundMessage) {
      await runAutomationsForTrigger({
        accountId: input.accountId,
        triggerType: 'first_inbound_message',
        contactId: input.contactId,
        context,
      })
    }

    if (input.contentType === 'text' && messageText.trim()) {
      await dispatchInboundToAiReply({
        accountId: input.accountId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        configOwnerUserId: input.configOwnerUserId,
      })
    }
  } catch (error) {
    console.error('[channel-inbound] orchestration failed:', error)
  }
}

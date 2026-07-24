import { dispatchInboundToAiReply } from '@/features/assistant/lib/ai/auto-reply';
import {
  dispatchEventToFlows,
  dispatchInboundToFlows,
} from '@/features/flows/lib/engine';

export interface OrchestrateInboundChannelMessageInput {
  accountId: string;
  conversationId: string;
  contactId: string;
  externalMessageId: string;
  text?: string;
  contentType: 'text' | 'image' | 'document' | 'audio' | 'video';
  contactCreated: boolean;
  isFirstInboundMessage: boolean;
  configOwnerUserId: string;
}

/**
 * Applies the provider-neutral inbound precedence contract:
 * deterministic Flow, then Automations, then eligible AI.
 *
 * This function is run from a provider route's `after()` callback and must
 * never reject, because downstream processing cannot change the provider ack.
 */
export async function orchestrateInboundChannelMessage(
  input: OrchestrateInboundChannelMessageInput
): Promise<void> {
  try {
    const messageText = input.text ?? '';
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
    });

    if (flowResult.consumed) return;

    // Workflows unification: inbound-driven triggers (keyword,
    // first_inbound_message, new_message_received) are all evaluated
    // inside dispatchInboundToFlows. The only event left to raise
    // here is contact creation, which starts event-triggered flows.
    if (input.contactCreated) {
      await dispatchEventToFlows({
        accountId: input.accountId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        event: { type: 'new_contact_created' },
        messageText,
      });
    }

    if (input.contentType === 'text' && messageText.trim()) {
      await dispatchInboundToAiReply({
        accountId: input.accountId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        configOwnerUserId: input.configOwnerUserId,
      });
    }
  } catch (error) {
    console.error('[channel-inbound] orchestration failed:', error);
  }
}

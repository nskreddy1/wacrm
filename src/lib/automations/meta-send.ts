import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from '@/lib/flows/meta-send'
import { sendChannelMessage } from '@/lib/orchestration/outbound'

// ------------------------------------------------------------
// Automation-side senders — thin wrappers over the unified
// outbound orchestrator (src/lib/orchestration/outbound.ts).
//
// The orchestrator owns connection resolution (channel_connections
// with legacy whatsapp_config fallback), phone-variant retry,
// account-scoped contact verification, message persistence
// (sender_type='bot'), and conversation preview updates. These
// wrappers only translate the automation engine's argument shapes
// into typed OutboundMessagePayload values, preserving the public
// function signatures the engine depends on.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + connection lookups
   *  so an automation authored by user A still sends through the
   *  WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the automation/flow — audit only, not tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  const result = await sendChannelMessage({
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: { kind: 'text', text: args.text },
    senderType: 'bot',
  })
  return { whatsapp_message_id: result.externalMessageId }
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  // Legacy body-only positional params → Meta components array. The
  // automation engine has no template row on hand, so this matches the
  // legacy sendTemplateMessage({ params }) behaviour exactly.
  const components =
    args.params && args.params.length > 0
      ? [
          {
            type: 'body',
            parameters: args.params.map((p) => ({ type: 'text', text: String(p) })),
          },
        ]
      : undefined

  const result = await sendChannelMessage({
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: {
      kind: 'template',
      templateName: args.templateName,
      language: args.language ?? 'en_US',
      components,
    },
    senderType: 'bot',
  })
  return { whatsapp_message_id: result.externalMessageId }
}

interface SendInteractiveArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  payload: InteractiveMessagePayload
}

/**
 * Send an interactive (reply-buttons or list) message from the
 * automation engine.
 *
 * Delegates to the Flows interactive senders
 * (`engineSendInteractiveButtons` / `engineSendInteractiveList`), which
 * already ride the orchestrator and persist `interactive_payload` +
 * `sender_type='bot'`. Both engines want identical behaviour here, so
 * there's one implementation rather than a second copy that could drift.
 */
export async function engineSendInteractive(
  args: SendInteractiveArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { payload, accountId, userId, conversationId, contactId } = args
  const common = { accountId, userId, conversationId, contactId }
  if (payload.kind === 'buttons') {
    return engineSendInteractiveButtons({
      ...common,
      bodyText: payload.body,
      headerText: payload.header,
      footerText: payload.footer,
      buttons: payload.buttons,
    })
  }
  return engineSendInteractiveList({
    ...common,
    bodyText: payload.body,
    buttonLabel: payload.button_label,
    headerText: payload.header,
    footerText: payload.footer,
    sections: payload.sections,
  })
}

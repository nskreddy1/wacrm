import type { InteractiveMessagePayload } from '@/features/whatsapp/lib/interactive'
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from '@/features/flows/lib/meta-send'
import { sendChannelMessage } from '@/features/admin/lib/orchestration/outbound'

// ------------------------------------------------------------
// Automation-side senders — thin wrappers over the unified outbound
// orchestrator (src/lib/orchestration/outbound.ts), mirroring the
// Flows-side wrappers in src/lib/flows/meta-send.ts.
//
// The orchestrator owns connection resolution (pinned connection →
// enabled channel_connections (e.g. Twilio WhatsApp, primary first) →
// legacy Meta whatsapp_config fallback), phone-variant retry, the
// `messages` insert (sender_type='bot'), and the conversation preview
// update. These wrappers only translate the automation engine's
// argument shapes into typed OutboundMessagePayload values, keeping
// the public signatures the engine depends on.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + connection lookups
   *  so an automation authored by user A still sends through the
   *  WhatsApp connection saved on the same account. */
  accountId: string
  /** Original author of the automation — audit only, not tenancy. */
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

/** Send a plain-text WhatsApp message from the automation engine. */
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

/** Send a template WhatsApp message from the automation engine. */
export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
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
      language: args.language || 'en_US',
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
 * already route through the orchestrator and persist the structured
 * `interactive_payload` with `sender_type='bot'`. Both engines want
 * identical behaviour here, so there's one implementation rather than
 * a second hand-rolled copy that could drift.
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

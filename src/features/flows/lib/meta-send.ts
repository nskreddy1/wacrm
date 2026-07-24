import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from '@/features/whatsapp/lib/meta-api';
import type { InteractiveMessagePayload } from '@/features/whatsapp/lib/interactive';
import { sendChannelMessage } from '@/features/admin/lib/orchestration/outbound';

// ------------------------------------------------------------
// Flows-side senders — thin wrappers over the unified outbound
// orchestrator (src/lib/orchestration/outbound.ts).
//
// The orchestrator owns connection resolution (channel_connections
// with legacy whatsapp_config fallback), phone-variant retry,
// message persistence, and conversation preview updates. These
// wrappers only translate the Flows engine's argument shapes into
// typed OutboundMessagePayload values, preserving the public
// function signatures the flow runner depends on.
// ------------------------------------------------------------

interface SendTextEngineArgs {
  /** Account-level tenancy key. */
  accountId: string;
  /** Original author of the flow — audit only, not tenancy. */
  userId: string;
  conversationId: string;
  contactId: string;
  text: string;
  /** Marks the persisted row `ai_generated = true` (auto-reply bot only). */
  aiGenerated?: boolean;
}

/** Send a plain-text WhatsApp message from the Flows engine. */
export async function engineSendText(
  args: SendTextEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendChannelMessage({
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: { kind: 'text', text: args.text },
    senderType: 'bot',
    aiGenerated: args.aiGenerated ?? false,
  });
  return { whatsapp_message_id: result.externalMessageId };
}

interface SendMediaEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  kind: MediaKind;
  /** Public URL the provider fetches at send time. */
  link: string;
  caption?: string;
  /** Document-only; ignored for image/video/audio. */
  filename?: string;
}

/** Send an image / video / document / audio from the Flows engine. */
export async function engineSendMedia(
  args: SendMediaEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  const result = await sendChannelMessage({
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: {
      kind: 'media',
      mediaKind: args.kind,
      url: args.link,
      caption: args.caption,
      filename: args.filename,
    },
    senderType: 'bot',
  });
  return { whatsapp_message_id: result.externalMessageId };
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  bodyText: string;
  buttons: InteractiveButton[];
  headerText?: string;
  footerText?: string;
}

interface SendInteractiveListEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  bodyText: string;
  buttonLabel: string;
  sections: InteractiveListSection[];
  headerText?: string;
  footerText?: string;
}

/** Build the raw Meta `interactive` object for a buttons message. */
function metaInteractiveButtons(
  input: SendInteractiveButtonsEngineArgs
): Record<string, unknown> {
  return {
    type: 'button',
    ...(input.headerText
      ? { header: { type: 'text', text: input.headerText } }
      : {}),
    body: { text: input.bodyText },
    ...(input.footerText ? { footer: { text: input.footerText } } : {}),
    action: {
      buttons: input.buttons.map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title },
      })),
    },
  };
}

/** Build the raw Meta `interactive` object for a list message. */
function metaInteractiveList(
  input: SendInteractiveListEngineArgs
): Record<string, unknown> {
  return {
    type: 'list',
    ...(input.headerText
      ? { header: { type: 'text', text: input.headerText } }
      : {}),
    body: { text: input.bodyText },
    ...(input.footerText ? { footer: { text: input.footerText } } : {}),
    action: {
      button: input.buttonLabel,
      sections: input.sections,
    },
  };
}

/**
 * Send an interactive-button WhatsApp message from the Flows engine.
 * Persists `content_type='interactive'` with the structured payload so the
 * inbox re-renders the buttons the bot sent (round-trip).
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  const persistPayload: InteractiveMessagePayload = {
    kind: 'buttons',
    body: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    buttons: args.buttons,
  };
  const result = await sendChannelMessage({
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: { kind: 'interactive', interactive: metaInteractiveButtons(args) },
    senderType: 'bot',
    interactivePersistPayload: persistPayload as unknown as Record<
      string,
      unknown
    >,
  });
  return { whatsapp_message_id: result.externalMessageId };
}

/**
 * Send an interactive-list WhatsApp message from the Flows engine.
 * Used when the flow needs more than 3 options (Meta's button cap).
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs
): Promise<{ whatsapp_message_id: string }> {
  const persistPayload: InteractiveMessagePayload = {
    kind: 'list',
    body: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    button_label: args.buttonLabel,
    sections: args.sections,
  };
  const result = await sendChannelMessage({
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    payload: { kind: 'interactive', interactive: metaInteractiveList(args) },
    senderType: 'bot',
    interactivePersistPayload: persistPayload as unknown as Record<
      string,
      unknown
    >,
  });
  return { whatsapp_message_id: result.externalMessageId };
}

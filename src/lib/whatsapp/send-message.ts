// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact (account-scoped, caller's client),
//   3. resolves the reply target + template row where relevant,
//   4. delegates the send + persistence to the unified outbound
//      orchestrator (`sendChannelMessage`), which owns connection
//      resolution (channel_connections → legacy whatsapp_config),
//      phone-variant retry, the `messages` insert, and the
//      conversation preview update,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  validateInteractivePayload,
  buildMetaInteractiveObject,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { buildSendComponents, type SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { OutboundMessagePayload } from '@/lib/channels/contracts';
import { sendChannelMessage } from '@/lib/orchestration/outbound';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import type { MediaKind } from '@/lib/whatsapp/meta-api';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } =
    params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped — via the CALLER's client so
  // RLS (dashboard) or account filters (v1) gate access before we hand
  // off to the service-role orchestrator.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // Resolve the reply target to its provider message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  // Build the typed payload for the orchestrator.
  let payload: OutboundMessagePayload;
  let interactivePersistPayload: Record<string, unknown> | undefined;

  if (messageType === 'template') {
    const structured = (templateMessageParams ?? undefined) as
      | SendTimeParams
      | undefined;
    let components: unknown[] | undefined;
    if (templateRow) {
      // Structured path: the full components array (header media, body,
      // URL/COPY_CODE buttons) is built from the local template row.
      const built = buildSendComponents(templateRow, {
        body: structured?.body ?? templateParams,
        headerText: structured?.headerText,
        headerMediaUrl: structured?.headerMediaUrl,
        headerMediaId: structured?.headerMediaId,
        buttonParams: structured?.buttonParams,
      });
      components = built.length > 0 ? built : undefined;
    } else if (templateParams && templateParams.length > 0) {
      // Legacy body-only path — no template row available.
      components = [
        {
          type: 'body',
          parameters: templateParams.map((p) => ({
            type: 'text',
            text: String(p),
          })),
        },
      ];
    }
    payload = {
      kind: 'template',
      templateName: templateName!,
      language: templateLanguage || 'en_US',
      components,
    };
  } else if (isMediaKind) {
    payload = {
      kind: 'media',
      mediaKind: messageType as MediaKind,
      url: mediaUrl!,
      caption: contentText || undefined,
      filename: filename || undefined,
    };
  } else if (messageType === 'interactive') {
    payload = {
      kind: 'interactive',
      interactive: buildMetaInteractiveObject(interactivePayload!),
    };
    interactivePersistPayload = interactivePayload as unknown as Record<
      string,
      unknown
    >;
  } else {
    payload = { kind: 'text', text: contentText! };
  }

  // Delegate to the unified outbound orchestrator: connection resolution
  // (channel_connections with legacy whatsapp_config fallback), phone-
  // variant retry + contact auto-fix, `messages` insert, and the
  // conversation preview update all live there.
  let result: Awaited<ReturnType<typeof sendChannelMessage>>;
  try {
    result = await sendChannelMessage({
      accountId,
      conversationId,
      contactId: contact.id,
      payload,
      senderType: 'agent',
      replyToExternalMessageId: contextMessageId,
      replyToDbMessageId: replyToMessageId || undefined,
      interactivePersistPayload,
      idempotencyKey: `msg-${conversationId}-${Date.now()}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown send error';
    if (/DB insert failed/i.test(message)) {
      // The provider accepted the message but persistence failed.
      throw new SendMessageError(
        'db_error',
        `Message sent but failed to save to DB: ${message}`,
        500
      );
    }
    if (/not supported on the .* provider/i.test(message)) {
      throw new SendMessageError('bad_request', message, 400);
    }
    if (/not configured/i.test(message)) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        'WhatsApp not configured. Please set up your WhatsApp integration first.',
        400
      );
    }
    console.error('[send-message] orchestrator send failed:', message);
    throw new SendMessageError(
      'provider_error',
      `Send failed: ${message}`,
      502
    );
  }

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return {
    messageId: result.dbMessageId,
    whatsappMessageId: result.externalMessageId,
  };
}

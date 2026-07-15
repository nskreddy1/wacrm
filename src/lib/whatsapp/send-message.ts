// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// This module is now a thin, caller-facing shell over the unified
// outbound orchestrator (src/lib/orchestration/outbound.ts):
//
//   1. validates the params for the message type (400s pre-DB),
//   2. loads the conversation + contact through the caller's
//      RLS-scoped client (tenancy + 404/400 semantics preserved),
//   3. resolves the reply target (Meta message_id + our DB id),
//   4. fetches the template row and pre-builds the typed payload
//      (template components / raw interactive object),
//   5. delegates the actual send + persistence to the orchestrator
//      with senderType 'agent', mapping its errors back onto
//      `SendMessageError` codes/statuses,
//   6. pauses any active Flow run for the contact (agent stepped in).
//
// The orchestrator owns connection resolution (pinned →
// channel_connections → legacy whatsapp_config), phone-variant retry,
// the `messages` insert, and the conversation preview update. It
// reloads the conversation/contact via its admin client — slightly
// redundant with step 2, but step 2 is what enforces RLS for the
// caller and keeps the pre-validation status codes exact.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  validateInteractivePayload,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import {
  buildSendComponents,
  type SendTimeParams,
} from '@/lib/whatsapp/template-send-builder';
import { sendChannelMessage } from '@/lib/orchestration/outbound';
import type { OutboundMessagePayload } from '@/lib/channels/contracts';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
} from '@/lib/whatsapp/phone-utils';
import type { ContentType, MessageTemplate } from '@/types';
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
  /** The provider's message id (Meta `wamid` / Twilio `sid`). */
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

/** Build the raw Meta `interactive` object from the structured payload. */
function buildRawInteractive(
  payload: InteractiveMessagePayload
): Record<string, unknown> {
  if (payload.kind === 'buttons') {
    return {
      type: 'button',
      ...(payload.header
        ? { header: { type: 'text', text: payload.header } }
        : {}),
      body: { text: payload.body },
      ...(payload.footer ? { footer: { text: payload.footer } } : {}),
      action: {
        buttons: payload.buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    };
  }
  return {
    type: 'list',
    ...(payload.header
      ? { header: { type: 'text', text: payload.header } }
      : {}),
    body: { text: payload.body },
    ...(payload.footer ? { footer: { text: payload.footer } } : {}),
    action: {
      button: payload.button_label,
      sections: payload.sections,
    },
  };
}

/** Map an orchestrator/provider error onto a `SendMessageError`. */
function toSendMessageError(err: unknown): SendMessageError {
  if (err instanceof SendMessageError) return err;
  const message = err instanceof Error ? err.message : 'Unknown send error';

  // Provider accepted the message but the `messages` insert failed.
  if (/DB insert failed/i.test(message)) {
    return new SendMessageError('db_error', message, 500);
  }
  // Rich payload on a provider without native support (strict mode).
  if (/not supported on the .+ provider/i.test(message)) {
    return new SendMessageError('bad_request', message, 400);
  }
  // No usable connection / legacy config for this account.
  if (/not configured|No adapter available/i.test(message)) {
    return new SendMessageError('whatsapp_not_configured', message, 400);
  }
  if (/not found for this account/i.test(message)) {
    return new SendMessageError('not_found', message, 404);
  }
  // Everything else is a provider-side failure.
  const code = /meta/i.test(message) ? 'meta_error' : 'provider_error';
  return new SendMessageError(code, message, 502);
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 * The actual send + persistence is delegated to the unified outbound
 * orchestrator (`sendChannelMessage`) with `senderType: 'agent'`.
 */
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

  // Conversation + contact through the caller's client (RLS enforced).
  // The orchestrator reloads these via its admin client — the redundancy
  // is deliberate: this lookup is what authorizes the caller and keeps
  // the 404/400 pre-validation semantics exact.
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

  // Pre-validate the phone here (the orchestrator validates too, but
  // deep in the send path where the failure surfaces as a 502) so a
  // malformed number still 400s.
  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // Resolve the reply target: its provider message_id (for the quote
  // context) and our DB id (persisted as reply_to_message_id). The
  // parent must belong to this same conversation — otherwise a caller
  // could quote messages they can't see by guessing UUIDs.
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
  if (messageType === 'template') {
    const structured = (templateMessageParams ?? undefined) as
      | SendTimeParams
      | undefined;
    let components: unknown[] | undefined;
    if (templateRow) {
      try {
        const built = buildSendComponents(templateRow, {
          // Legacy callers pass body values in `templateParams`; fold
          // them into `body` so the structured path covers them too.
          body: structured?.body ?? templateParams,
          headerText: structured?.headerText,
          headerMediaUrl: structured?.headerMediaUrl,
          headerMediaId: structured?.headerMediaId,
          buttonParams: structured?.buttonParams,
        });
        components = built.length > 0 ? built : undefined;
      } catch (err) {
        // Builder throws are caller-payload problems (missing variable
        // values etc.) — surface them as a 400, not a provider 502.
        throw new SendMessageError(
          'bad_request',
          err instanceof Error ? err.message : 'Invalid template parameters',
          400
        );
      }
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
      mediaKind: messageType as 'image' | 'video' | 'document' | 'audio',
      url: mediaUrl!,
      caption: contentText || undefined,
      filename: filename || undefined,
    };
  } else if (messageType === 'interactive') {
    payload = {
      kind: 'interactive',
      interactive: buildRawInteractive(interactivePayload!),
    };
  } else {
    payload = { kind: 'text', text: contentText! };
  }

  // Delegate the send + persistence to the unified orchestrator.
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
      strictProviderSupport: true,
      contentTypeOverride: messageType as ContentType,
      interactivePersistPayload:
        messageType === 'interactive'
          ? (interactivePayload as unknown as Record<string, unknown>)
          : undefined,
      idempotencyKey: `msg-${conversationId}-${Date.now()}`,
    });
  } catch (err) {
    const mapped = toSendMessageError(err);
    console.error('[send-message] orchestrator send failed:', mapped.message);
    throw mapped;
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

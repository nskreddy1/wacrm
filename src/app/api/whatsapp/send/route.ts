import { NextResponse } from 'next/server';
import {
  requirePermission,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { ensureConversationForContact } from '@/features/inbox/lib/ensure-conversation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/features/whatsapp/lib/send-message';
import { checkMonthlyQuota, consumeMonthlyQuota } from '@/lib/quotas';
import { quotaExceededResponse } from '@/lib/quotas/response';

// The dashboard's outbound-send endpoint. It owns auth, per-user rate
// limiting, and the two ways the UI targets a thread — an existing
// `conversation_id` (inbox) or a `contact_id` (Contact detail →
// find-or-create the conversation). The actual Meta plumbing (validate
// → send → persist → pause flows) lives in the shared
// `sendMessageToConversation` core, which the public `/api/v1/messages`
// endpoint reuses. This route is a thin adapter: resolve the
// conversation, delegate, then map `SendMessageError` back onto the
// dashboard's internal `{ error }` shape.
export async function POST(request: Request) {
  try {
    // ADR-006 C11: this is the dashboard's only outbound send path, so the
    // permission check belongs here rather than in the composer. A viewer
    // whose UI was bypassed (devtools, a stale bundle, a direct curl) now
    // gets a 403 instead of a delivered WhatsApp message. `requirePermission`
    // also resolves account_id, replacing this route's own profile lookup.
    const ctx = await requirePermission('messages:send');
    const { supabase, accountId } = ctx;

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = await checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    // Plan quota: monthly outbound message budget. Checked before any
    // side effects (find-or-create conversation) and consumed only
    // after the provider accepts the send, so failed sends don't burn
    // quota.
    const quota = await checkMonthlyQuota(accountId, 'messages_sent');
    if (!quota.allowed) {
      return quotaExceededResponse(quota, 'Monthly message');
    }

    const body = await request.json();
    const {
      // `conversation_id` targets an existing thread (inbox). `contact_id`
      // lets a caller initiate from a contact that may have no conversation
      // yet (Contact detail → Send template) — we find-or-create one below.
      conversation_id: conversationIdInput,
      contact_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      interactive_payload,
      reply_to_message_id,
    } = body;

    if ((!conversationIdInput && !contact_id) || !message_type) {
      return NextResponse.json(
        {
          error:
            'Either conversation_id or contact_id, plus message_type, are required',
        },
        { status: 400 }
      );
    }

    // Validate the message shape up front — before the contact_id path
    // finds-or-creates a conversation — so an invalid payload 400s
    // without leaving an orphan empty conversation behind.
    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        templateName: template_name,
        interactivePayload: interactive_payload,
      });
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        );
      }
      throw err;
    }

    // Resolve the target conversation. With `conversation_id` we load the
    // existing thread; with `contact_id` we find-or-create one for the
    // contact so a business-initiated template send (Contact detail view)
    // reuses the shared send core below.
    let conversationId: string | null = null;

    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .single();

      if (convError || !data) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        );
      }
      conversationId = data.id;
    } else {
      // contact_id path: shared with the inbox's New-conversation route so
      // both converge on one thread per contact (see ensure-conversation.ts).
      // It verifies contact→account ownership itself.
      const resolved = await ensureConversationForContact(
        supabase,
        accountId,
        ctx.userId,
        contact_id
      );
      if (!resolved.ok) {
        return resolved.reason === 'contact_not_found'
          ? NextResponse.json({ error: 'Contact not found' }, { status: 404 })
          : NextResponse.json(
              { error: 'Failed to open a conversation for this contact' },
              { status: 500 }
            );
      }
      conversationId = resolved.conversationId;
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Delegate to the shared send core (validates, sends to Meta with
    // phone-variant retry, persists, pauses active flow runs). Its
    // `SendMessageError` carries a machine code + HTTP status; the
    // dashboard maps it to the internal `{ error }` shape.
    try {
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        filename,
        templateName: template_name,
        templateLanguage: template_language,
        templateParams: template_params,
        templateMessageParams: template_message_params,
        interactivePayload: interactive_payload,
        replyToMessageId: reply_to_message_id,
      });

      // Meter only after Meta accepted the send (fire-and-forget —
      // metering loss must never fail a delivered message).
      void consumeMonthlyQuota(accountId, 'messages_sent');

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        // Additive (ADR-006 D13): the `contact_id` caller doesn't know
        // which conversation it just opened, because find-or-create ran
        // server-side. Returning it lets the inbox's New-message flow
        // select the new thread instead of making the agent hunt for it.
        conversation_id: conversationId,
      });
    } catch (err) {
      if (err instanceof SendMessageError) {
        // ADR-006 D4: the machine `code` travels with the message so the
        // composer can switch to the template path on `window_closed`
        // instead of showing a generic red toast.
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status }
        );
      }
      throw err;
    }
  } catch (error) {
    // `requirePermission` throws Unauthorized/Forbidden — map those to
    // 401/403 rather than burying an auth failure in a generic 500.
    return toErrorResponse(error);
  }
}

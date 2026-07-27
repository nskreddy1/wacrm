import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from '@/features/whatsapp/lib/phone-utils';
import { toE164 } from '@/lib/phone/e164';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';

export interface InboundChannelMessage {
  provider: 'meta' | 'twilio';
  externalMessageId: string;
  externalThreadId?: string;
  from: string;
  to: string;
  name?: string;
  text?: string;
  mediaUrl?: string;
  contentType?: 'text' | 'image' | 'document' | 'audio' | 'video';
  occurredAt?: string;
  payload: Record<string, unknown>;
}

interface ConnectionRow {
  id: string;
  account_id: string;
  created_by_user_id: string | null;
  external_identity: string | null;
  /**
   * Channel this connection serves ('whatsapp' | 'sms' | 'email').
   * Optional for backward compatibility — absent means 'whatsapp',
   * the only channel that existed before SMS support.
   */
  channel?: string | null;
}

export type PersistInboundChannelMessageResult =
  | { duplicate: true }
  | {
      duplicate: false;
      conversationId: string;
      contactId: string;
      contactCreated: boolean;
      isFirstInboundMessage: boolean;
    };

export async function persistInboundChannelMessage(
  db: SupabaseClient,
  connection: ConnectionRow,
  message: InboundChannelMessage
): Promise<PersistInboundChannelMessageResult> {
  // Phone-based channels share identity + threading logic; the
  // channel tag keeps SMS and WhatsApp conversations separate.
  const channel = connection.channel === 'sms' ? 'sms' : 'whatsapp';
  // `normalizedFrom` stays digits-only: it is the identity/threading key
  // that existing `contact_identities` and `conversations` rows are
  // matched on, so its shape must not change.
  const normalizedFrom = normalizePhone(message.from.replace(/^whatsapp:/, ''));
  // Providers send digits without a `+`, so a contact created here used to
  // be stored country-code-less (an Indian number landed as
  // `918328510888`) and then failed phone validation everywhere else.
  // Meta/Twilio always send full international digits, so `toE164` can
  // recover the country without guessing; if it somehow can't, fall back
  // to the digits rather than dropping the message.
  const displayFrom = toE164(message.from)?.e164 ?? normalizedFrom;
  const eventId = `${connection.id}:${message.externalMessageId}`;
  const { data: event, error: eventError } = await db
    .from('channel_webhook_events')
    .insert({
      account_id: connection.account_id,
      connection_id: connection.id,
      provider: message.provider,
      external_event_id: eventId,
      event_type: 'message.received',
      payload: message.payload,
      status: 'processing',
      attempts: 1,
    })
    .select('id')
    .single();

  if (eventError) {
    if (eventError.code === '23505') return { duplicate: true };
    throw eventError;
  }

  try {
    const ownerId =
      connection.created_by_user_id ??
      (await resolveAuditUserId(db, connection.account_id));
    let contactId: string;
    let contactCreated = false;
    const { data: identity } = await db
      .from('contact_identities')
      .select('contact_id')
      .eq('account_id', connection.account_id)
      .eq('channel', channel)
      .eq('normalized_identity', normalizedFrom)
      .maybeSingle();

    if (identity) {
      contactId = identity.contact_id;
    } else {
      // Match both shapes: contacts created before this normalization
      // landed are stored digits-only, new ones are stored as E.164.
      // Checking both keeps a returning sender from being duplicated.
      const phoneCandidates = [...new Set([displayFrom, normalizedFrom])];
      const { data: existing } = await db
        .from('contacts')
        .select('id')
        .eq('account_id', connection.account_id)
        .in('phone', phoneCandidates)
        .limit(1)
        .maybeSingle();
      if (existing) {
        contactId = existing.id;
      } else {
        const { data: created, error } = await db
          .from('contacts')
          .insert({
            account_id: connection.account_id,
            user_id: ownerId,
            phone: displayFrom,
            name: message.name || displayFrom,
            // First-touch attribution: this lead reached out to us on
            // this channel. Set once at creation, never overwritten.
            source: `${channel}_inbound`,
          })
          .select('id')
          .single();
        if (error) throw error;
        contactId = created.id;
        contactCreated = true;
      }
      const { error: identityError } = await db
        .from('contact_identities')
        .upsert(
          {
            account_id: connection.account_id,
            contact_id: contactId,
            channel,
            identity: message.from,
            normalized_identity: normalizedFrom,
            is_primary: true,
          },
          { onConflict: 'account_id,channel,normalized_identity' }
        );
      if (identityError) throw identityError;
    }

    const threadId = message.externalThreadId || normalizedFrom;
    let { data: conversation } = await db
      .from('conversations')
      .select('id, unread_count')
      .eq('channel_connection_id', connection.id)
      .eq('external_thread_id', threadId)
      .maybeSingle();

    if (!conversation) {
      const { data: created, error } = await db
        .from('conversations')
        .insert({
          account_id: connection.account_id,
          user_id: ownerId,
          contact_id: contactId,
          channel,
          channel_connection_id: connection.id,
          external_thread_id: threadId,
        })
        .select('id, unread_count')
        .single();
      if (error) throw error;
      conversation = created;
    }

    const { count: priorInboundCount, error: countError } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sender_type', 'customer');
    if (countError) throw countError;
    const isFirstInboundMessage = (priorInboundCount ?? 0) === 0;

    const timestamp = message.occurredAt || new Date().toISOString();
    const { error: messageError } = await db.from('messages').insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: message.contentType || 'text',
      content_text: message.text || null,
      media_url: message.mediaUrl || null,
      message_id: message.externalMessageId,
      external_message_id: message.externalMessageId,
      external_thread_id: threadId,
      channel_connection_id: connection.id,
      provider_payload: message.payload,
      status: 'delivered',
      created_at: timestamp,
    });
    if (messageError) throw messageError;

    const { error: conversationError } = await db
      .from('conversations')
      .update({
        last_message_text:
          message.text || `[${message.contentType || 'message'}]`,
        last_message_at: timestamp,
        unread_count: (conversation.unread_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id);
    if (conversationError) throw conversationError;

    await db
      .from('channel_webhook_events')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', event.id);
    return {
      duplicate: false,
      conversationId: conversation.id,
      contactId,
      contactCreated,
      isFirstInboundMessage,
    };
  } catch (error) {
    await db
      .from('channel_webhook_events')
      .update({
        status: 'failed',
        last_error:
          error instanceof Error
            ? error.message
            : 'Unknown inbound processing error',
      })
      .eq('id', event.id);
    throw error;
  }
}

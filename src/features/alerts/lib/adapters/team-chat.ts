import { supabaseAdmin } from '@/features/flows/lib/admin-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AlertAdapter,
  AlertDestination,
  AlertPayload,
  AlertSendResult,
} from '../types';

/**
 * Tier-1 adapter: posts the alert into the app's own team chat.
 *
 * This is the guaranteed-delivery tier. Every other adapter (Slack, WhatsApp,
 * Telegram, email) depends on an external connection the account may or may
 * not have configured — this one depends only on tables that exist for every
 * account. enqueueAlertDeliveries() auto-creates a team_chat destination per
 * account, so the team is notified even when nothing external is connected.
 * That is the product requirement: "if it's not connected, we should make
 * sure we get the notification."
 *
 * Mechanics worth knowing:
 * - `team_messages.sender_id` is NOT NULL -> auth.users, so a headless system
 *   post needs a real user. We use the account owner: every account has one
 *   (invariant since migration 017), and it keeps RLS/read paths untouched.
 * - The alert lands in a dedicated "Alerts" channel that this adapter creates
 *   idempotently on first use and keeps membership synced to all current
 *   account members, so nobody misses it for lack of an invite.
 * - We deliberately do NOT reuse the user-facing channel-creation API route:
 *   it authenticates a browser session; this runs from a cron with the
 *   service client. Same tables, shapes verified against the team_chat
 *   migration (20260723090000).
 */

const ALERTS_CHANNEL_NAME = 'Alerts';

async function ensureAlertsChannel(
  db: SupabaseClient,
  accountId: string
): Promise<{ conversationId: string; ownerId: string } | { error: string }> {
  // The owner doubles as channel creator and message sender.
  const { data: owner } = await db
    .from('profiles')
    .select('id')
    .eq('account_id', accountId)
    .eq('account_role', 'owner')
    .limit(1)
    .maybeSingle();

  if (!owner) return { error: 'account has no owner profile' };

  const { data: existing } = await db
    .from('team_conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('kind', 'channel')
    .eq('name', ALERTS_CHANNEL_NAME)
    .limit(1)
    .maybeSingle();

  let conversationId = existing?.id as string | undefined;

  if (!conversationId) {
    const { data: created, error: createError } = await db
      .from('team_conversations')
      .insert({
        account_id: accountId,
        kind: 'channel',
        name: ALERTS_CHANNEL_NAME,
        created_by: owner.id,
      })
      .select('id')
      .single();

    if (createError || !created) {
      // Race with a concurrent tick: re-read instead of failing the send.
      const { data: raced } = await db
        .from('team_conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('kind', 'channel')
        .eq('name', ALERTS_CHANNEL_NAME)
        .limit(1)
        .maybeSingle();
      if (!raced) {
        return { error: createError?.message ?? 'channel create failed' };
      }
      conversationId = raced.id;
    } else {
      conversationId = created.id;
    }
  }

  // Membership sync: everyone in the account belongs in #Alerts. Upsert is
  // idempotent on the (conversation_id, user_id) PK, so new teammates are
  // added on the next alert and existing rows are untouched.
  const { data: members } = await db
    .from('profiles')
    .select('id')
    .eq('account_id', accountId);

  if (members && members.length > 0) {
    await db.from('team_conversation_members').upsert(
      members.map((m: { id: string }) => ({
        conversation_id: conversationId,
        user_id: m.id,
      })),
      { onConflict: 'conversation_id,user_id', ignoreDuplicates: true }
    );
  }

  return { conversationId: conversationId!, ownerId: owner.id };
}

function formatBody(payload: AlertPayload): string {
  return [
    `[AI handoff] ${payload.title}`,
    payload.body,
    payload.url ? `Open: ${payload.url}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export const teamChatAlertAdapter: AlertAdapter = {
  provider: 'team_chat',

  async send(
    destination: AlertDestination,
    payload: AlertPayload
  ): Promise<AlertSendResult> {
    const db = supabaseAdmin();

    const channel = await ensureAlertsChannel(db, destination.account_id);
    if ('error' in channel) {
      // Misconfigured account (no owner) won't heal by retrying every minute.
      return { ok: false, retryable: false, error: channel.error };
    }

    const body = formatBody(payload);

    const { error } = await db.from('team_messages').insert({
      conversation_id: channel.conversationId,
      account_id: destination.account_id,
      sender_id: channel.ownerId,
      body,
    });

    if (error) {
      return { ok: false, retryable: true, error: error.message };
    }

    // Keep the conversation-list preview in sync (same denormalization the
    // user-facing send path maintains).
    await db
      .from('team_conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_text: body.slice(0, 140),
        updated_at: new Date().toISOString(),
      })
      .eq('id', channel.conversationId);

    return { ok: true };
  },
};

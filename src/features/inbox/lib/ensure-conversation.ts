// ============================================================
// Find-or-create the single conversation a contact owns (ADR-006 D13).
//
// Two entry points need this and they MUST agree, or an agent ends up
// looking at a different thread than the one their template landed in:
//
//   * POST /api/inbox/conversations — the inbox "New conversation"
//     picker. Opens the thread *before* anything is sent, so the agent
//     composes inside the real conversation rather than a modal.
//   * POST /api/whatsapp/send (contact_id path) — Contact detail →
//     "Send template", which has no thread open yet.
//
// The webhook's inbound writer does its own find-or-create against the
// same (account_id, contact_id) pair, so an outbound-first and an
// inbound-first sequence converge on one row either way.
//
// Runs under the CALLER's RLS client on purpose. `conversations_insert`
// requires account agent membership, so a viewer cannot manufacture a
// thread even if a bug let them reach this function — the database is
// the boundary, not the `requirePermission` call in the route above it.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Why a caller could not get a conversation. Distinguishes the two 404-ish
 *  cases so the route can say which one happened. */
export type EnsureConversationFailure = 'contact_not_found' | 'create_failed';

export type EnsureConversationResult =
  | { ok: true; conversationId: string; created: boolean }
  | { ok: false; reason: EnsureConversationFailure };

/**
 * Resolve (or open) the conversation for `contactId` in `accountId`.
 *
 * Verifies the contact belongs to the account first. Without that check a
 * caller could pass any UUID and — because the INSERT below supplies
 * `account_id` from the session rather than from the row it points at —
 * mint a conversation in their own account that references someone
 * else's contact, leaking that contact's name into their inbox.
 *
 * `created` is reported so the caller can tell "opened a brand-new cold
 * thread" (window is closed, template-only) from "you already had this
 * thread" (window may well be open). The composer derives the actual
 * window state from `last_inbound_at`, never from this flag — it is for
 * telemetry and copy, not policy.
 */
export async function ensureConversationForContact(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string
): Promise<EnsureConversationResult> {
  const { data: contactRow, error: contactErr } = await supabase
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (contactErr || !contactRow) {
    return { ok: false, reason: 'contact_not_found' };
  }

  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (existing) {
    return { ok: true, conversationId: existing.id as string, created: false };
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
    })
    .select('id')
    .single();

  if (error || !created) {
    // A unique violation here means a concurrent request (double-click on
    // the picker, or the webhook writing an inbound message at the same
    // moment) already created the row. Re-read instead of surfacing an
    // error — both callers want the conversation, not the race.
    const { data: raced } = await supabase
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle();

    if (raced) {
      return { ok: true, conversationId: raced.id as string, created: false };
    }

    console.error(
      '[ensure-conversation] failed to open conversation:',
      error?.message
    );
    return { ok: false, reason: 'create_failed' };
  }

  return { ok: true, conversationId: created.id as string, created: true };
}

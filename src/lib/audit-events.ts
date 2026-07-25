// ============================================================
// Tenant audit trail — write helper.
//
// Workspace-level "who did what, when": member changes, agent
// config edits, template lifecycle, broadcasts, channel changes.
// Mirrors the platform audit helper's contract (fire-and-forget:
// an audit failure is logged loudly but never blocks the action,
// because the mutation itself has already been committed).
//
// The `audit_events` table is append-only by RLS (INSERT+SELECT
// policies only; SELECT is admin+). The INSERT policy requires
// actor_id = auth.uid(), so entries can't be forged for someone
// else. When a route mutates via the service-role client, pass
// that client here too — but ALWAYS set actorId from the
// authenticated session, never from request input.
//
// meta is for small, PII-light context (names, counts, statuses).
// Never put message bodies, credentials, or full contact records
// in it.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEvent {
  accountId: string;
  /** auth.uid() of the member performing the action. */
  actorId: string;
  /** Denormalized display name/email so history survives departures. */
  actorLabel?: string | null;
  /** Machine key: 'member.invited', 'agent.updated', 'template.deleted', 'broadcast.sent', ... */
  action: string;
  /** Entity descriptor: 'ai_agent:<uuid>', 'template:<uuid>', ... */
  entity: string;
  /** Small, PII-light context. */
  meta?: Record<string, unknown> | null;
}

export async function logAuditEvent(
  supabase: SupabaseClient,
  event: AuditEvent
): Promise<void> {
  const { error } = await supabase.from('audit_events').insert({
    account_id: event.accountId,
    actor_id: event.actorId,
    actor_label: event.actorLabel ?? null,
    action: event.action,
    entity: event.entity,
    meta: event.meta ?? null,
  });
  if (error) {
    // Loud but non-fatal — see module comment.
    console.error(
      `[audit] failed to record ${event.action} on ${event.entity}:`,
      error
    );
  }
}

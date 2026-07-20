// ============================================================
// Platform audit log — write helper.
//
// Every super-admin mutation records an immutable entry in
// `platform_audit_log` (055_super_admin.sql). The table is
// insert-only by RLS (no UPDATE/DELETE policies exist), so this
// helper is deliberately fire-and-forget: an audit failure is
// logged loudly but never blocks the underlying action, because
// a half-failed mutation is worse for the operator than a
// missing audit row (the DB change itself is already committed).
//
// Call with whichever Supabase client performed the mutation:
//   - the SSR client from `requireSuperAdmin()` (RLS insert
//     policy: is_platform_super_admin() AND actor_id = auth.uid())
//   - or a service-role client (bypasses RLS) when the mutation
//     itself needed cross-tenant privileges.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PlatformAuditEntry {
  /** auth.uid() of the operator performing the action. */
  actorId: string;
  /** Affected tenant; null for platform-wide actions (flags etc). */
  accountId?: string | null;
  /** Machine-readable key, e.g. 'ticket.status_changed'. */
  action: string;
  /** Entity descriptor, e.g. 'support_ticket:<uuid>'. */
  entity: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export async function logPlatformAudit(
  supabase: SupabaseClient,
  entry: PlatformAuditEntry,
): Promise<void> {
  const { error } = await supabase.from('platform_audit_log').insert({
    actor_id: entry.actorId,
    account_id: entry.accountId ?? null,
    action: entry.action,
    entity: entry.entity,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
  if (error) {
    // Loud but non-fatal — see module comment.
    console.error(
      `[platform-audit] failed to record ${entry.action} on ${entry.entity}:`,
      error,
    );
  }
}

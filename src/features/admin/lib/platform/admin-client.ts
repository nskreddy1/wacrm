import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy, shared service-role client for platform-operator paths
// (super-admin console, support-ticket triage, compensating
// cleanups). Mirrors src/lib/ai/admin-client.ts and friends.
//
// SECURITY: every caller MUST sit behind `requireSuperAdmin()` or be
// a server-internal compensation step (e.g. rolling back a ticket
// shell after a failed message insert). Never expose query results
// from this client without explicitly scoping/filtering them first —
// it bypasses RLS entirely.
let _adminClient: SupabaseClient | null = null;

export function platformAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
      (process.env.SUPABASE_SERVICE_ROLE_KEY ??
        process.env.zepo_SUPABASE_SERVICE_ROLE_KEY ??
        process.env.zepo_SUPABASE_SECRET_KEY ??
        process.env.SUPABASE_SECRET_KEY)!
    );
  }
  return _adminClient;
}

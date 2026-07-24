import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy, shared service-role client for automation engine work.
// Mirrors the pattern used by the webhook handler
// (src/app/api/whatsapp/webhook/route.ts).
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
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

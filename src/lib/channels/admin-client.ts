import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let adminClient: SupabaseClient | null = null

export function channelAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)!,
      (process.env.SUPABASE_SERVICE_ROLE_KEY ??
        process.env.zepo_SUPABASE_SERVICE_ROLE_KEY ??
        process.env.zepo_SUPABASE_SECRET_KEY ??
        process.env.SUPABASE_SECRET_KEY)!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  }
  return adminClient
}

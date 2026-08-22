/**
 * Service-role client for channel adapters (WhatsApp, email providers).
 *
 * Of the four hand-rolled copies of this client, this was the only one
 * that passed `auth: { persistSession: false, autoRefreshToken: false }`.
 * That setting is now the shared default in `@/lib/supabase/admin`, which
 * is where the instance lives — so the other three paths inherit the fix
 * rather than each needing to remember it.
 *
 * `channelAdmin` is kept as the local name so existing call sites read
 * the same; it is an alias for the one shared client, not a second one.
 *
 * SECURITY: unchanged — this bypasses RLS. Channel adapters run behind
 * verified webhook signatures or an account-membership check, and every
 * query must still filter by `account_id`.
 */
export { supabaseAdmin as channelAdmin } from '@/lib/supabase/admin';

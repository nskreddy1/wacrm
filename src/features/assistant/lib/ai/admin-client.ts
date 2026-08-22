/**
 * Service-role client for the AI auto-reply path.
 *
 * The inbound WhatsApp webhook has no `auth.uid()` — there is no signed-in
 * user behind a customer's message — so the assistant reads channel
 * config and conversation state, and writes its reply, through the
 * service role.
 *
 * Previously this file built its own client from its own copy of the
 * env-var fallback chain, which meant the auto-reply path and the Flows
 * engine each held a separate pool for the same credential. The shared
 * instance now lives in `@/lib/supabase/admin`.
 *
 * SECURITY: unchanged — this bypasses RLS. The webhook's HMAC signature
 * is the authorization boundary, and every query must still filter by
 * `account_id`. Customer message text and retrieved knowledge-base
 * content remain data, never instructions.
 */
export { supabaseAdmin } from '@/lib/supabase/admin';

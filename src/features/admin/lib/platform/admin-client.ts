/**
 * Service-role client for platform-operator paths — the super-admin
 * console, support-ticket triage, and compensating cleanups (e.g. rolling
 * back a ticket shell after a failed message insert).
 *
 * The instance now lives in `@/lib/supabase/admin`; this file previously
 * held a fourth private copy of the same client and env-var chain.
 * `platformAdmin` is kept as the local name so call sites and the
 * security convention around them read unchanged.
 *
 * SECURITY: unchanged, and strictest here. Every caller MUST sit behind
 * `requireSuperAdmin()` or be a server-internal compensation step. This
 * client bypasses RLS entirely, so query results must be explicitly
 * scoped before they are returned to anyone.
 */
export { supabaseAdmin as platformAdmin } from '@/lib/supabase/admin';

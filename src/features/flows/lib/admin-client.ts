/**
 * Service-role client for the Flows engine.
 *
 * This file used to construct its own client with its own module-level
 * singleton and its own copy of the env-var fallback chain. Three other
 * features did the same, and the four copies had already drifted: only
 * the `channels` copy disabled session persistence, so a request that
 * touched both the Flows engine and the AI auto-reply path opened two
 * pools and left two refresh timers running for a static credential that
 * needs neither.
 *
 * It is now a re-export. The instance, its configuration, and the
 * environment names behind it live in `@/lib/supabase/admin`, so there is
 * one pool per process and one place to change.
 *
 * SECURITY: unchanged — this bypasses RLS. Flow runs are triggered by
 * verified webhooks and by authorized cron requests, and every query must
 * still filter by `account_id`.
 */
export { supabaseAdmin } from '@/lib/supabase/admin';

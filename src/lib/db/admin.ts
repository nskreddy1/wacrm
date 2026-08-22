/**
 * src/lib/db/admin.ts
 *
 * The SERVICE-ROLE query facade (ADR-002 Phase 1).
 *
 * Companion to ./session.ts. That file is for work the database
 * authorizes via `auth.uid()`; this one is for the paths where there is no
 * user to authorize against:
 *
 *   - inbound provider webhooks (the caller is Razorpay, not a person —
 *     the HMAC signature check on the route is the authorization boundary);
 *   - the reconciliation cron (the caller is the scheduler, authorized by
 *     `CRON_SECRET`);
 *   - audit-event writes, which must succeed even when the acting user
 *     could not read the row they just changed.
 *
 * This client BYPASSES RLS. That is the entire point of it and also its
 * danger, so two rules hold at every call site without exception:
 *
 *   1. It must sit behind an authorization boundary that is *not* RLS —
 *      a verified webhook signature, `CRON_SECRET`, or `requireRole()`.
 *   2. Every query must scope itself by `account_id` in the query text.
 *      With RLS switched off, that filter is the only thing standing
 *      between one tenant's money and another's.
 *
 * Why a facade rather than importing `@/lib/supabase/admin` directly: Rule
 * 5 of scripts/check-boundaries.mjs confines the supabase SDK to the
 * adapter layer so that call sites depend on a facade they can be migrated
 * off. `src/lib/db/` is that layer. Re-exporting here rather than wrapping
 * is deliberate — see the note in ./session.ts; an extra abstraction over
 * a money path is one more place a filter can be lost.
 */
export {
  supabaseAdmin as adminDb,
  hasServiceRoleConfig,
} from '@/lib/supabase/admin';

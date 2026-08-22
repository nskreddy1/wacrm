/**
 * src/lib/db/session.ts
 *
 * The RLS-SCOPED query facade (ADR-002 Phase 1).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `sql` FROM ./client
 * -----------------------------------------------------
 * `@/lib/db`'s `sql`/`withTransaction` talk to Postgres over postgres.js
 * with a pooled application role. That connection has no `auth.uid()`, so
 * every RLS policy in the schema evaluates against NULL and the row-level
 * checks silently pass nothing — or, on `USING (true)` tables, everything.
 * For most repositories that is fine, because they re-assert `account_id`
 * in the query text and sit behind an authorization check.
 *
 * The money path cannot use it. Billing reads and the cancellation RPCs
 * are authorized *by the database*: the RLS SELECT policies on
 * `subscriptions`, `payment_transactions` and `checkout_intents` are keyed
 * on account membership, and `request_subscription_cancellation()` /
 * `settle_subscription_cancel_request()` check owner-ness against
 * `auth.uid()` internally. Run those through a service-role or pooled
 * connection and the checks become no-ops — the strongest guarantee we
 * have on the money path would be deleted by a refactor that looks like
 * a cleanup.
 *
 * So the correct Phase 1 move for these call sites is NOT to convert them
 * to `sql`. It is to keep the caller's session client — the more secure
 * choice — while confining the supabase SDK to the adapter layer, which is
 * exactly what Rule 5 of scripts/check-boundaries.mjs asks for. Call sites
 * depend on `@/lib/db/session`; the SDK import lives here, inside the
 * allowlisted `src/lib/db/` directory.
 *
 * This is a re-export, not a wrapper: adding a query-shaped abstraction
 * over PostgREST would mean re-implementing `.from().select().eq()` badly,
 * and every layer of indirection on a money path is somewhere a filter can
 * be dropped. The boundary being enforced is "which module may import the
 * SDK", and that is satisfied by construction here.
 */
import { createClient } from '@/lib/supabase/server';

/**
 * The query client type callers annotate against.
 *
 * Exported from the facade so a call site never needs
 * `import type { SupabaseClient } from '@supabase/supabase-js'` either —
 * type imports are erased and therefore harmless, but sourcing the type
 * from here keeps the SDK's name out of feature code entirely, so the day
 * PostgREST is swapped out there is one place to change.
 */
export type SessionDb = Awaited<ReturnType<typeof createClient>>;

/**
 * A query client bound to the CALLER'S session, so RLS applies and
 * `auth.uid()` is the requesting user.
 *
 * Use this for anything the database itself authorizes. It cannot read
 * across accounts even if the calling code forgets an `account_id` filter,
 * which is the property that makes it the right client for billing.
 */
export async function sessionDb(): Promise<SessionDb> {
  return createClient();
}

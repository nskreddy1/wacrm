// ============================================================
// `subscriptions` / `payment_transactions` / `checkout_intents` reads
// for the billing screen (ADR-002 §A / ARCH-005).
//
// Every function here takes the CALLER'S session client. These tables
// have RLS SELECT policies keyed on account membership, and that is the
// authorization boundary for these reads — not the `.eq('account_id')`
// filter, which is defence in depth on top of it. Handing any of these
// the admin client would make `auth.uid()` NULL and turn the policy
// into a no-op while still returning plausible-looking data.
//
// The account id is always a parameter resolved from the session by the
// route. No function here accepts a subscription id, so "read someone
// else's subscription" is not a query this module can express (8.3, A5).
// ============================================================

import type { SessionDb } from './client';

/** How much ledger history the billing screen shows. */
export const LEDGER_LIMIT = 20;

/**
 * The account's current subscription.
 *
 * Explicit column list, never `select('*')`. `provider`, `environment`,
 * `provider_ref` and `provider_customer_ref` are deliberately withheld:
 * internal provider handles are useful to an attacker probing our
 * billing account and useless to the UI.
 */
export function findLatestSubscription(db: SessionDb, accountId: string) {
  return db
    .from('subscriptions')
    .select(
      'id, plan_id, status, interval, amount_minor, currency, current_period_end, cancel_at_period_end, cancel_request_status, cancel_requested_at, created_at'
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

/**
 * The money ledger, newest first.
 *
 * `occurred_at` leads the ordering with `nullsFirst: false` so rows the
 * provider has not timestamped sort after real events rather than
 * jumping to the top of a customer's financial history.
 */
export function listRecentTransactions(db: SessionDb, accountId: string) {
  return db
    .from('payment_transactions')
    .select('id, kind, amount_minor, currency, occurred_at, created_at')
    .eq('account_id', accountId)
    .order('occurred_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(LEDGER_LIMIT);
}

/**
 * A checkout still in flight, for the return page to poll (D9).
 *
 * Only journeys that could still complete. A `failed`/`abandoned` intent
 * is forensic evidence (7.8), not something the return page should keep
 * polling on.
 */
export function findPendingCheckout(db: SessionDb, accountId: string) {
  return db
    .from('checkout_intents')
    .select('id, plan_id, interval, amount_minor, currency, status, created_at')
    .eq('account_id', accountId)
    .in('status', ['created', 'provider_attached'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

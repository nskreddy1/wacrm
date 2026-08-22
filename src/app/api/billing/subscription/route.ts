// ============================================================
// GET/DELETE /api/billing/subscription — ADR-009 Task 8 (F9, F10).
//
// GET  — the account's current subscription, its money ledger and any
//        checkout still in flight. Poll target for the return page (D9).
// DELETE — records a cancellation REQUEST. Owner-only.
//
// THE RULE THIS ROUTE EXISTS TO ENFORCE (8.2): pressing "Cancel" is a
// REQUEST, not provider-verified state. This route therefore does NOT
// call `process_payment_event()` and touches no entitlement — not
// `accounts.plan_id`, not `subscriptions.status`, not
// `cancel_at_period_end`. Those move only when a signed provider event
// flows through the RPC (Task 9) or reconciliation observes the
// provider's own state (Task 10). If the provider silently fails to
// honour the request, reconciliation catches the divergence instead of
// us having already lied to the customer.
//
// Both handlers use the CALLER'S session client, never service role:
// every table read here has an RLS SELECT policy keyed on account
// membership, and the cancellation RPCs enforce owner-ness against
// `auth.uid()` internally. Service role would make `auth.uid()` NULL
// and turn those checks into no-ops.
//
// No client-supplied subscription id is accepted anywhere in this file
// (8.3, attack A5). The subscription is resolved from the session's
// account, so "cancel someone else's subscription" is not a request
// this API can express.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';

import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import { requestCancellation } from '@/features/billing/lib/cancel-subscription';
import {
  getPaymentProvider,
  hasPaymentsConfigured,
} from '@/features/billing/lib/provider-factory';
import {
  billingAdminDb,
  billingSessionDb,
} from '@/features/billing/repositories/client';
import { logAuditEvent } from '@/lib/audit-events';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/** How much ledger history the billing screen shows. */
const LEDGER_LIMIT = 20;

/**
 * Provider construction for a path that never prices anything.
 *
 * The factory requires a plan-ref resolver because checkout needs one.
 * Cancellation resolves no plans, so this throws rather than returning
 * a plausible-looking ref: if a future change makes the cancel path ask
 * for a provider plan id, that is a design question to answer
 * deliberately, not silently.
 */
function noPlanRefs(): never {
  throw new Error('the cancellation path must not resolve provider plan refs');
}

/**
 * 8.1 — current subscription + ledger + in-flight checkout, for the
 * session's account only.
 *
 * `admin` and above. The plan makes DELETE owner-only but does not fix a
 * role for GET; this is financial history (amounts charged, refunds,
 * chargebacks), so it sits with settings-level access rather than every
 * member. A member who only needs "which plan are we on" reads
 * `accounts.plan_id`, which carries no money.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const { accountId } = ctx;
  const db = await billingSessionDb();

  // Explicit column lists, never `select('*')`. `provider`,
  // `environment`, `provider_ref` and `provider_customer_ref` are
  // deliberately withheld: internal provider handles are useful to an
  // attacker probing our billing account and useless to the UI.
  const [subscriptionResult, ledgerResult, intentResult, plansResult] = await Promise.all([
    db
      .from('subscriptions')
      .select(
        'id, plan_id, status, interval, amount_minor, currency, current_period_end, cancel_at_period_end, cancel_request_status, cancel_requested_at, created_at'
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('payment_transactions')
      .select('id, kind, amount_minor, currency, occurred_at, created_at')
      .eq('account_id', accountId)
      .order('occurred_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(LEDGER_LIMIT),
    // Only journeys that could still complete. A `failed`/`abandoned`
    // intent is forensic evidence (7.8), not something the return page
    // should keep polling on.
    db
      .from('checkout_intents')
      .select('id, plan_id, interval, amount_minor, currency, status, created_at')
      .eq('account_id', accountId)
      .in('status', ['created', 'provider_attached'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The purchasable catalogue, for the plan picker (11.4/11.5).
    //
    // `plans` is global reference data with an RLS policy of
    // `USING (true)` for `authenticated`, so the session client reads
    // it without any service-role escalation.
    //
    // `provider_refs` is NOT selected. It holds our provider-side plan
    // handles, which the UI never needs and which are exactly what an
    // attacker probing our billing account would want. Prices are read
    // here for DISPLAY only — the amount actually charged is re-resolved
    // server-side from this same table by /api/billing/checkout (F1), so
    // a tampered client cannot turn a displayed number into a charge.
    db
      .from('plans')
      .select(
        'id, display_name, description, price_monthly, price_yearly, currency, features, badge, is_default, sort_order'
      )
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  const failure =
    subscriptionResult.error ??
    ledgerResult.error ??
    intentResult.error ??
    plansResult.error;
  if (failure) {
    console.error('[billing/subscription] read failed:', failure);
    return NextResponse.json(
      { error: 'internal_error', message: 'Could not load billing details.' },
      { status: 500 }
    );
  }

  const subscription = subscriptionResult.data;

  return NextResponse.json(
    {
      subscription: subscription
        ? {
            ...subscription,
            // Derived so the UI does not have to know the intent/state
            // split. True means "the customer has asked and we have not
            // seen the provider confirm it yet" — which is precisely
            // what "Cancellation requested" should mean on screen.
            cancellationPending:
              subscription.cancel_request_status === 'requested' ||
              subscription.cancel_request_status === 'provider_accepted',
          }
        : null,
      transactions: ledgerResult.data ?? [],
      pendingCheckout: intentResult.data ?? null,
      plans: plansResult.data ?? [],
      // D3 — whether self-serve purchase is possible AT ALL. The UI uses
      // this to choose between an Upgrade button and a "contact us"
      // message, so a workspace on a build with no provider credentials
      // is never shown a button that can only 503. This leaks no
      // configuration detail beyond "on or off": not the provider name,
      // not the environment, and no key material.
      paymentsEnabled: hasPaymentsConfigured(),
    },
    // Billing state is per-account and must never be shared by a cache.
    { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
  );
}

/**
 * 8.2 — record a cancellation request.
 *
 * Returns 200 with the pending state. The UI renders "Cancellation
 * requested — active until <period end>", which is the honest
 * description of what we actually know. Access is NOT revoked here:
 * reversible until period end, no immediate data loss (8.2).
 */
export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    // Owner-only, re-checked server-side. The RPCs check again in the
    // database; this is the fast path, not the authority.
    ctx = await requireRole('owner');
  } catch (err) {
    return toErrorResponse(err);
  }

  const { accountId, userId } = ctx;

  // Keyed on the ACCOUNT, not the IP: an attacker rotating IPs must not
  // get more attempts at an account's billing state, and every call
  // here reaches the provider's API.
  const limit = await checkRateLimit(
    `billing:cancel:${accountId}`,
    RATE_LIMITS.billingCancel
  );
  if (!limit.success) return rateLimitResponse(limit);

  // Any body is ignored entirely — see the module header (8.3). Reading
  // it would only create the temptation to honour a subscription id.
  void request;

  if (!hasPaymentsConfigured()) {
    return NextResponse.json(
      {
        error: 'payments_unavailable',
        message: 'Payments are not available right now. Please try again later.',
      },
      { status: 503 }
    );
  }

  const db = await billingSessionDb();
  const provider = getPaymentProvider({ resolveProviderPlanRef: noPlanRefs });

  let outcome;
  try {
    outcome = await requestCancellation(db, provider, accountId);
  } catch (err) {
    console.error('[billing/subscription] cancellation failed:', err);
    return NextResponse.json(
      {
        error: 'internal_error',
        message: 'We could not process the cancellation. Please try again.',
      },
      { status: 500 }
    );
  }

  switch (outcome.kind) {
    case 'no_subscription':
      return NextResponse.json(
        {
          error: 'no_subscription',
          message: 'There is no active subscription to cancel.',
        },
        { status: 404 }
      );

    case 'not_cancellable': {
      const message =
        outcome.reason === 'incomplete'
          ? 'That checkout was never completed, so there is nothing to cancel.'
          : 'This subscription is already in its final billing cycle and will end on its own.';
      return NextResponse.json(
        { error: 'not_cancellable', reason: outcome.reason, message },
        { status: 409 }
      );
    }

    case 'busy':
      return NextResponse.json(
        {
          error: 'cancellation_in_progress',
          message:
            'Another change to this subscription is still being processed. Please try again in a moment.',
        },
        { status: 409 }
      );

    case 'provider_failed':
      return NextResponse.json(
        { error: 'provider_error', message: outcome.detail },
        { status: 502 }
      );

    case 'unconfirmed':
      // 202: the request is recorded and may well have succeeded, but we
      // have not seen the provider confirm. Saying 200 would promise
      // more than we know; saying 500 would invite a retry that the
      // provider answers with a 400.
      void logAuditEvent(billingAdminDb(), {
        accountId,
        actorId: userId,
        action: 'billing.subscription.cancel_requested',
        entity: `subscription:${outcome.subscriptionId}`,
        meta: { providerAcknowledged: false },
      });
      return NextResponse.json(
        {
          status: 'cancellation_requested',
          providerAcknowledged: false,
          currentPeriodEnd: outcome.currentPeriodEnd,
          message:
            'Your cancellation request has been recorded and is being confirmed with the payment provider.',
        },
        { status: 202, headers: { 'Cache-Control': 'private, no-store' } }
      );

    case 'requested':
      void logAuditEvent(billingAdminDb(), {
        accountId,
        actorId: userId,
        action: 'billing.subscription.cancel_requested',
        entity: `subscription:${outcome.subscriptionId}`,
        meta: {
          providerAcknowledged: true,
          alreadyRequested: outcome.alreadyRequested,
        },
      });
      return NextResponse.json(
        {
          status: 'cancellation_requested',
          providerAcknowledged: true,
          alreadyRequested: outcome.alreadyRequested,
          currentPeriodEnd: outcome.currentPeriodEnd,
          // Deliberately does NOT claim the subscription is cancelled.
          // It stays active until the period end, and only a verified
          // provider event may say otherwise.
          message:
            'Cancellation requested. Your subscription stays active until the end of the current billing period.',
        },
        { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
      );
  }
}

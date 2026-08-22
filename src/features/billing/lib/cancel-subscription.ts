// ============================================================
// ADR-009 Task 8.2 — cancellation orchestration.
//
// Records a cancellation REQUEST and asks the provider to honour it.
// This module moves NO entitlement: it never calls
// `process_payment_event()`, never writes `status`,
// `cancel_at_period_end` or `plan_id`. It cannot — the two RPCs it
// calls are structurally limited to the intent columns
// (20260824130000).
//
// ORDERING: intent-first, inverting the literal step order of plan 8.2
// (provider first, then record). Razorpay's documented semantics force
// the inversion:
//
//   * "Once cancelled, you cannot renew or reactivate it." The action is
//     IRREVERSIBLE, so a provider call we fail to record can never be
//     compensated — unlike a dead checkout intent, which is harmless.
//   * Re-cancelling answers 400 "Subscription is not cancellable in
//     cancelled status", not 200. The endpoint is NOT idempotent, so a
//     blind retry cannot distinguish "we already did this" from a real
//     failure.
//
// Provider-first plus a crash in between therefore yields an
// irreversibly cancelling subscription with no local trace until
// reconciliation stumbles on it. Intent-first yields an honest
// `requested` row that Task 10 settles. See the migration header.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PaymentProvider } from '@/lib/ports/payment-provider';

/** The intent row as the RPC reports it. */
interface CancelRequestRow {
  subscription_id: string | null;
  provider: string | null;
  environment: string | null;
  provider_ref: string | null;
  status: string | null;
  current_period_end: string | null;
  cancel_request_status: string | null;
  cancel_requested_at: string | null;
  outcome:
    | 'opened'
    | 'already_accepted'
    | 'no_subscription'
    | 'not_cancellable';
}

/** What the caller should tell the customer. */
export type CancelOutcome =
  /** Request recorded and the provider acknowledged it. */
  | {
      kind: 'requested';
      subscriptionId: string;
      currentPeriodEnd: string | null;
      alreadyRequested: boolean;
    }
  /**
   * Request recorded; the provider's answer never arrived (timeout or
   * 5xx). We deliberately do NOT mark this `failed` — the cancellation
   * may well have landed, and claiming failure would invite a retry
   * that earns a 400. Reconciliation settles it.
   */
  | { kind: 'unconfirmed'; subscriptionId: string; currentPeriodEnd: string | null }
  /** No live subscription for this account. */
  | { kind: 'no_subscription' }
  /** A subscription exists but cannot be cancelled at the provider. */
  | { kind: 'not_cancellable'; reason: 'incomplete' | 'final_cycle' | 'no_billing_cycle' }
  /** Provider is mid-operation on this subscription; safe to retry. */
  | { kind: 'busy' }
  /** The provider definitively refused, and the request is marked failed. */
  | { kind: 'provider_failed'; detail: string };

/**
 * A provider error, structurally. Deliberately not `RazorpayApiError`:
 * the classification below keys on shape, so a second adapter throwing
 * the same shape is classified without touching this module.
 */
interface ProviderErrorShape {
  status?: number;
  ambiguous?: boolean;
  message: string;
}

function asProviderError(err: unknown): ProviderErrorShape | null {
  if (!(err instanceof Error)) return null;
  const candidate = err as Error & { status?: unknown; ambiguous?: unknown };
  return {
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
    ambiguous:
      typeof candidate.ambiguous === 'boolean' ? candidate.ambiguous : undefined,
    message: err.message,
  };
}

/**
 * Map a provider refusal onto our vocabulary.
 *
 * The strings come from Razorpay's documented error list for
 * `POST /subscriptions/:id/cancel`. Matching on the description is
 * unlovely but necessary: Razorpay returns the same
 * `BAD_REQUEST_ERROR` code for every one of these, so the code alone
 * cannot separate "already cancelled" (success, for our purposes) from
 * "final cycle" (a real refusal).
 */
function classify(
  err: ProviderErrorShape
): 'accepted' | 'busy' | 'final_cycle' | 'no_billing_cycle' | 'ambiguous' | 'failed' {
  // Never got an answer, or the provider had a bad day. The outcome is
  // genuinely unknown — do not guess.
  if (err.ambiguous === true) return 'ambiguous';
  if (err.status === 0 || err.status === 429) return 'ambiguous';
  if (typeof err.status === 'number' && err.status >= 500) return 'ambiguous';

  const message = err.message.toLowerCase();

  // Already cancelled at the provider. Our request is satisfied, so
  // this is `accepted`, not a failure — this is exactly the state a
  // crashed earlier attempt leaves behind, and treating it as failure
  // would strand the account in a permanent false `failed`.
  if (
    message.includes('not cancellable in cancelled status') ||
    message.includes('already been cancelled')
  ) {
    return 'accepted';
  }

  // Concurrent operation on the same subscription. Transient by
  // definition; the row lock makes this rare but the provider can also
  // be busy from a dashboard action.
  if (message.includes('another subscription operation is in progress')) {
    return 'busy';
  }

  // `cancel_at_cycle_end` cannot apply: the subscription is already in
  // its last cycle, so it ends on its own. Honest answer to the
  // customer, not a scary error.
  if (message.includes('final cycle')) return 'final_cycle';

  // No active billing cycle to cancel at the end of.
  if (message.includes('no billing cycle is going on')) return 'no_billing_cycle';

  return 'failed';
}

/**
 * Request cancellation of the account's live subscription.
 *
 * `db` MUST be a caller-session client, not a service-role client: the
 * RPCs enforce owner-ness against `auth.uid()` and fail closed when it
 * is NULL.
 *
 * The subscription is never named by the caller — it is resolved inside
 * the RPC from `accountId` (attack A5).
 */
export async function requestCancellation(
  db: SupabaseClient,
  provider: PaymentProvider,
  accountId: string
): Promise<CancelOutcome> {
  // 1. Record intent and take the row lock. Returns the provider handle
  //    we need, so there is no second read to race with.
  const { data, error } = await db.rpc('request_subscription_cancellation', {
    p_account_id: accountId,
  });

  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as CancelRequestRow | undefined;
  if (!row) return { kind: 'no_subscription' };

  if (row.outcome === 'no_subscription') return { kind: 'no_subscription' };
  if (row.outcome === 'not_cancellable') {
    return { kind: 'not_cancellable', reason: 'incomplete' };
  }

  const subscriptionId = row.subscription_id;
  const providerRef = row.provider_ref;
  if (!subscriptionId || !providerRef) {
    // The RPC promises these whenever a subscription was found. If that
    // ever stops being true, refuse rather than call the provider with
    // an undefined ref.
    throw new Error('cancellation intent row is missing its provider handle');
  }

  // Already acknowledged by the provider — do NOT call again. A second
  // cancel earns a 400 and would log a spurious failure.
  if (row.outcome === 'already_accepted') {
    return {
      kind: 'requested',
      subscriptionId,
      currentPeriodEnd: row.current_period_end,
      alreadyRequested: true,
    };
  }

  // 2. Refuse to act across an environment or provider boundary. A
  //    subscription created against test keys must never be actioned
  //    with live credentials, and vice versa (A24): the ref would
  //    either 404 or, worse, match an unrelated live subscription.
  if (row.provider !== provider.id || row.environment !== provider.environment) {
    return {
      kind: 'provider_failed',
      detail: 'subscription belongs to a different provider or environment',
    };
  }

  // 3. Ask the provider. Everything below is about recording the answer
  //    honestly, including "we don't know".
  try {
    await provider.cancelAtPeriodEnd(providerRef);
  } catch (err) {
    const shaped = asProviderError(err);
    const verdict = shaped ? classify(shaped) : 'failed';

    if (verdict === 'accepted') {
      await settle(db, accountId, subscriptionId, 'provider_accepted');
      return {
        kind: 'requested',
        subscriptionId,
        currentPeriodEnd: row.current_period_end,
        alreadyRequested: true,
      };
    }

    if (verdict === 'ambiguous' || verdict === 'busy') {
      // Leave the request `requested`. It is the truthful state and the
      // one reconciliation knows how to finish.
      console.warn(
        '[billing/cancel] provider outcome unresolved',
        JSON.stringify({
          accountId,
          subscriptionId,
          verdict,
          status: shaped?.status,
        })
      );
      return verdict === 'busy'
        ? { kind: 'busy' }
        : {
            kind: 'unconfirmed',
            subscriptionId,
            currentPeriodEnd: row.current_period_end,
          };
    }

    // Terminal refusal. Mark it so the UI stops promising a
    // cancellation that will never come.
    await settle(db, accountId, subscriptionId, 'failed');

    if (verdict === 'final_cycle' || verdict === 'no_billing_cycle') {
      return { kind: 'not_cancellable', reason: verdict };
    }

    console.error(
      '[billing/cancel] provider refused cancellation',
      JSON.stringify({ accountId, subscriptionId, status: shaped?.status })
    );
    return {
      kind: 'provider_failed',
      detail: 'the payment provider refused the cancellation request',
    };
  }

  // 4. Provider acknowledged. This records that it ACKNOWLEDGED — not
  //    that the subscription is cancelled. Entitlement still waits for
  //    the signed webhook.
  await settle(db, accountId, subscriptionId, 'provider_accepted');

  return {
    kind: 'requested',
    subscriptionId,
    currentPeriodEnd: row.current_period_end,
    alreadyRequested: false,
  };
}

/**
 * Settle the open request. A failure here is logged and swallowed: the
 * provider has already been told, and throwing would answer 5xx to a
 * customer whose cancellation actually succeeded. The row stays
 * `requested`, which reconciliation resolves.
 */
async function settle(
  db: SupabaseClient,
  accountId: string,
  subscriptionId: string,
  outcome: 'provider_accepted' | 'failed'
): Promise<void> {
  const { error } = await db.rpc('settle_subscription_cancel_request', {
    p_account_id: accountId,
    p_subscription_id: subscriptionId,
    p_outcome: outcome,
  });
  if (error) {
    console.error(
      '[billing/cancel] could not settle cancellation request',
      JSON.stringify({ accountId, subscriptionId, outcome, error: error.message })
    );
  }
}

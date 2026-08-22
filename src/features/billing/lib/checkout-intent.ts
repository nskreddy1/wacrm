// ============================================================
// Intent-first checkout orchestration (ADR-009 Task 7.6).
//
// The ordering here is the whole point of this module, so it is stated
// before any code:
//
//   1. INSERT checkout_intents (server-resolved price)   ← we own the journey
//   2. call the provider
//   3. UPDATE the intent with provider_ref, then INSERT subscriptions
//
// The obvious ordering — call the provider, then write what came back —
// has a crash window that cannot be repaired by anything local:
//
//   provider creates a real, billable subscription
//     → our process dies before we write a row
//     → the webhook arrives carrying a provider_ref matching nothing
//     → a PAYING CUSTOMER IS UNRESOLVABLE.
//
// With intent-first, there is always a local row written BEFORE the
// provider is reachable, so the webhook has something to resolve
// against: `subscriptions.provider_ref`, else
// `checkout_intents.provider_ref`, else the intent id the adapter echoed
// into provider `notes`. Three fallbacks, all of them rows WE wrote.
//
// CONCURRENCY (attack A7). We never "check for an open intent, then
// insert" — those two statements have a window between them, and losing
// that window means the customer gets two real provider subscriptions
// and two charges, which no local constraint can undo afterwards. We
// INSERT unconditionally and let the partial unique index
// `checkout_intents_one_open_per_account` arbitrate. Exactly one caller
// wins; the loser resumes the winner's journey or is told to wait.
//
// PRIVILEGE. `checkout_intents` has RLS with SELECT policies and no
// write policies at all, so these writes go through the service-role
// client. That bypasses RLS, which means account scoping stops being
// automatic and becomes this module's job: every statement below filters
// on `account_id` explicitly, including the ones that already filter on
// a primary key.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  BillingInterval,
  CheckoutHandle,
  PaymentProvider,
} from '@/lib/ports/payment-provider';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/** The statuses the one-open-intent-per-account index covers. */
const OPEN_STATUSES = ['created', 'provider_attached'] as const;

/**
 * Insert attempts before giving up.
 *
 * A retry is only needed for a genuinely rare interleaving: we lose the
 * unique-violation race, and by the time we re-read, the incumbent
 * intent has already left the open set (completed or failed). Two
 * attempts is enough for that; a loop that kept trying would be a way to
 * spin against a busy account rather than a way to succeed.
 */
const MAX_ARBITRATION_ATTEMPTS = 2;

export interface StartCheckoutParams {
  readonly accountId: string;
  readonly userId: string;
  readonly planId: string;
  readonly interval: BillingInterval;
  /** Server-resolved, from `plans`. NEVER from a request body (F1). */
  readonly amountMinor: number;
  readonly currency: string;
}

export type StartCheckoutOutcome =
  /** A new journey. `handle` is fresh from the provider. */
  | {
      readonly kind: 'created';
      readonly intentId: string;
      readonly handle: CheckoutHandle;
    }
  /**
   * We lost the A7 race to an intent that already has a provider handle,
   * so the caller resumes THAT journey. Notably this does not call the
   * provider — a second provider call is precisely the double-charge the
   * arbitrating index exists to prevent.
   */
  | {
      readonly kind: 'resumed';
      readonly intentId: string;
      readonly handle: CheckoutHandle;
    }
  /**
   * We lost the race to an intent that has not reached the provider yet.
   * There is no handle to hand back and we must not create one, so the
   * caller reports 409 and the client retries.
   */
  | { readonly kind: 'in_progress'; readonly intentId: string | null };

/**
 * Begin (or resume) a checkout journey.
 *
 * @param db  MUST be the service-role client — see the privilege note at
 *   the top of this file. Account scoping is enforced per-statement.
 * @throws Whatever the provider adapter throws. The intent is marked
 *   `failed` first, so a provider outage leaves a dead row rather than
 *   an account that can never check out again.
 */
export async function startCheckout(
  db: SupabaseClient,
  provider: PaymentProvider,
  params: StartCheckoutParams
): Promise<StartCheckoutOutcome> {
  for (let attempt = 1; attempt <= MAX_ARBITRATION_ATTEMPTS; attempt += 1) {
    const inserted = await db
      .from('checkout_intents')
      .insert({
        account_id: params.accountId,
        plan_id: params.planId,
        interval: params.interval,
        provider: provider.id,
        // Stamped from the CONFIGURED environment, never inferred later.
        // The RPC's environment gate can only reject on a stored value.
        environment: provider.environment,
        amount_minor: params.amountMinor,
        currency: params.currency,
        status: 'created',
        created_by: params.userId,
      })
      .select('id')
      .single();

    if (!inserted.error && inserted.data) {
      return attachProvider(db, provider, params, inserted.data.id as string);
    }

    // Any error that is NOT the arbitration we asked for is a real
    // failure. Nothing has been sent to the provider, so failing here
    // costs the user a retry and nothing else.
    if (inserted.error?.code !== UNIQUE_VIOLATION) {
      throw new Error(
        `checkout_intents insert failed: ${inserted.error?.message ?? 'unknown error'}`
      );
    }

    // We lost. Read the incumbent — scoped to this account, because the
    // service-role client gives us no scoping for free.
    const existing = await db
      .from('checkout_intents')
      .select(
        'id, status, provider_ref, provider_customer_ref, provider_authorize_url'
      )
      .eq('account_id', params.accountId)
      .in('status', OPEN_STATUSES)
      .maybeSingle();

    if (existing.error) {
      throw new Error(
        `checkout_intents read-back failed: ${existing.error.message}`
      );
    }

    // The incumbent left the open set between the violation and this
    // read. The index is free again; try once more.
    if (!existing.data) continue;

    const row = existing.data as {
      id: string;
      provider_ref: string | null;
      provider_customer_ref: string | null;
      provider_authorize_url: string | null;
    };

    // Resume only when we have BOTH halves of a usable handle. A
    // provider_ref with no authorize URL cannot be resumed and must not
    // be papered over by constructing a URL from a template — the URL is
    // read back from the provider or it does not exist.
    if (row.provider_ref && row.provider_authorize_url) {
      return {
        kind: 'resumed',
        intentId: row.id,
        handle: {
          providerRef: row.provider_ref,
          authorizeUrl: row.provider_authorize_url,
          ...(row.provider_customer_ref
            ? { customerRef: row.provider_customer_ref }
            : {}),
        },
      };
    }

    return { kind: 'in_progress', intentId: row.id };
  }

  // Attempts exhausted: intents kept opening and closing underneath us.
  // Reporting "in progress" with no id is honest — there is contention,
  // and we decline to create a second provider journey to resolve it.
  return { kind: 'in_progress', intentId: null };
}

/**
 * Steps 2–3: call the provider, then record what it returned.
 *
 * The error handling either side of the provider call is deliberately
 * asymmetric, and that asymmetry is the safety property:
 *
 *   BEFORE the provider confirms — nothing is billable, so a failure
 *   marks the intent `failed` and propagates.
 *
 *   AFTER the provider confirms — a real, billable subscription exists.
 *   A local write failure here must NOT mark the intent failed and must
 *   NOT fail the request, because both would strand a customer who is
 *   about to be charged. We log loudly and return the handle; the
 *   webhook still resolves the tenant through the `notes` correlation
 *   locator, and the reconciliation cron repairs the row.
 */
async function attachProvider(
  db: SupabaseClient,
  provider: PaymentProvider,
  params: StartCheckoutParams,
  intentId: string
): Promise<StartCheckoutOutcome> {
  let handle: CheckoutHandle;
  try {
    handle = await provider.createCheckout({
      intentId,
      accountId: params.accountId,
      planId: params.planId,
      interval: params.interval,
      amountMinor: params.amountMinor,
      currency: params.currency,
    });
  } catch (error) {
    await markIntentFailed(db, intentId, params.accountId);
    throw error;
  }

  // ---- Past this line, money is real. Never throw. ----

  const attached = await db
    .from('checkout_intents')
    .update({
      provider_ref: handle.providerRef,
      provider_customer_ref: handle.customerRef ?? null,
      provider_authorize_url: handle.authorizeUrl,
      status: 'provider_attached',
      updated_at: new Date().toISOString(),
    })
    .eq('id', intentId)
    .eq('account_id', params.accountId)
    // Only advance from `created`. If something else already moved this
    // intent on, that write wins and we do not clobber it.
    .eq('status', 'created');

  if (attached.error) {
    console.error(
      '[billing.checkout] provider journey created but intent update failed',
      {
        intentId,
        accountId: params.accountId,
        provider: provider.id,
        environment: provider.environment,
        // The ref is ours and non-secret; it is the only thing that makes
        // this line actionable during an incident.
        providerRef: handle.providerRef,
        error: attached.error.message,
      }
    );
  }

  // Idempotent by `UNIQUE (provider, environment, provider_ref)`, so a
  // double submit or a provider retry cannot fork the journey into two
  // subscription rows.
  const subscription = await db.from('subscriptions').upsert(
    {
      account_id: params.accountId,
      plan_id: params.planId,
      provider: provider.id,
      environment: provider.environment,
      provider_ref: handle.providerRef,
      // `incomplete` grants nothing. Entitlement moves only when
      // process_payment_event() applies a verified provider event.
      status: 'incomplete',
      interval: params.interval,
      amount_minor: params.amountMinor,
      currency: params.currency,
      checkout_intent_id: intentId,
    },
    { onConflict: 'provider,environment,provider_ref', ignoreDuplicates: true }
  );

  if (subscription.error) {
    console.error(
      '[billing.checkout] provider journey created but subscription insert failed',
      {
        intentId,
        accountId: params.accountId,
        provider: provider.id,
        environment: provider.environment,
        providerRef: handle.providerRef,
        error: subscription.error.message,
      }
    );
  }

  return { kind: 'created', intentId, handle };
}

/**
 * Mark a pre-provider intent dead so the account is not locked out of
 * checkout by the one-open-intent index until the 24h sweep.
 *
 * Best-effort by design: it runs on a path that is already failing, and
 * its own failure must not replace the original error — that error is
 * the one that explains what happened.
 */
async function markIntentFailed(
  db: SupabaseClient,
  intentId: string,
  accountId: string
): Promise<void> {
  const { error } = await db
    .from('checkout_intents')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', intentId)
    .eq('account_id', accountId)
    // Guard against the case this function must never touch: an intent
    // that already reached the provider. Only a `created` intent is
    // provably non-billable.
    .eq('status', 'created');

  if (error) {
    console.error('[billing.checkout] failed to mark intent failed', {
      intentId,
      accountId,
      error: error.message,
    });
  }
}

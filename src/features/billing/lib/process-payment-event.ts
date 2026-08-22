/**
 * The ONE way provider-derived billing state is written (ADR-009/Task 4.5).
 *
 * This module is the only place in the codebase allowed to name
 * `process_payment_event`, and it makes exactly ONE `supabase.rpc(...)`
 * call and no other write.
 *
 * WHY IT IS ONE CALL AND NOT TWO
 * Two `supabase-js` calls are TWO transactions — Supabase's own docs are
 * explicit that separate client queries are not grouped. So the event
 * claim and the state application cannot be sequenced here; they are one
 * database function. A future
 *
 *     from('payment_events').insert(...)   // ← then rpc('apply_...')
 *
 * anywhere in a route is a regression: it would satisfy the invariant on
 * paper while breaking it in fact, because a crash between the two calls
 * commits the claim and loses the effect. The provider then never
 * retries and every redelivery reads as `already_processed` — the event
 * becomes permanently unapplicable (attack A21).
 *
 * FAIL CLOSED, DELIBERATELY
 * On any error this THROWS so the caller answers 5xx and the provider
 * redelivers. That is the exact inverse of `IngressDedupeStore.claim()`,
 * which fails open so a Redis blip cannot drop a customer's WhatsApp
 * message. Both are correct: dropping a message costs a conversation,
 * dropping a payment costs a customer their paid access, and the
 * provider is holding a 24-hour retry budget that we want it to spend.
 * Do not "harmonise" the two policies.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  PaymentEnvironment,
  PaymentEvent,
} from '@/lib/ports/payment-provider';

/**
 * Every committed outcome the RPC can report. All of them are HTTP 200:
 * the transaction committed and the provider must stop retrying.
 *
 * There is no `failed_retryable` member, and adding one would be a bug.
 * A retryable failure has no committed row to describe — it arrives here
 * as a thrown error.
 */
export type PaymentEventOutcome =
  | 'applied'
  | 'already_processed'
  | 'already_applied'
  | 'ignored'
  | 'failed_terminal';

export interface PaymentEventResult {
  readonly outcome: PaymentEventOutcome;
  /** Why an `ignored` outcome was ignored. Operationally load-bearing. */
  readonly reason?: string;
  readonly status?: string;
  readonly subscriptionId?: string;
}

/** Thrown on any non-terminal failure. The caller MUST answer 5xx. */
export class PaymentEventProcessingError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PaymentEventProcessingError';
  }
}

const OUTCOMES: readonly PaymentEventOutcome[] = [
  'applied',
  'already_processed',
  'already_applied',
  'ignored',
  'failed_terminal',
];

export interface ProcessPaymentEventInput {
  /** Provider id, e.g. `razorpay`. Part of every uniqueness key. */
  readonly provider: string;
  /**
   * TRUSTED. From `paymentsEnvironment()`, i.e. this deployment's own
   * configured mode. Postgres cannot read `PAYMENTS_ENVIRONMENT`, so the
   * gate inside the RPC only works because this value arrives from
   * OUTSIDE the event. Exactly two callers may supply it: the webhook
   * route and the reconciliation cron.
   */
  readonly configuredEnvironment: PaymentEnvironment;
  /**
   * OBSERVED. `event.environment` was stamped by the adapter from the
   * credential set whose secret verified the signature — never from a
   * payload field or a request header (attack A30).
   */
  readonly event: PaymentEvent;
  /** Grace window opened on a failed renewal (D13). Policy stays with
   *  the caller rather than being a literal in SQL. */
  readonly graceDays?: number;
}

export async function processPaymentEvent(
  supabase: SupabaseClient,
  input: ProcessPaymentEventInput
): Promise<PaymentEventResult> {
  const { data, error } = await supabase.rpc(
    'process_payment_event',
    buildParams(input)
  );

  if (error) {
    // Fail closed. Includes the deliberate P0002 raises (unresolved
    // tenant, no default plan) — both are retryable by design, and both
    // rolled the claim back on the way out.
    throw new PaymentEventProcessingError(
      `process_payment_event failed: ${error.message}`,
      error
    );
  }

  return parseResult(data);
}

/**
 * Split out so the parameter mapping is unit-testable without a
 * database, and so the argument names are stated exactly once.
 */
export function buildParams({
  provider,
  configuredEnvironment,
  event,
  graceDays,
}: ProcessPaymentEventInput): Record<string, unknown> {
  return {
    p_provider: provider,

    // The two-trust-level pair (Task 4.1c). Passing the same value for
    // both would restore the no-op gate the v2 migration exists to fix.
    p_environment: configuredEnvironment,
    p_event_environment: event.environment,

    p_event_id: event.eventId,
    p_provider_event_type: event.providerEventType,
    p_kind: event.kind,

    p_provider_ref: event.providerRef,
    p_subscription_ref: event.subscriptionRef ?? null,

    // D7: an amount never travels without its currency.
    p_amount_minor: event.amountMinor ?? null,
    p_currency: event.currency ?? null,
    p_occurred_at: event.occurredAt ?? null,

    p_resource_status: event.resourceStatus ?? null,
    p_resource_version: event.resourceVersion ?? null,

    // A locator, never a tenant claim. The RPC binds it only under the
    // seven conditions of Task 4.1b step 2b.
    p_correlation_intent_id: event.correlationIntentId ?? null,

    p_payload_digest: event.payloadDigest ?? null,

    ...(graceDays === undefined ? {} : { p_grace_days: graceDays }),
  };
}

function parseResult(data: unknown): PaymentEventResult {
  const row = extractRow(data);
  const outcome = row?.result;

  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as PaymentEventOutcome)) {
    // An unrecognised outcome is NOT treated as success. If the function
    // and this wrapper ever disagree, the safe reading is "we do not know
    // whether it applied", which means retry.
    throw new PaymentEventProcessingError(
      `process_payment_event returned an unrecognised outcome: ${JSON.stringify(outcome)}`
    );
  }

  return {
    outcome: outcome as PaymentEventOutcome,
    reason: typeof row?.reason === 'string' ? row.reason : undefined,
    status: typeof row?.status === 'string' ? row.status : undefined,
    subscriptionId:
      typeof row?.subscription_id === 'string' ? row.subscription_id : undefined,
  };
}

/** `rpc()` on a scalar-returning function may hand back the value or a
 *  single-element array depending on the client version. */
function extractRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return extractRow(data[0]);
  if (data && typeof data === 'object') return data as Record<string, unknown>;
  return null;
}

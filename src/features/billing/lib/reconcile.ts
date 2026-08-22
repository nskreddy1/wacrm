import { createHash } from 'node:crypto';
import type {
  PaymentEnvironment,
  PaymentEvent,
  PaymentEventKind,
  ProviderSubscription,
  SubscriptionStatus,
} from '@/lib/ports/payment-provider';
import type { PaymentEventResult } from './process-payment-event';

/**
 * ADR-009 Task 10 — reconciliation core (`D13`, `D14`).
 *
 * Webhooks are the primary path and reconciliation is the safety net for
 * the deliveries that never arrived. It is the SECOND (and last) trusted
 * caller of `process_payment_event`, so everything the webhook route is
 * careful about applies here verbatim: the environment gate gets a real
 * two-trust-level pair, entitlement moves only through the RPC, and no
 * status is ever computed from a payload we did not read ourselves.
 *
 * The whole module is written as pure functions plus one orchestrator
 * over injected dependencies, so every rule below is unit-testable with
 * no database, no network, and no clock.
 *
 * WHAT THIS IS NOT ALLOWED TO DO
 * -----------------------------------------------------------------
 *  - Invent a tenant from provider data (F3). Orphans are surfaced,
 *    never adopted.
 *  - Clear a locally-set `cancel_at_period_end`. Razorpay exposes no
 *    trustworthy field for it, so the adapter hardcodes `false`; reading
 *    that as truth would quietly renew a subscription the customer
 *    cancelled. The local flag is authoritative for scheduling, the
 *    provider for status. Reconciliation therefore NEVER emits
 *    `cancel_scheduled`.
 *  - Compute a local billing-policy transition, with exactly one
 *    bounded exception: grace expiry (10.4).
 */

/**
 * Hard per-run cap on provider calls.
 *
 * Workers allow 50 subrequests and a small CPU budget per invocation. An
 * unbounded reconcile loop does not reconcile "everything slowly" — it
 * gets killed mid-flight and reconciles NOTHING, every run, forever. The
 * cursor is what makes a capped run still reach the tail.
 */
export const RECONCILE_MAX_PROVIDER_CALLS = 20;

/** Statuses still worth asking the provider about. Terminal states are
 *  absorbing in the RPC, so re-reading them can only waste budget. */
export const RECONCILABLE_STATUSES: readonly SubscriptionStatus[] = [
  'incomplete',
  'active',
  'past_due',
];

/** A local subscription row, joined to the entitlement fields we need. */
export interface ReconcileCandidate {
  readonly id: string;
  readonly accountId: string;
  readonly provider: string;
  readonly environment: PaymentEnvironment;
  readonly providerRef: string;
  readonly status: SubscriptionStatus;
  /** From `accounts.grace_until`. Drives 10.4 and nothing else. */
  readonly graceUntil: string | null;
  /** From `accounts.billing_mode`. `manual` is skipped entirely (D16). */
  readonly billingMode: string;
}

export type ReconcileAction =
  | { readonly kind: 'skipped_manual' }
  | { readonly kind: 'in_sync' }
  | {
      readonly kind: 'drift_applied';
      readonly eventKind: PaymentEventKind;
      readonly observed: SubscriptionStatus;
      readonly result: PaymentEventResult;
    }
  | {
      readonly kind: 'grace_expired';
      readonly result: PaymentEventResult;
    }
  | { readonly kind: 'provider_unreadable'; readonly error: string };

export interface ReconcileOutcome {
  readonly subscriptionId: string;
  readonly actions: readonly ReconcileAction[];
}

/**
 * `manual` accounts are invoiced by a human and their entitlement is set
 * by a human (D16). A provider read for them is meaningless — there is
 * no provider subscription backing the plan they were granted — so they
 * are excluded before any budget is spent, not filtered afterwards.
 */
export function isReconcilable(candidate: ReconcileCandidate): boolean {
  return candidate.billingMode !== 'manual';
}

/**
 * Materially-relevant digest of an observed provider state, used as the
 * idempotency key component when the provider exposes no version.
 *
 * "Materially relevant" means: could this difference move entitlement or
 * the scheduled boundary? Anything else (fetch time, request id) must
 * stay OUT, or every single read becomes a new event and the ledger
 * fills with duplicates of an unchanged state.
 */
export function computeStateDigest(observed: ProviderSubscription): string {
  // Fixed field order, explicit separators, and a length-free encoding
  // is not needed here because every component is a bounded scalar — but
  // the order must be stable or the digest is not a function of state.
  const canonical = [
    `status=${observed.status}`,
    `period_end=${observed.currentPeriodEnd ?? ''}`,
    `cancel_at_period_end=${observed.cancelAtPeriodEnd ? '1' : '0'}`,
  ].join('|');

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Synthetic idempotency key for an observed-drift event (10.3).
 *
 * Keyed on the OBSERVED STATE, never on the calendar day. `reconcile:<ref>:<date>`
 * is the trap:
 *
 *   10:00  provider reports active   → applied
 *   15:00  provider reports past_due → same id → ON CONFLICT DO NOTHING
 *                                    → "already processed"
 *                                    → the entitlement-relevant
 *                                      observation is DISCARDED
 *
 * Keying on the state version (or its digest) makes each materially
 * different observation its own event, while re-observing an unchanged
 * state still collapses to one row — which is the deduplication we
 * actually wanted.
 */
export function driftEventId(
  provider: string,
  environment: PaymentEnvironment,
  observed: ProviderSubscription
): string {
  const version = observed.stateVersion ?? computeStateDigest(observed);
  return `reconcile:${provider}:${environment}:${observed.providerRef}:${version}`;
}

/**
 * Synthetic idempotency key for grace expiry (10.4).
 *
 * Keyed on the grace DEADLINE, not on `now()`. Keying on the run time
 * would mint a fresh event on every tick for the same expiry, so a
 * subscription stuck in `past_due` would accumulate one audit row per
 * cron interval. The deadline is a fixed instant, so the expiry is one
 * event no matter how many times we observe it.
 *
 * A separate namespace from `driftEventId` because these are genuinely
 * different assertions about the same subscription, and collapsing them
 * would let a drift observation suppress the expiry (or vice versa).
 */
export function graceExpiryEventId(
  provider: string,
  environment: PaymentEnvironment,
  providerRef: string,
  graceUntil: string
): string {
  return `reconcile-grace:${provider}:${environment}:${providerRef}:${graceUntil}`;
}

/**
 * Observed provider status → the lifecycle kind that asserts it.
 *
 * `incomplete` maps to nothing on purpose. There is no event kind whose
 * meaning is "still not started", and the only kinds that reach
 * `incomplete` in the RPC's table would move it somewhere. Asserting
 * nothing is correct: an unstarted subscription grants nothing, and the
 * local row already says `incomplete`.
 *
 * `cancel_scheduled` is deliberately unreachable from here — see the
 * module header.
 */
export function driftEventKindFor(
  observed: SubscriptionStatus
): PaymentEventKind | undefined {
  switch (observed) {
    case 'active':
      return 'activated';
    case 'past_due':
      return 'payment_failed';
    case 'canceled':
      return 'canceled';
    case 'expired':
      return 'expired';
    case 'incomplete':
      return undefined;
    default: {
      // Exhaustiveness guard. A new status must fail the build here
      // rather than silently reconciling to `undefined` — i.e. silently
      // never reconciling at all.
      const unreachable: never = observed;
      return unreachable;
    }
  }
}

/**
 * 10.4 — the ONE local billing-policy transition reconciliation may
 * compute, under all three of these bounds simultaneously:
 *
 *   1. the PROVIDER-READ status is `past_due` (not merely the local row,
 *      which could be stale in exactly the direction that would revoke
 *      access we should not revoke);
 *   2. a grace window was actually opened and its deadline has passed by
 *      our clock;
 *   3. the resulting move is DOWNWARD to the default plan only.
 *
 * (3) is enforced structurally rather than by this predicate: the event
 * we emit is `expired`, and the RPC's own else-branch resolves the
 * `is_default` plan. There is no code path here that can name a plan.
 */
export function isGraceExpired(input: {
  readonly observedStatus: SubscriptionStatus;
  readonly graceUntil: string | null;
  readonly now: Date;
}): boolean {
  if (input.observedStatus !== 'past_due') return false;
  if (!input.graceUntil) return false;

  const deadline = Date.parse(input.graceUntil);
  // An unparseable deadline is NOT treated as expired. Revoking paid
  // access on the strength of a value we could not read is the one
  // failure mode here that costs a paying customer their service.
  if (Number.isNaN(deadline)) return false;

  return deadline <= input.now.getTime();
}

/**
 * Build the drift event.
 *
 * `occurredAt` IS DELIBERATELY OMITTED, and this is load-bearing. The
 * RPC's out-of-order gate only engages when `p_occurred_at is not null`;
 * a fresh provider read is by definition the newest available truth, so
 * it must not be comparable against `last_event_at` at all. Stamping it
 * with the provider's `current_end` (an older instant) would get real
 * drift silently dropped as `stale_event_out_of_order`.
 *
 * `resourceStatus`/`resourceVersion` still carry the provider's
 * authoritative state so the RPC can fence a genuinely older webhook
 * that lands after us.
 */
export function buildDriftEvent(
  provider: string,
  observed: ProviderSubscription
): PaymentEvent | undefined {
  const kind = driftEventKindFor(observed.status);
  if (!kind) return undefined;

  const digest = computeStateDigest(observed);

  return {
    kind,
    eventId: driftEventId(provider, observed.environment, observed),
    providerRef: observed.providerRef,
    subscriptionRef: observed.providerRef,
    resourceStatus: observed.status,
    resourceVersion: observed.stateVersion,
    // OBSERVED environment: the credential set we just read the provider
    // API with. The configured value is passed separately by the caller,
    // so the RPC's gate compares two independently-sourced facts.
    environment: observed.environment,
    providerEventType: 'internal.reconcile.drift',
    // No raw body exists for a synthetic event; the state digest is the
    // honest forensic equivalent. Never the payload itself (F7).
    payloadDigest: digest,
    correlationIntentId: observed.correlationIntentId,
  };
}

/** Build the grace-expiry event (10.4). Carries no money and no plan. */
export function buildGraceExpiryEvent(
  provider: string,
  observed: ProviderSubscription,
  graceUntil: string
): PaymentEvent {
  return {
    kind: 'expired',
    eventId: graceExpiryEventId(
      provider,
      observed.environment,
      observed.providerRef,
      graceUntil
    ),
    providerRef: observed.providerRef,
    subscriptionRef: observed.providerRef,
    // Asserting `expired`, so the status we claim IS `expired`. This also
    // keeps the rank comparison in the RPC's staleness gate honest: we
    // are moving strictly downward, never re-asserting `past_due`.
    resourceStatus: 'expired',
    environment: observed.environment,
    providerEventType: 'internal.reconcile.grace_expired',
    correlationIntentId: observed.correlationIntentId,
  };
}

// ---------------------------------------------------------------------
// 10.6 — orphan classification.
//
// An orphan is a provider subscription we cannot tie to a tenant. It is
// a HUMAN-RESOLVED INCIDENT (a real paying customer we cannot identify),
// so it must be loud rather than quietly healed into the wrong account.
//
// The asymmetry that keeps path 3 safe: the correlation note resolves to
// an account only THROUGH A ROW WE WROTE OURSELVES, so a forged note
// points at nothing. That is why it is a locator and not a tenant claim.
// ---------------------------------------------------------------------

export interface OrphanLookups {
  /** `subscriptions` on (provider, environment, provider_ref). */
  readonly subscriptionFound: boolean;
  /** `checkout_intents` on (provider, environment, provider_ref). */
  readonly intentByRefFound: boolean;
  /**
   * The VERIFIED correlation locator: `notes.auxelon_checkout_intent`
   * resolving to an existing intent row that satisfies the 4.1b step 2b
   * conditions. Verification happens in SQL, not here — this flag is the
   * ANSWER to it, never a substitute for it.
   */
  readonly correlationIntentResolved: boolean;
}

export type OrphanClassification = 'recoverable' | 'orphan';

/**
 * A provider subscription is an orphan only when ALL THREE authoritative
 * local lookups miss.
 *
 * Path 3 is not optional politeness: it is precisely the crash window
 * where the provider object exists but `provider_ref` was never written
 * locally, so paths 1 and 2 miss BY CONSTRUCTION. Declaring an orphan
 * without checking it would alert on a subscription we can legitimately
 * recover.
 */
export function classifyProviderSubscription(
  lookups: OrphanLookups
): OrphanClassification {
  if (lookups.subscriptionFound) return 'recoverable';
  if (lookups.intentByRefFound) return 'recoverable';
  if (lookups.correlationIntentResolved) return 'recoverable';
  return 'orphan';
}

// ---------------------------------------------------------------------
// Orchestrator.
// ---------------------------------------------------------------------

export interface ReconcileDeps {
  /** This deployment's CONFIGURED environment. Trusted, from env. */
  readonly configuredEnvironment: PaymentEnvironment;
  readonly provider: string;
  /**
   * Where the previous run stopped, read from
   * `billing_reconciliation_state`. `null` means start from the top.
   *
   * This MUST come from the durable row, not from module state: worker
   * isolates are ephemeral, so an in-memory cursor resets on every cold
   * start and the sweep re-scans the head forever without ever reaching
   * the tail.
   */
  readonly initialCursor: string | null;
  /** Page of non-terminal candidates after `cursor`, ordered by id. */
  readonly loadCandidates: (
    cursor: string | null,
    limit: number
  ) => Promise<readonly ReconcileCandidate[]>;
  readonly fetchSubscription: (
    providerRef: string
  ) => Promise<ProviderSubscription>;
  readonly applyEvent: (event: PaymentEvent) => Promise<PaymentEventResult>;
  readonly saveCursor: (input: {
    cursor: string | null;
    lastStatus: string;
    orphansSeen: number;
  }) => Promise<void>;
  readonly now?: () => Date;
  readonly maxProviderCalls?: number;
  readonly log?: (message: string, details: Record<string, unknown>) => void;
}

export interface ReconcileRunSummary {
  readonly examined: number;
  readonly providerCalls: number;
  readonly driftApplied: number;
  readonly graceExpired: number;
  readonly skippedManual: number;
  readonly unreadable: number;
  readonly cursor: string | null;
  readonly outcomes: readonly ReconcileOutcome[];
}

/**
 * One reconcile tick.
 *
 * Cursor semantics: the cursor advances over every candidate we FINISHED
 * considering, including ones skipped as `manual` and ones the provider
 * could not read. Holding the cursor back on an unreadable subscription
 * would wedge the sweep permanently behind one broken row — the tail
 * would never be reached, which is the exact failure the cap and cursor
 * exist to prevent. A transient provider failure is retried on the next
 * full pass, not by blocking this one.
 */
export async function reconcileOnce(
  deps: ReconcileDeps
): Promise<ReconcileRunSummary> {
  const now = deps.now ?? (() => new Date());
  const budget = deps.maxProviderCalls ?? RECONCILE_MAX_PROVIDER_CALLS;
  const log = deps.log ?? (() => {});

  const candidates = await deps.loadCandidates(deps.initialCursor, budget);

  const outcomes: ReconcileOutcome[] = [];
  let providerCalls = 0;
  let driftApplied = 0;
  let graceExpired = 0;
  let skippedManual = 0;
  let unreadable = 0;
  let cursor: string | null = null;

  for (const candidate of candidates) {
    // Budget is checked BEFORE the call, never after. Checking after is
    // how you end up making call 21 and getting the isolate killed with
    // the cursor unsaved.
    if (providerCalls >= budget) break;

    if (!isReconcilable(candidate)) {
      skippedManual += 1;
      cursor = candidate.id;
      outcomes.push({
        subscriptionId: candidate.id,
        actions: [{ kind: 'skipped_manual' }],
      });
      continue;
    }

    const actions: ReconcileAction[] = [];

    let observed: ProviderSubscription;
    try {
      providerCalls += 1;
      observed = await deps.fetchSubscription(candidate.providerRef);
    } catch (error) {
      unreadable += 1;
      cursor = candidate.id;
      const message = error instanceof Error ? error.message : String(error);
      log('billing_reconcile_provider_unreadable', {
        subscription_id: candidate.id,
        provider_ref: candidate.providerRef,
        error: message,
      });
      outcomes.push({
        subscriptionId: candidate.id,
        actions: [{ kind: 'provider_unreadable', error: message }],
      });
      continue;
    }

    // Drift: only when the observed status differs from ours. Re-asserting
    // an identical status would be a no-op in the RPC ('already_in_state')
    // but still burns an audit row and a synthetic id for nothing.
    if (observed.status !== candidate.status) {
      const event = buildDriftEvent(deps.provider, observed);
      if (event) {
        const result = await deps.applyEvent(event);
        if (result.outcome === 'applied') driftApplied += 1;
        actions.push({
          kind: 'drift_applied',
          eventKind: event.kind,
          observed: observed.status,
          result,
        });
      }
    }

    // Grace expiry is evaluated AFTER drift, against the provider-read
    // status. Order matters: a drift event that has just moved this
    // subscription INTO past_due also opens a fresh window, and that
    // window must not be expired by the same tick that opened it.
    const graceUntil = candidate.graceUntil;
    const justEnteredPastDue =
      observed.status === 'past_due' && candidate.status !== 'past_due';

    if (
      !justEnteredPastDue &&
      isGraceExpired({
        observedStatus: observed.status,
        graceUntil,
        now: now(),
      }) &&
      graceUntil
    ) {
      const event = buildGraceExpiryEvent(deps.provider, observed, graceUntil);
      const result = await deps.applyEvent(event);
      if (result.outcome === 'applied') graceExpired += 1;
      actions.push({ kind: 'grace_expired', result });
    }

    if (actions.length === 0) actions.push({ kind: 'in_sync' });

    cursor = candidate.id;
    outcomes.push({ subscriptionId: candidate.id, actions });
  }

  // A completed pass resets the cursor to the start so the next run
  // re-sweeps from the beginning; a truncated pass keeps its place.
  const exhausted = candidates.length < budget;
  const nextCursor = exhausted ? null : cursor;

  await deps.saveCursor({
    cursor: nextCursor,
    lastStatus: 'ok',
    // Orphan enumeration requires a provider LIST capability the port
    // does not expose (see route handler note), so no orphan can be
    // observed on this path. Reported as 0 rather than omitted, so the
    // counter is never silently stale.
    orphansSeen: 0,
  });

  return {
    examined: outcomes.length,
    providerCalls,
    driftApplied,
    graceExpired,
    skippedManual,
    unreadable,
    cursor: nextCursor,
    outcomes,
  };
}

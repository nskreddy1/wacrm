/**
 * Subscription state machine — PURE. Zero I/O, zero imports.
 *
 * This module decides whether a customer keeps or loses access. It is a
 * pure function of (current state, event) so every transition is
 * exhaustively unit-testable without a database, a provider sandbox, or
 * a clock.
 *
 * The functions here answer "what SHOULD change, given a verified
 * event?". They deliberately cannot answer "is this event genuine?" —
 * authenticity is settled upstream by signature verification, and
 * atomicity downstream by `process_payment_event()`. Keeping those three
 * concerns in three places is what makes each one reviewable.
 *
 * WHY A DECISION TABLE INSTEAD OF `if` STATEMENTS
 * An `if` chain answers "what happens on this event"; a table answers
 * "what happens on this event FROM THIS STATE", and the difference is
 * exactly where late/out-of-order events cause damage. Razorpay
 * documents that events may arrive out of order, so the table's job is
 * to make an event arriving from an unexpected state a no-op instead of
 * an entitlement change.
 */

/** Mirrors the port's `SubscriptionStatus`. Duplicated deliberately:
 *  importing it would give this pure module an import edge, and the
 *  test asserts the two lists agree. */
export type SubscriptionStatus =
  | 'incomplete'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired';

export type MoneyEventKind = 'charged' | 'refunded' | 'charged_back';

export type LifecycleEventKind =
  /**
   * Mandate approved, no money moved yet. INERT BY OMISSION: it appears
   * in no row of `TRANSITIONS`, so every state treats it as a no-op and
   * it can never grant access. Absence is the safety property here, so
   * adding it to the table would be the bug.
   */
  | 'mandate_authenticated'
  | 'activated'
  | 'payment_failed'
  | 'cancel_scheduled'
  | 'canceled'
  | 'expired';

export type PaymentEventKind = MoneyEventKind | LifecycleEventKind;

/**
 * TERMINAL STATES. Reaching one means no later event may move status.
 *
 * This is what makes a replayed `activated` from six months ago
 * harmless (attack A8): a canceled subscription cannot be resurrected
 * by re-delivering an old event, because every transition out of a
 * terminal state is absent from the table below.
 */
export const TERMINAL_STATUSES: readonly SubscriptionStatus[] = [
  'canceled',
  'expired',
];

export function isTerminal(status: SubscriptionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Statuses that grant product access.
 *
 * `past_due` IS included: a failed renewal must not instantly lock a
 * paying customer out over a transient card decline (D13). The grace
 * window bounds how long that tolerance lasts, and its expiry is
 * evaluated separately by reconciliation — never by this table, which
 * has no clock.
 */
const ENTITLED_STATUSES: readonly SubscriptionStatus[] = ['active', 'past_due'];

export function grantsAccess(status: SubscriptionStatus): boolean {
  return ENTITLED_STATUSES.includes(status);
}

/**
 * The decision table: `status → event → next status`.
 *
 * A missing entry is an INTENTIONAL no-op, not an oversight. Absence is
 * the safety property — `canceled` has no outgoing edges at all, so no
 * event can revive it.
 *
 * Money events (`charged`, `refunded`, `charged_back`) appear NOWHERE in
 * this table. They write the ledger and never move status by
 * themselves; a goodwill refund must not silently delete access, and a
 * dispute revokes it only if the provider also emits a lifecycle event.
 */
const TRANSITIONS: Readonly<
  Record<SubscriptionStatus, Partial<Record<PaymentEventKind, SubscriptionStatus>>>
> = {
  incomplete: {
    activated: 'active',
    // A first-charge failure never became a subscription. `expired` (not
    // `past_due`) because there is no paid period to be late on, and no
    // access to preserve with a grace window.
    payment_failed: 'expired',
    canceled: 'canceled',
    expired: 'expired',
  },
  active: {
    // Renewal succeeded, or a recovery after a failure. Idempotent.
    activated: 'active',
    payment_failed: 'past_due',
    // `cancel_scheduled` deliberately does NOT change status: the
    // customer paid through the end of the period and keeps access. It
    // sets the `cancelAtPeriodEnd` flag instead.
    canceled: 'canceled',
    expired: 'expired',
  },
  past_due: {
    // The retry cleared: full recovery, and the grace window is cleared
    // by the caller in the same transaction.
    activated: 'active',
    // Still failing. Stays `past_due` rather than escalating — only the
    // provider (via `canceled`/`expired`) or grace expiry ends access,
    // so a flurry of retry failures cannot short-circuit the window.
    payment_failed: 'past_due',
    canceled: 'canceled',
    expired: 'expired',
  },
  // Terminal: deliberately empty. No event revives these.
  canceled: {},
  expired: {},
};

export interface SubscriptionState {
  readonly status: SubscriptionStatus;
  readonly cancelAtPeriodEnd: boolean;
}

export interface TransitionDecision {
  /** The status to persist. Equal to the current status for a no-op. */
  readonly status: SubscriptionStatus;
  readonly cancelAtPeriodEnd: boolean;
  /** True when something actually changed and a write is warranted. */
  readonly changed: boolean;
  /** Why, for the ledger's `ignored_reason`. */
  readonly reason:
    | 'applied'
    | 'no_transition_from_state'
    | 'terminal_state'
    | 'money_event_no_status_change'
    | 'already_in_state';
}

const MONEY_EVENT_KINDS: readonly MoneyEventKind[] = [
  'charged',
  'refunded',
  'charged_back',
];

export function isMoneyEvent(kind: PaymentEventKind): kind is MoneyEventKind {
  return (MONEY_EVENT_KINDS as readonly string[]).includes(kind);
}

/**
 * Decide the next state. Pure; total; never throws.
 *
 * Total on purpose: an unknown-but-verified event must degrade to a
 * no-op, because throwing inside the RPC's transaction would roll back
 * the idempotency claim and make the provider redeliver an event we can
 * never apply (attack A21).
 */
export function decideTransition(
  current: SubscriptionState,
  kind: PaymentEventKind
): TransitionDecision {
  const unchanged = {
    status: current.status,
    cancelAtPeriodEnd: current.cancelAtPeriodEnd,
    changed: false,
  } as const;

  // Money events never move status. Checked FIRST so a refund can never
  // fall through into a lifecycle lookup.
  if (isMoneyEvent(kind)) {
    return { ...unchanged, reason: 'money_event_no_status_change' };
  }

  // Terminal states absorb everything.
  if (isTerminal(current.status)) {
    return { ...unchanged, reason: 'terminal_state' };
  }

  // `cancel_scheduled` sets the flag WITHOUT touching status: the
  // customer keeps the access they already paid for.
  //
  // It applies ONLY from a state that has a paid period to cancel at
  // the end of. From `incomplete` there is none — no charge has ever
  // succeeded — so the flag would describe a boundary that does not
  // exist. Letting it through would also leave a landmine: an
  // out-of-order `cancel_scheduled` arriving before `activated` would
  // make the subscription go live already flagged for cancellation,
  // silently ending a customer's access at a period boundary they never
  // agreed to.
  if (kind === 'cancel_scheduled') {
    if (!grantsAccess(current.status)) {
      return { ...unchanged, reason: 'no_transition_from_state' };
    }
    if (current.cancelAtPeriodEnd) {
      return { ...unchanged, reason: 'already_in_state' };
    }
    return {
      status: current.status,
      cancelAtPeriodEnd: true,
      changed: true,
      reason: 'applied',
    };
  }

  const next = TRANSITIONS[current.status][kind];
  if (next === undefined) {
    // An event that does not apply from this state — typically a late or
    // out-of-order delivery. A no-op, by design.
    return { ...unchanged, reason: 'no_transition_from_state' };
  }

  if (next === current.status) {
    // Idempotent redelivery of an event we already applied.
    return { ...unchanged, reason: 'already_in_state' };
  }

  return {
    status: next,
    // Reaching a terminal state retires the flag: there is no future
    // period boundary left for it to describe.
    cancelAtPeriodEnd: isTerminal(next) ? false : current.cancelAtPeriodEnd,
    changed: true,
    reason: 'applied',
  };
}

/**
 * Which plan an account should hold, given its subscription.
 *
 * Returning `null` means "the default plan" rather than a hardcoded
 * `'free'`: the default is DATA (`plans.is_default`, which the schema
 * already constrains to exactly one row), so the caller resolves it and
 * a rename never turns into a dangling `plan_id`.
 */
export function entitledPlanId(
  status: SubscriptionStatus,
  subscriptionPlanId: string
): string | null {
  return grantsAccess(status) ? subscriptionPlanId : null;
}

/**
 * Should a `past_due` account still have access?
 *
 * Split out from the table because it is the one transition that
 * depends on a CLOCK rather than on an event, so it belongs to
 * reconciliation (Task 10.4) — which passes `now` explicitly, keeping
 * this function pure and testable at any instant.
 *
 * A `past_due` subscription with NO grace window set is not entitled:
 * absence of a window is not an unbounded one.
 */
export function isWithinGrace(
  graceUntil: string | null | undefined,
  now: Date
): boolean {
  if (!graceUntil) return false;
  const until = Date.parse(graceUntil);
  if (Number.isNaN(until)) return false;
  return until > now.getTime();
}

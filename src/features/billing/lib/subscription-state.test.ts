import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  decideTransition,
  entitledPlanId,
  grantsAccess,
  isMoneyEvent,
  isTerminal,
  isWithinGrace,
  TERMINAL_STATUSES,
  type LifecycleEventKind,
  type PaymentEventKind,
  type SubscriptionStatus,
} from './subscription-state';

const ALL_STATUSES: SubscriptionStatus[] = [
  'incomplete',
  'active',
  'past_due',
  'canceled',
  'expired',
];

const ALL_KINDS: PaymentEventKind[] = [
  'charged',
  'refunded',
  'charged_back',
  'activated',
  'payment_failed',
  'cancel_scheduled',
  'canceled',
  'expired',
];

const state = (
  status: SubscriptionStatus,
  cancelAtPeriodEnd = false
) => ({ status, cancelAtPeriodEnd });

describe('purity', () => {
  it('imports nothing (no I/O, no clock, no port)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/billing/lib/subscription-state.ts'),
      'utf8'
    );
    const imports = Array.from(
      source.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g),
      (m) => m[1]
    );
    expect(imports).toEqual([]);
  });

  it('never reads the clock — grace evaluation takes `now` as an argument', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/billing/lib/subscription-state.ts'),
      'utf8'
    );
    expect(source).not.toContain('Date.now()');
    expect(source).not.toContain('new Date()');
  });

  it('keeps its status list in step with the port', () => {
    const portSource = readFileSync(
      join(process.cwd(), 'src/lib/ports/payment-provider.ts'),
      'utf8'
    );
    for (const status of ALL_STATUSES) {
      expect(portSource).toContain(`'${status}'`);
    }
  });
});

describe('totality', () => {
  it('never throws for any (status, event) pair', () => {
    for (const status of ALL_STATUSES) {
      for (const kind of ALL_KINDS) {
        for (const flag of [false, true]) {
          expect(() => decideTransition(state(status, flag), kind)).not.toThrow();
        }
      }
    }
  });

  it('returns a valid status for every pair', () => {
    for (const status of ALL_STATUSES) {
      for (const kind of ALL_KINDS) {
        const next = decideTransition(state(status), kind);
        expect(ALL_STATUSES).toContain(next.status);
      }
    }
  });

  it('degrades an unrecognised-but-verified event to a no-op rather than throwing', () => {
    // A21: throwing inside the RPC transaction would roll back the
    // idempotency claim, and the provider would redeliver an event that
    // can never be applied.
    const decision = decideTransition(
      state('active'),
      'something_new' as PaymentEventKind
    );
    expect(decision.changed).toBe(false);
    expect(decision.status).toBe('active');
  });
});

describe('terminal states are final (attack A8: replayed old event)', () => {
  it.each(TERMINAL_STATUSES)('no event moves %s', (terminal) => {
    for (const kind of ALL_KINDS) {
      const decision = decideTransition(state(terminal), kind);
      expect(decision.status).toBe(terminal);
      expect(decision.changed).toBe(false);
    }
  });

  it('a replayed activated cannot resurrect a canceled subscription', () => {
    const decision = decideTransition(state('canceled'), 'activated');
    expect(decision.status).toBe('canceled');
    expect(decision.reason).toBe('terminal_state');
    expect(grantsAccess(decision.status)).toBe(false);
  });

  it('retires cancelAtPeriodEnd on reaching a terminal state', () => {
    const decision = decideTransition(state('active', true), 'canceled');
    expect(decision.status).toBe('canceled');
    expect(decision.cancelAtPeriodEnd).toBe(false);
  });
});

describe('money events never move status', () => {
  it.each(['charged', 'refunded', 'charged_back'] as const)(
    '%s leaves status untouched from every state',
    (kind) => {
      for (const status of ALL_STATUSES) {
        const decision = decideTransition(state(status), kind);
        expect(decision.status).toBe(status);
        expect(decision.changed).toBe(false);
        expect(isMoneyEvent(kind)).toBe(true);
      }
    }
  );

  it('a refund does not revoke access on its own', () => {
    // A goodwill refund must not silently delete a customer's access.
    const decision = decideTransition(state('active'), 'refunded');
    expect(grantsAccess(decision.status)).toBe(true);
  });

  it('a chargeback alone does not revoke access, but a lifecycle event does', () => {
    // "A chargeback never affects access" is NOT the rule. The ledger
    // row is unconditional; entitlement moves only if the provider also
    // emits a lifecycle event.
    expect(grantsAccess(decideTransition(state('active'), 'charged_back').status)).toBe(
      true
    );
    expect(
      grantsAccess(decideTransition(state('active'), 'canceled').status)
    ).toBe(false);
  });
});

describe('lifecycle transitions', () => {
  it('activates an incomplete subscription', () => {
    const decision = decideTransition(state('incomplete'), 'activated');
    expect(decision.status).toBe('active');
    expect(decision.changed).toBe(true);
    expect(decision.reason).toBe('applied');
  });

  it('expires (not past_due) when the FIRST charge fails', () => {
    // No paid period exists to be late on, and no access to preserve.
    const decision = decideTransition(state('incomplete'), 'payment_failed');
    expect(decision.status).toBe('expired');
    expect(grantsAccess(decision.status)).toBe(false);
  });

  it('moves active → past_due on a failed renewal, keeping access', () => {
    const decision = decideTransition(state('active'), 'payment_failed');
    expect(decision.status).toBe('past_due');
    // D13: a transient card decline must not instantly lock out a
    // paying customer.
    expect(grantsAccess(decision.status)).toBe(true);
  });

  it('recovers past_due → active when a retry clears', () => {
    const decision = decideTransition(state('past_due'), 'activated');
    expect(decision.status).toBe('active');
    expect(decision.changed).toBe(true);
  });

  it('does not escalate past_due on repeated failures', () => {
    // Only the provider or grace expiry may end access — a flurry of
    // retry failures must not short-circuit the window.
    const decision = decideTransition(state('past_due'), 'payment_failed');
    expect(decision.status).toBe('past_due');
    expect(decision.changed).toBe(false);
  });
});

describe('cancel_scheduled preserves paid-for access', () => {
  it('sets the flag without changing status', () => {
    const decision = decideTransition(state('active'), 'cancel_scheduled');
    expect(decision.status).toBe('active');
    expect(decision.cancelAtPeriodEnd).toBe(true);
    expect(decision.changed).toBe(true);
    // The customer paid through the end of the period.
    expect(grantsAccess(decision.status)).toBe(true);
  });

  it('is idempotent on redelivery', () => {
    const decision = decideTransition(state('active', true), 'cancel_scheduled');
    expect(decision.changed).toBe(false);
    expect(decision.reason).toBe('already_in_state');
  });

  it('is a no-op from a terminal state', () => {
    const decision = decideTransition(state('canceled'), 'cancel_scheduled');
    expect(decision.cancelAtPeriodEnd).toBe(false);
    expect(decision.changed).toBe(false);
  });
});

describe('idempotent redelivery', () => {
  it.each([
    ['active', 'activated'],
    ['past_due', 'payment_failed'],
  ] as const)('%s + %s is a no-op', (status, kind) => {
    const decision = decideTransition(state(status), kind as LifecycleEventKind);
    expect(decision.changed).toBe(false);
    expect(decision.reason).toBe('already_in_state');
  });
});

describe('out-of-order delivery is a no-op, never an entitlement change', () => {
  it('reports why an event did not apply, for the ledger', () => {
    // Razorpay documents that events may arrive out of order.
    const decision = decideTransition(state('incomplete'), 'cancel_scheduled');
    expect(decision.changed).toBe(false);
  });

  it('never grants access as a side effect of an inapplicable event', () => {
    for (const status of ALL_STATUSES) {
      for (const kind of ALL_KINDS) {
        const decision = decideTransition(state(status), kind);
        if (!decision.changed) {
          expect(grantsAccess(decision.status)).toBe(grantsAccess(status));
        }
      }
    }
  });
});

describe('entitlement', () => {
  it('grants access only for active and past_due', () => {
    expect(grantsAccess('active')).toBe(true);
    expect(grantsAccess('past_due')).toBe(true);
    expect(grantsAccess('incomplete')).toBe(false);
    expect(grantsAccess('canceled')).toBe(false);
    expect(grantsAccess('expired')).toBe(false);
  });

  it('marks canceled and expired terminal', () => {
    expect(isTerminal('canceled')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
    expect(isTerminal('active')).toBe(false);
  });

  it('returns the paid plan when entitled, null (= default plan) otherwise', () => {
    expect(entitledPlanId('active', 'pro')).toBe('pro');
    expect(entitledPlanId('past_due', 'pro')).toBe('pro');
    // null rather than a hardcoded 'free': the default is data
    // (plans.is_default), so a rename cannot dangle.
    expect(entitledPlanId('canceled', 'pro')).toBeNull();
    expect(entitledPlanId('expired', 'pro')).toBeNull();
    expect(entitledPlanId('incomplete', 'pro')).toBeNull();
  });
});

describe('grace window (D13)', () => {
  const now = new Date('2026-08-22T12:00:00.000Z');

  it('is within grace while the window is in the future', () => {
    expect(isWithinGrace('2026-08-25T00:00:00.000Z', now)).toBe(true);
  });

  it('is outside grace once the window passes', () => {
    expect(isWithinGrace('2026-08-20T00:00:00.000Z', now)).toBe(false);
  });

  it('treats an absent window as NOT entitled', () => {
    // Absence of a window is not an unbounded one.
    expect(isWithinGrace(null, now)).toBe(false);
    expect(isWithinGrace(undefined, now)).toBe(false);
  });

  it('treats an unparseable window as NOT entitled (fails closed)', () => {
    expect(isWithinGrace('not-a-date', now)).toBe(false);
  });

  it('treats the exact boundary instant as expired', () => {
    expect(isWithinGrace(now.toISOString(), now)).toBe(false);
  });
});

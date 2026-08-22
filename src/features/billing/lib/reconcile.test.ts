import { describe, expect, it, vi } from 'vitest';

import type {
  PaymentEvent,
  ProviderSubscription,
  SubscriptionStatus,
} from '@/lib/ports/payment-provider';

import type { PaymentEventResult } from './process-payment-event';
import {
  RECONCILE_MAX_PROVIDER_CALLS,
  buildDriftEvent,
  buildGraceExpiryEvent,
  classifyProviderSubscription,
  computeStateDigest,
  driftEventId,
  driftEventKindFor,
  graceExpiryEventId,
  isGraceExpired,
  isReconcilable,
  reconcileOnce,
  type ReconcileCandidate,
} from './reconcile';

/**
 * ADR-009 Task 10 — reconciliation.
 *
 * Reconciliation is the SECOND trusted caller of `process_payment_event`
 * and the only repair path for a webhook that never arrived, so its
 * failure modes are the expensive kind: a wedged cursor never reaches
 * the tail, a day-keyed synthetic id silently discards a real
 * entitlement change, and a premature grace expiry revokes a paying
 * customer's access. Each of those is a named test below.
 */

function observed(
  overrides: Partial<ProviderSubscription> = {}
): ProviderSubscription {
  return {
    providerRef: 'sub_ABC123',
    status: 'active',
    cancelAtPeriodEnd: false,
    environment: 'live',
    ...overrides,
  };
}

function candidate(
  overrides: Partial<ReconcileCandidate> = {}
): ReconcileCandidate {
  return {
    id: 'row-1',
    accountId: 'acct-1',
    provider: 'razorpay',
    environment: 'live',
    providerRef: 'sub_ABC123',
    status: 'active',
    graceUntil: null,
    billingMode: 'self_serve',
    ...overrides,
  };
}

const applied: PaymentEventResult = { outcome: 'applied' };

describe('isReconcilable', () => {
  it('excludes manual-billing accounts before any budget is spent (D16, A14)', () => {
    expect(isReconcilable(candidate({ billingMode: 'manual' }))).toBe(false);
    expect(isReconcilable(candidate({ billingMode: 'self_serve' }))).toBe(true);
  });
});

describe('computeStateDigest', () => {
  it('is a stable function of the materially relevant state only', () => {
    const a = computeStateDigest(observed());
    const b = computeStateDigest(observed());
    expect(a).toBe(b);
  });

  it('changes when entitlement-relevant state changes', () => {
    const active = computeStateDigest(observed({ status: 'active' }));
    const pastDue = computeStateDigest(observed({ status: 'past_due' }));
    const rescheduled = computeStateDigest(
      observed({ currentPeriodEnd: '2026-09-01T00:00:00.000Z' })
    );
    const cancelling = computeStateDigest(observed({ cancelAtPeriodEnd: true }));

    expect(new Set([active, pastDue, rescheduled, cancelling]).size).toBe(4);
  });

  it('ignores fields that are not entitlement-relevant', () => {
    // `stateVersion` is used directly as the key when present, so it must
    // not also perturb the fallback digest — otherwise a provider that
    // starts exposing a version would re-emit every subscription once.
    expect(computeStateDigest(observed({ stateVersion: 'v1' }))).toBe(
      computeStateDigest(observed({ stateVersion: 'v2' }))
    );
  });
});

describe('driftEventId', () => {
  it('keys on the observed state, not the calendar day', () => {
    // The trap this replaces: `reconcile:<ref>:<date>` collapses two
    // genuinely different observations on one day into one claim, so the
    // second (entitlement-relevant) one is discarded as "already
    // processed".
    const morning = driftEventId('razorpay', 'live', observed({ status: 'active' }));
    const afternoon = driftEventId(
      'razorpay',
      'live',
      observed({ status: 'past_due' })
    );

    expect(morning).not.toBe(afternoon);
  });

  it('collapses a re-observation of an unchanged state to one id', () => {
    expect(driftEventId('razorpay', 'live', observed())).toBe(
      driftEventId('razorpay', 'live', observed())
    );
  });

  it('prefers the provider version when one is exposed', () => {
    const id = driftEventId('razorpay', 'live', observed({ stateVersion: 'v7' }));
    expect(id).toBe('reconcile:razorpay:live:sub_ABC123:v7');
  });

  it('is namespaced per environment so test-mode cannot collide with live (A24)', () => {
    expect(driftEventId('razorpay', 'test', observed({ environment: 'test' }))).not.toBe(
      driftEventId('razorpay', 'live', observed({ environment: 'live' }))
    );
  });
});

describe('graceExpiryEventId', () => {
  it('keys on the deadline, so one expiry is one event however often observed', () => {
    const first = graceExpiryEventId(
      'razorpay',
      'live',
      'sub_ABC123',
      '2026-08-30T00:00:00.000Z'
    );
    const second = graceExpiryEventId(
      'razorpay',
      'live',
      'sub_ABC123',
      '2026-08-30T00:00:00.000Z'
    );
    expect(first).toBe(second);
  });

  it('uses a different namespace from drift, so neither can suppress the other', () => {
    const grace = graceExpiryEventId(
      'razorpay',
      'live',
      'sub_ABC123',
      '2026-08-30T00:00:00.000Z'
    );
    expect(grace.startsWith('reconcile-grace:')).toBe(true);
    expect(grace).not.toBe(driftEventId('razorpay', 'live', observed()));
  });
});

describe('driftEventKindFor', () => {
  it('maps every observed status to a lifecycle assertion or to nothing', () => {
    const expected: Record<SubscriptionStatus, string | undefined> = {
      incomplete: undefined,
      active: 'activated',
      past_due: 'payment_failed',
      canceled: 'canceled',
      expired: 'expired',
    };

    for (const [status, kind] of Object.entries(expected)) {
      expect(driftEventKindFor(status as SubscriptionStatus)).toBe(kind);
    }
  });

  it('never asserts cancel_scheduled', () => {
    // Razorpay exposes no trustworthy `cancel_at_period_end`, so the
    // adapter hardcodes `false`. Emitting `cancel_scheduled` from a
    // provider read would let reconciliation UNDO a cancellation the
    // customer actually requested.
    const statuses: SubscriptionStatus[] = [
      'incomplete',
      'active',
      'past_due',
      'canceled',
      'expired',
    ];
    for (const status of statuses) {
      expect(driftEventKindFor(status)).not.toBe('cancel_scheduled');
    }
  });
});

describe('isGraceExpired (10.4 — the one local policy transition)', () => {
  const now = new Date('2026-08-23T12:00:00.000Z');

  it('requires the PROVIDER-READ status to be past_due', () => {
    expect(
      isGraceExpired({
        observedStatus: 'active',
        graceUntil: '2026-08-01T00:00:00.000Z',
        now,
      })
    ).toBe(false);
  });

  it('requires a grace window to have been opened', () => {
    expect(
      isGraceExpired({ observedStatus: 'past_due', graceUntil: null, now })
    ).toBe(false);
  });

  it('does not expire a window that is still open', () => {
    expect(
      isGraceExpired({
        observedStatus: 'past_due',
        graceUntil: '2026-08-30T00:00:00.000Z',
        now,
      })
    ).toBe(false);
  });

  it('expires a window whose deadline has passed', () => {
    expect(
      isGraceExpired({
        observedStatus: 'past_due',
        graceUntil: '2026-08-20T00:00:00.000Z',
        now,
      })
    ).toBe(true);
  });

  it('never treats an unreadable deadline as expired', () => {
    // Revoking paid access on the strength of a value we could not parse
    // is the one failure here that costs a paying customer their service.
    expect(
      isGraceExpired({ observedStatus: 'past_due', graceUntil: 'not-a-date', now })
    ).toBe(false);
  });
});

describe('buildDriftEvent', () => {
  it('omits occurredAt so a fresh read is never fenced as stale', () => {
    // The RPC's out-of-order gate only engages when `p_occurred_at` is
    // present. A provider read IS the newest available truth, so giving
    // it a timestamp (the period end, say) would get real drift dropped.
    const event = buildDriftEvent('razorpay', observed({ status: 'past_due' }));
    expect(event?.occurredAt).toBeUndefined();
  });

  it('carries the observed environment, never a configured one', () => {
    const event = buildDriftEvent('razorpay', observed({ status: 'past_due', environment: 'test' }));
    expect(event?.environment).toBe('test');
  });

  it('carries a digest instead of a payload (F7)', () => {
    const source = observed({ status: 'past_due' });
    const event = buildDriftEvent('razorpay', source);
    expect(event?.payloadDigest).toBe(computeStateDigest(source));
  });

  it('asserts nothing for an unstarted subscription', () => {
    expect(buildDriftEvent('razorpay', observed({ status: 'incomplete' }))).toBeUndefined();
  });
});

describe('buildGraceExpiryEvent', () => {
  it('asserts expired and names no plan', () => {
    const event = buildGraceExpiryEvent(
      'razorpay',
      observed({ status: 'past_due' }),
      '2026-08-20T00:00:00.000Z'
    );

    expect(event.kind).toBe('expired');
    // The move is downward to `is_default` and the RPC resolves that
    // itself; there is no field here through which a plan could be named.
    expect(event.resourceStatus).toBe('expired');
    expect(Object.keys(event)).not.toContain('planId');
    expect(event.amountMinor).toBeUndefined();
  });
});

describe('classifyProviderSubscription (10.6, A23, A34)', () => {
  const miss = {
    subscriptionFound: false,
    intentByRefFound: false,
    correlationIntentResolved: false,
  };

  it('is recoverable when the local subscription exists', () => {
    expect(
      classifyProviderSubscription({ ...miss, subscriptionFound: true })
    ).toBe('recoverable');
  });

  it('is recoverable when only the intent matches by provider_ref', () => {
    expect(
      classifyProviderSubscription({ ...miss, intentByRefFound: true })
    ).toBe('recoverable');
  });

  it('is recoverable when only the verified correlation locator resolves (A34)', () => {
    // This is the crash window where provider_ref was never persisted,
    // so paths 1 and 2 miss BY CONSTRUCTION. Declaring an orphan here
    // would send a recoverable paying customer to manual triage.
    expect(
      classifyProviderSubscription({ ...miss, correlationIntentResolved: true })
    ).toBe('recoverable');
  });

  it('is an orphan only when all three lookups miss', () => {
    expect(classifyProviderSubscription(miss)).toBe('orphan');
  });
});

describe('reconcileOnce', () => {
  function deps(
    overrides: Partial<Parameters<typeof reconcileOnce>[0]> = {}
  ): Parameters<typeof reconcileOnce>[0] {
    return {
      configuredEnvironment: 'live',
      provider: 'razorpay',
      initialCursor: null,
      loadCandidates: async () => [candidate()],
      fetchSubscription: async () => observed(),
      applyEvent: async () => applied,
      saveCursor: async () => {},
      now: () => new Date('2026-08-23T12:00:00.000Z'),
      ...overrides,
    };
  }

  it('applies nothing when the provider agrees with us', async () => {
    const applyEvent = vi.fn(async (_event: PaymentEvent) => applied);
    const summary = await reconcileOnce(deps({ applyEvent }));

    expect(applyEvent).not.toHaveBeenCalled();
    expect(summary.outcomes[0]?.actions).toEqual([{ kind: 'in_sync' }]);
  });

  it('applies observed drift through the injected RPC', async () => {
    const applyEvent = vi.fn(async (_event: PaymentEvent) => applied);
    const summary = await reconcileOnce(
      deps({
        loadCandidates: async () => [candidate({ status: 'active' })],
        fetchSubscription: async () => observed({ status: 'past_due' }),
        applyEvent,
      })
    );

    expect(applyEvent).toHaveBeenCalledTimes(1);
    const event = applyEvent.mock.calls[0]?.[0] as PaymentEvent;
    expect(event.kind).toBe('payment_failed');
    expect(summary.driftApplied).toBe(1);
  });

  it('never calls the provider for a manual-billing account (D16)', async () => {
    const fetchSubscription = vi.fn(async () => observed());
    const summary = await reconcileOnce(
      deps({
        loadCandidates: async () => [candidate({ billingMode: 'manual' })],
        fetchSubscription,
      })
    );

    expect(fetchSubscription).not.toHaveBeenCalled();
    expect(summary.skippedManual).toBe(1);
    expect(summary.providerCalls).toBe(0);
  });

  it('advances past a subscription the provider cannot read', async () => {
    // Holding the cursor back on one broken row wedges the sweep there
    // permanently: the tail is never reached, which is precisely what
    // the cursor and the cap exist to prevent.
    const summary = await reconcileOnce(
      deps({
        loadCandidates: async () => [candidate({ id: 'row-9' })],
        fetchSubscription: async () => {
          throw new Error('provider 503');
        },
        maxProviderCalls: 1,
      })
    );

    expect(summary.unreadable).toBe(1);
    expect(summary.cursor).toBe('row-9');
  });

  it('respects the hard per-run provider-call cap', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      candidate({ id: `row-${i}`, providerRef: `sub_${i}` })
    );
    const fetchSubscription = vi.fn(async () => observed());

    const summary = await reconcileOnce(
      deps({
        loadCandidates: async (_cursor, limit) => many.slice(0, limit),
        fetchSubscription,
        maxProviderCalls: 3,
      })
    );

    expect(fetchSubscription).toHaveBeenCalledTimes(3);
    expect(summary.providerCalls).toBe(3);
  });

  it('defaults the cap to the Workers-safe budget', () => {
    expect(RECONCILE_MAX_PROVIDER_CALLS).toBeLessThanOrEqual(20);
  });

  it('does not expire a grace window opened by this very tick', async () => {
    // The drift event that moves a subscription INTO past_due also opens
    // the window. Expiring it in the same pass would revoke access with
    // zero grace, which is the opposite of what D13 promises.
    const applyEvent = vi.fn(async (_event: PaymentEvent) => applied);
    const summary = await reconcileOnce(
      deps({
        loadCandidates: async () => [
          candidate({
            status: 'active',
            graceUntil: '2026-08-01T00:00:00.000Z',
          }),
        ],
        fetchSubscription: async () => observed({ status: 'past_due' }),
        applyEvent,
      })
    );

    expect(summary.graceExpired).toBe(0);
    expect(applyEvent).toHaveBeenCalledTimes(1);
  });

  it('expires an already-open grace window against the provider-read status', async () => {
    const applyEvent = vi.fn(async (_event: PaymentEvent) => applied);
    const summary = await reconcileOnce(
      deps({
        loadCandidates: async () => [
          candidate({
            status: 'past_due',
            graceUntil: '2026-08-01T00:00:00.000Z',
          }),
        ],
        fetchSubscription: async () => observed({ status: 'past_due' }),
        applyEvent,
      })
    );

    expect(summary.graceExpired).toBe(1);
    const event = applyEvent.mock.calls[0]?.[0] as PaymentEvent;
    expect(event.kind).toBe('expired');
  });

  it('persists the cursor for a truncated pass and resets it for a full one', async () => {
    const saveCursor = vi.fn(async () => {});

    await reconcileOnce(
      deps({
        loadCandidates: async () => [
          candidate({ id: 'row-1' }),
          candidate({ id: 'row-2', providerRef: 'sub_2' }),
        ],
        maxProviderCalls: 2,
        saveCursor,
      })
    );
    expect(saveCursor).toHaveBeenLastCalledWith({
      cursor: 'row-2',
      lastStatus: 'ok',
      orphansSeen: 0,
    });

    await reconcileOnce(
      deps({
        loadCandidates: async () => [candidate({ id: 'row-1' })],
        maxProviderCalls: 5,
        saveCursor,
      })
    );
    expect(saveCursor).toHaveBeenLastCalledWith({
      cursor: null,
      lastStatus: 'ok',
      orphansSeen: 0,
    });
  });

  it('propagates an RPC failure instead of reporting a clean run', async () => {
    // Reconciliation fails CLOSED like the webhook: a swallowed apply
    // error would report "in sync" for an account whose entitlement was
    // never actually corrected.
    await expect(
      reconcileOnce(
        deps({
          loadCandidates: async () => [candidate({ status: 'active' })],
          fetchSubscription: async () => observed({ status: 'canceled' }),
          applyEvent: async () => {
            throw new Error('rpc exploded');
          },
        })
      )
    ).rejects.toThrow('rpc exploded');
  });
});

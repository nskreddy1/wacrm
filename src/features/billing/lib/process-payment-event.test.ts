import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { PaymentEvent } from '@/lib/ports/payment-provider';

import {
  PaymentEventProcessingError,
  buildParams,
  processPaymentEvent,
} from './process-payment-event';

/**
 * A client that permits `rpc()` and NOTHING else.
 *
 * `from` is a hard throw rather than a spy, because the invariant under
 * test is not "we happened not to call it" — it is that a second write
 * from this module is impossible. Two supabase-js calls are two
 * transactions, so a claim written here and an effect written there
 * would commit the claim and lose the effect on a crash in between,
 * making the event permanently unapplicable (A21).
 */
function clientAllowingOnlyRpc(result: {
  data?: unknown;
  error?: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue({
    data: result.data ?? null,
    error: result.error ?? null,
  });
  const client = {
    rpc,
    from() {
      throw new Error(
        'process-payment-event must not perform any write outside the single RPC'
      );
    },
  };
  return { client: client as unknown as SupabaseClient, rpc };
}

const testEvent: PaymentEvent = {
  eventId: 'evt_1',
  providerEventType: 'subscription.activated',
  kind: 'activated',
  environment: 'test',
  providerRef: 'sub_live_1',
  subscriptionRef: 'sub_live_1',
  occurredAt: '2026-08-22T10:00:00.000Z',
  resourceStatus: 'active',
};

describe('processPaymentEvent', () => {
  it('makes exactly one RPC call and no other write', async () => {
    const { client, rpc } = clientAllowingOnlyRpc({
      data: { result: 'applied', status: 'active', subscription_id: 'sub-uuid' },
    });

    const result = await processPaymentEvent(client, {
      provider: 'razorpay',
      configuredEnvironment: 'test',
      event: testEvent,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('process_payment_event');
    expect(result).toEqual({
      outcome: 'applied',
      status: 'active',
      subscriptionId: 'sub-uuid',
      reason: undefined,
    });
  });

  it('passes the configured and observed environments as SEPARATE arguments', async () => {
    // The whole point of Task 4.1c: one argument cannot be compared
    // against itself, so a mismatch must be visible to the RPC.
    const { client, rpc } = clientAllowingOnlyRpc({
      data: { result: 'ignored', reason: 'wrong_environment' },
    });

    await processPaymentEvent(client, {
      provider: 'razorpay',
      configuredEnvironment: 'live',
      event: { ...testEvent, environment: 'test' },
    });

    const params = rpc.mock.calls[0][1];
    expect(params.p_environment).toBe('live');
    expect(params.p_event_environment).toBe('test');
    expect(params.p_environment).not.toBe(params.p_event_environment);
  });

  it('reports a wrong-environment rejection with its reason intact', async () => {
    const { client } = clientAllowingOnlyRpc({
      data: { result: 'ignored', reason: 'wrong_environment' },
    });

    await expect(
      processPaymentEvent(client, {
        provider: 'razorpay',
        configuredEnvironment: 'live',
        event: { ...testEvent, environment: 'test' },
      })
    ).resolves.toEqual({
      outcome: 'ignored',
      reason: 'wrong_environment',
      status: undefined,
      subscriptionId: undefined,
    });
  });

  it('FAILS CLOSED: a database error throws so the caller answers 5xx', async () => {
    const { client } = clientAllowingOnlyRpc({
      error: { message: 'unresolved tenant for razorpay/test event evt_1' },
    });

    await expect(
      processPaymentEvent(client, {
        provider: 'razorpay',
        configuredEnvironment: 'test',
        event: testEvent,
      })
    ).rejects.toBeInstanceOf(PaymentEventProcessingError);
  });

  it('treats an unrecognised outcome as unknown, not as success', async () => {
    // If the RPC and this wrapper ever disagree, "we cannot tell whether
    // it applied" must mean retry — never a silent 200.
    const { client } = clientAllowingOnlyRpc({
      data: { result: 'failed_retryable' },
    });

    await expect(
      processPaymentEvent(client, {
        provider: 'razorpay',
        configuredEnvironment: 'test',
        event: testEvent,
      })
    ).rejects.toBeInstanceOf(PaymentEventProcessingError);
  });

  it('accepts a single-element array, as rpc() sometimes returns', async () => {
    const { client } = clientAllowingOnlyRpc({
      data: [{ result: 'already_processed' }],
    });

    const result = await processPaymentEvent(client, {
      provider: 'razorpay',
      configuredEnvironment: 'test',
      event: testEvent,
    });

    expect(result.outcome).toBe('already_processed');
  });
});

describe('buildParams', () => {
  it('never sends an amount without its currency (D7)', () => {
    const params = buildParams({
      provider: 'razorpay',
      configuredEnvironment: 'test',
      event: { ...testEvent, kind: 'charged', amountMinor: 149900, currency: 'INR' },
    });

    expect(params.p_amount_minor).toBe(149900);
    expect(params.p_currency).toBe('INR');
  });

  it('nulls absent optionals rather than omitting them', () => {
    // Omission would let a Postgres DEFAULT stand in for an explicit
    // "not present", which is how a stale value silently survives.
    const params = buildParams({
      provider: 'razorpay',
      configuredEnvironment: 'test',
      event: testEvent,
    });

    expect(params.p_amount_minor).toBeNull();
    expect(params.p_currency).toBeNull();
    expect(params.p_correlation_intent_id).toBeNull();
    expect(params.p_payload_digest).toBeNull();
  });

  it('omits p_grace_days entirely when the caller states no policy', () => {
    const params = buildParams({
      provider: 'razorpay',
      configuredEnvironment: 'test',
      event: testEvent,
    });
    expect('p_grace_days' in params).toBe(false);

    const withPolicy = buildParams({
      provider: 'razorpay',
      configuredEnvironment: 'test',
      event: testEvent,
      graceDays: 7,
    });
    expect(withPolicy.p_grace_days).toBe(7);
  });

  it('forwards the correlation intent id as a locator only', () => {
    const params = buildParams({
      provider: 'razorpay',
      configuredEnvironment: 'test',
      event: { ...testEvent, correlationIntentId: 'intent-uuid' },
    });

    expect(params.p_correlation_intent_id).toBe('intent-uuid');
    // There is no account, plan, price or interval parameter at all: the
    // RPC derives every one of them from our own rows (F1/F3, A4/A29).
    expect(Object.keys(params)).not.toContain('p_account_id');
    expect(Object.keys(params)).not.toContain('p_plan_id');
    expect(Object.keys(params)).not.toContain('p_interval');
  });
});

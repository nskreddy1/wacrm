import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaymentProvider } from '@/lib/ports/payment-provider';

import { requestCancellation } from './cancel-subscription';

/**
 * A client that permits `rpc()` and NOTHING else.
 *
 * `from` is a hard throw rather than a spy, because the invariant under
 * test is not "we happened not to write a table" — it is that this
 * module *cannot* write entitlement. The intent columns are reachable
 * only through the two narrow RPCs; a `from('subscriptions').update()`
 * appearing here would be exactly the trust-boundary violation the
 * column split exists to prevent (ADR-009 8.2).
 */
function clientAllowingOnlyRpc(rows: unknown) {
  const rpc = vi.fn((name: string) => {
    if (name === 'request_subscription_cancellation') {
      return Promise.resolve({ data: rows, error: null });
    }
    return Promise.resolve({ data: 'provider_accepted', error: null });
  });
  const client = {
    rpc,
    from() {
      throw new Error(
        'the cancellation path must not write any table directly — intent goes through the RPCs'
      );
    },
  };
  return { client: client as unknown as SupabaseClient, rpc };
}

function openRow(overrides: Record<string, unknown> = {}) {
  return [
    {
      subscription_id: 'sub-uuid',
      provider: 'razorpay',
      environment: 'test',
      provider_ref: 'sub_rzp_1',
      status: 'active',
      current_period_end: '2026-09-22T00:00:00.000Z',
      cancel_request_status: 'requested',
      cancel_requested_at: '2026-08-22T10:00:00.000Z',
      outcome: 'opened',
      ...overrides,
    },
  ];
}

/** A provider whose cancel behaviour the test dictates. */
function providerThat(
  cancel: () => Promise<void>,
  overrides: Partial<Pick<PaymentProvider, 'id' | 'environment'>> = {}
) {
  const cancelAtPeriodEnd = vi.fn(cancel);
  const provider = {
    id: 'razorpay',
    environment: 'test',
    cancelAtPeriodEnd,
    ...overrides,
  };
  return { provider: provider as unknown as PaymentProvider, cancelAtPeriodEnd };
}

/** Shaped like `RazorpayApiError` without importing the adapter. */
function providerError(
  message: string,
  options: { status?: number; ambiguous?: boolean } = {}
) {
  return Object.assign(new Error(message), {
    status: options.status ?? 400,
    ambiguous: options.ambiguous ?? false,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('requestCancellation', () => {
  it('records intent BEFORE calling the provider', async () => {
    const order: string[] = [];
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    rpc.mockImplementation((name: string) => {
      order.push(`rpc:${name}`);
      if (name === 'request_subscription_cancellation') {
        return Promise.resolve({ data: openRow(), error: null });
      }
      return Promise.resolve({ data: 'provider_accepted', error: null });
    });
    const { provider } = providerThat(async () => {
      order.push('provider:cancel');
    });

    const outcome = await requestCancellation(client, provider, 'acct-1');

    // The ordering is the whole point: Razorpay cancellation is
    // irreversible and non-idempotent, so a provider call we have not
    // yet recorded can never be safely retried or compensated.
    expect(order).toEqual([
      'rpc:request_subscription_cancellation',
      'provider:cancel',
      'rpc:settle_subscription_cancel_request',
    ]);
    expect(outcome).toMatchObject({ kind: 'requested', alreadyRequested: false });
  });

  it('never passes a caller-supplied subscription id to the RPC (A5)', async () => {
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    const { provider } = providerThat(async () => {});

    await requestCancellation(client, provider, 'acct-1');

    // Only the account is sent. There is no id parameter to tamper with.
    expect(rpc).toHaveBeenCalledWith('request_subscription_cancellation', {
      p_account_id: 'acct-1',
    });
  });

  it('settles to provider_accepted once the provider acknowledges', async () => {
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    const { provider } = providerThat(async () => {});

    await requestCancellation(client, provider, 'acct-1');

    expect(rpc).toHaveBeenCalledWith('settle_subscription_cancel_request', {
      p_account_id: 'acct-1',
      p_subscription_id: 'sub-uuid',
      p_outcome: 'provider_accepted',
    });
  });

  it('does not call the provider again when already accepted', async () => {
    const { client } = clientAllowingOnlyRpc(
      openRow({ outcome: 'already_accepted', cancel_request_status: 'provider_accepted' })
    );
    const { provider, cancelAtPeriodEnd } = providerThat(async () => {});

    const outcome = await requestCancellation(client, provider, 'acct-1');

    // A second cancel earns Razorpay's 400 and would log a false
    // failure against a request that actually succeeded.
    expect(cancelAtPeriodEnd).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: 'requested', alreadyRequested: true });
  });

  it('treats "already cancelled" at the provider as success, not failure', async () => {
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    const { provider } = providerThat(async () => {
      throw providerError(
        'Razorpay POST /subscriptions/sub_rzp_1/cancel failed with 400: Subscription is not cancellable in cancelled status.'
      );
    });

    const outcome = await requestCancellation(client, provider, 'acct-1');

    // This is precisely the state a crashed earlier attempt leaves
    // behind. Marking it `failed` would strand the account forever.
    expect(outcome).toMatchObject({ kind: 'requested', alreadyRequested: true });
    expect(rpc).toHaveBeenCalledWith('settle_subscription_cancel_request', {
      p_account_id: 'acct-1',
      p_subscription_id: 'sub-uuid',
      p_outcome: 'provider_accepted',
    });
  });

  it('leaves the request open when the provider outcome is unknown', async () => {
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    const { provider } = providerThat(async () => {
      throw providerError('Razorpay request failed before a response', {
        status: 0,
        ambiguous: true,
      });
    });

    const outcome = await requestCancellation(client, provider, 'acct-1');

    expect(outcome).toMatchObject({ kind: 'unconfirmed' });
    // Must NOT settle: the cancellation may have landed, and `failed`
    // would be a lie that invites a retry the provider rejects.
    expect(rpc).not.toHaveBeenCalledWith(
      'settle_subscription_cancel_request',
      expect.anything()
    );
  });

  it('reports a concurrent provider operation as retryable, without settling', async () => {
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    const { provider } = providerThat(async () => {
      throw providerError(
        'Razorpay POST failed with 400: Request failed because another subscription operation is in progress.'
      );
    });

    const outcome = await requestCancellation(client, provider, 'acct-1');

    expect(outcome).toMatchObject({ kind: 'busy' });
    expect(rpc).not.toHaveBeenCalledWith(
      'settle_subscription_cancel_request',
      expect.anything()
    );
  });

  it('marks a final-cycle refusal as not cancellable', async () => {
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    const { provider } = providerThat(async () => {
      throw providerError(
        'Razorpay POST failed with 400: The subscription is in its final cycle and cannot be cancelled now.'
      );
    });

    const outcome = await requestCancellation(client, provider, 'acct-1');

    expect(outcome).toMatchObject({ kind: 'not_cancellable', reason: 'final_cycle' });
    expect(rpc).toHaveBeenCalledWith('settle_subscription_cancel_request', {
      p_account_id: 'acct-1',
      p_subscription_id: 'sub-uuid',
      p_outcome: 'failed',
    });
  });

  it('refuses to act across an environment boundary (A24)', async () => {
    const { client } = clientAllowingOnlyRpc(openRow({ environment: 'live' }));
    const { provider, cancelAtPeriodEnd } = providerThat(async () => {});

    const outcome = await requestCancellation(client, provider, 'acct-1');

    // A live ref actioned with test credentials either 404s or, far
    // worse, matches an unrelated subscription.
    expect(cancelAtPeriodEnd).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('provider_failed');
  });

  it('never calls the provider when there is no subscription', async () => {
    const { client } = clientAllowingOnlyRpc([
      { subscription_id: null, outcome: 'no_subscription' },
    ]);
    const { provider, cancelAtPeriodEnd } = providerThat(async () => {});

    const outcome = await requestCancellation(client, provider, 'acct-1');

    expect(outcome).toEqual({ kind: 'no_subscription' });
    expect(cancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('does not call the provider for an incomplete subscription', async () => {
    const { client } = clientAllowingOnlyRpc(
      openRow({ outcome: 'not_cancellable', status: 'incomplete' })
    );
    const { provider, cancelAtPeriodEnd } = providerThat(async () => {});

    const outcome = await requestCancellation(client, provider, 'acct-1');

    expect(outcome).toMatchObject({ kind: 'not_cancellable', reason: 'incomplete' });
    expect(cancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('surfaces an RPC error instead of proceeding to the provider', async () => {
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'not authorised' } });
    const { provider, cancelAtPeriodEnd } = providerThat(async () => {});

    await expect(
      requestCancellation(client, provider, 'acct-1')
    ).rejects.toBeTruthy();
    expect(cancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('still reports success when settling fails after the provider accepted', async () => {
    const { client, rpc } = clientAllowingOnlyRpc(openRow());
    rpc.mockImplementation((name: string) => {
      if (name === 'request_subscription_cancellation') {
        return Promise.resolve({ data: openRow(), error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'transient' } });
    });
    const { provider } = providerThat(async () => {});

    const outcome = await requestCancellation(client, provider, 'acct-1');

    // The provider has already been told. Answering 5xx here would ask
    // the customer to retry a cancellation that already succeeded.
    expect(outcome).toMatchObject({ kind: 'requested' });
  });
});

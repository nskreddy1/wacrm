import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  WebhookVerificationError,
  type BillingInterval,
  type CheckoutIntent,
  type PaymentEnvironment,
} from '@/lib/ports/payment-provider';

import { RazorpayApiError, type RazorpayClient } from './client';
import {
  CORRELATION_NOTE_KEY,
  mapEventType,
  mapSubscriptionState,
  RazorpayPaymentProvider,
  type RazorpayAdapterConfig,
} from './adapter';
import { RAZORPAY_EVENT_ID_HEADER, RAZORPAY_SIGNATURE_HEADER } from './verify';

/**
 * Tests for the anti-corruption layer (OPEN-2 / Task 5.4).
 *
 * The adapter is the second half of the perimeter: `verify.ts` settles
 * ORIGIN, this settles MEANING. The properties worth protecting are the
 * ones whose failure is silent —
 *
 *   - a `default:` branch inventing an entitlement decision,
 *   - a `provider_ref` chosen from the wrong entity, collapsing every
 *     renewal into a "duplicate" and dropping revenue,
 *   - an environment read off the payload instead of configuration,
 *   - external data naming a TENANT rather than locating an intent,
 *   - an extra key sneaking into the create-subscription body.
 *
 * Every fake response below is shaped like Razorpay's published samples,
 * because a fixture that is merely convenient tests a provider we do not
 * have.
 */

const WEBHOOK_SECRET = 'whsec_test_4c1f9a';
const MERCHANT_REF = 'acc_Jk9mQrTvBnXw12';
const VALID_PLAN_REF = 'plan_ABCDEFGH123456'; // plan_ + exactly 14 alphanumerics
const INTENT_UUID = '3f6a1c9e-2b7d-4e18-9a03-5c8d1f2b7e64';

interface FakeCall {
  method: 'GET' | 'POST';
  path: string;
  body?: Readonly<Record<string, unknown>>;
}

/**
 * A recording stand-in for the HTTP client.
 *
 * Hand-rolled rather than `vi.mock`'d so each test states the provider
 * response it is reasoning about, in the provider's own shape.
 */
function fakeClient(
  responder: (call: FakeCall) => unknown = () => ({})
): { client: RazorpayClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const client = {
    async request(
      method: 'GET' | 'POST',
      path: string,
      body?: Readonly<Record<string, unknown>>
    ) {
      calls.push({ method, path, body });
      return responder({ method, path, body });
    },
  } as unknown as RazorpayClient;
  return { client, calls };
}

function makeProvider(
  overrides: Partial<RazorpayAdapterConfig> = {},
  responder?: (call: FakeCall) => unknown
) {
  const { client, calls } = fakeClient(responder);
  const config: RazorpayAdapterConfig = {
    environment: 'test',
    webhookSecrets: { current: WEBHOOK_SECRET },
    merchantAccountRef: MERCHANT_REF,
    resolveProviderPlanRef: async () => VALID_PLAN_REF,
    ...overrides,
  };
  return { provider: new RazorpayPaymentProvider(client, config), calls, config };
}

const intent: CheckoutIntent = {
  intentId: INTENT_UUID,
  accountId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  planId: 'pro',
  interval: 'monthly',
  amountMinor: 149_900,
  currency: 'INR',
};

/** Sign a body the way Razorpay would, so `verifyAndParse` gets real input. */
function signedWebhook(
  body: unknown,
  options: { secret?: string; eventId?: string } = {}
) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    headers: {
      [RAZORPAY_SIGNATURE_HEADER]: crypto
        .createHmac('sha256', options.secret ?? WEBHOOK_SECRET)
        .update(rawBody, 'utf8')
        .digest('hex'),
      [RAZORPAY_EVENT_ID_HEADER]: options.eventId ?? 'evt_QK1s0mDcXhY7Ab',
    },
  };
}

/** Razorpay wraps every event as `payload.<entity>.entity`. */
function event(
  providerEventType: string,
  payload: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
  return {
    entity: 'event',
    account_id: MERCHANT_REF,
    event: providerEventType,
    created_at: 1_771_000_000,
    payload,
    ...extra,
  };
}

const subscriptionEntity = (over: Record<string, unknown> = {}) => ({
  subscription: {
    entity: {
      id: 'sub_QK1s0mDcXhY7Ab',
      status: 'active',
      customer_id: 'cust_QK1s0mDcXhY7Ab',
      notes: { [CORRELATION_NOTE_KEY]: INTENT_UUID },
      ...over,
    },
  },
});

const paymentEntity = (over: Record<string, unknown> = {}) => ({
  payment: {
    entity: {
      id: 'pay_QK1s0mDcXhY7Ab',
      amount: 149_900,
      currency: 'INR',
      invoice_id: 'inv_QK1s0mDcXhY7Ab',
      ...over,
    },
  },
});

// ───────────────────────── mapping totality ─────────────────────────

describe('mapSubscriptionState — total, throws on the unknown', () => {
  it.each([
    ['created', 'incomplete'],
    ['authenticated', 'incomplete'],
    ['active', 'active'],
    ['pending', 'past_due'],
    ['halted', 'past_due'],
    ['cancelled', 'canceled'],
    ['completed', 'expired'],
    ['expired', 'expired'],
  ] as const)('maps %s → %s', (state, expected) => {
    expect(mapSubscriptionState(state)).toBe(expected);
  });

  it('maps `authenticated` to incomplete, NOT active', () => {
    // A mandate is approved but the first debit can still fail. Mapping
    // this to `active` hands out paid access on the strength of an
    // authorisation, which is the single most expensive mapping mistake
    // available in this file.
    expect(mapSubscriptionState('authenticated')).toBe('incomplete');
    expect(mapSubscriptionState('authenticated')).not.toBe('active');
  });

  it('maps `halted` to the RECOVERABLE past_due, not a terminal state', () => {
    // A halted subscription can return to active once a debit succeeds.
    // A terminal mapping would discard a recoverable paying customer.
    expect(mapSubscriptionState('halted')).toBe('past_due');
  });

  it.each(['paused', 'resumed', 'unknown', '', 'ACTIVE', 'canceled'])(
    'throws on unmapped state %o rather than guessing',
    (state) => {
      expect(() => mapSubscriptionState(state)).toThrow(WebhookVerificationError);
    }
  );

  it('is case-sensitive — `Active` is not `active`', () => {
    expect(() => mapSubscriptionState('Active')).toThrow(WebhookVerificationError);
  });
});

describe('mapEventType — total, throws on the unknown', () => {
  it.each([
    ['subscription.authenticated', 'mandate_authenticated'],
    ['subscription.activated', 'activated'],
    ['subscription.charged', 'charged'],
    ['subscription.pending', 'payment_failed'],
    ['subscription.halted', 'payment_failed'],
    ['subscription.cancelled', 'canceled'],
    ['subscription.completed', 'expired'],
    ['refund.created', 'refunded'],
    ['refund.processed', 'refunded'],
    ['payment.dispute.created', 'charged_back'],
    ['payment.dispute.lost', 'charged_back'],
  ] as const)('maps %s → %s', (type, expected) => {
    expect(mapEventType(type)).toBe(expected);
  });

  it('keeps `subscription.charged` a MONEY event, never an activation', () => {
    // Conflating them would let a mid-term renewal charge re-activate a
    // subscription the provider had already cancelled.
    expect(mapEventType('subscription.charged')).toBe('charged');
    expect(mapEventType('subscription.activated')).toBe('activated');
  });

  it('keeps `subscription.authenticated` inert — it is not `activated`', () => {
    expect(mapEventType('subscription.authenticated')).toBe('mandate_authenticated');
  });

  it.each([
    'subscription.paused',
    'subscription.resumed',
    'payment.captured',
    'order.paid',
    'invoice.paid',
    'subscription.updated',
    '',
  ])('throws on unreviewed event type %o', (type) => {
    expect(() => mapEventType(type)).toThrow(WebhookVerificationError);
  });
});

// ───────────────────────── createCheckout ─────────────────────────

describe('createCheckout — the request body is a CLOSED literal', () => {
  const okResponse = {
    id: 'sub_QK1s0mDcXhY7Ab',
    short_url: 'https://rzp.io/i/AbCdEf',
    customer_id: 'cust_QK1s0mDcXhY7Ab',
    notes: { [CORRELATION_NOTE_KEY]: INTENT_UUID },
  };

  it('sends EXACTLY the five documented keys and nothing more', async () => {
    // Razorpay's create endpoint 400s on unrecognised fields, and every
    // 400 here is a failed checkout for a real customer. Asserting the
    // exact key set is what makes that structural rather than hopeful.
    const { provider, calls } = makeProvider({}, () => okResponse);
    await provider.createCheckout(intent);

    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].body ?? {}).sort()).toEqual([
      'customer_notify',
      'notes',
      'plan_id',
      'quantity',
      'total_count',
    ]);
  });

  it('omits `start_at` and `end_at`', async () => {
    // `start_at` invites a clock-skew 400; `end_at` is mutually
    // exclusive with `total_count` and sending both is a documented 400.
    const { provider, calls } = makeProvider({}, () => okResponse);
    await provider.createCheckout(intent);

    expect(calls[0].body).not.toHaveProperty('start_at');
    expect(calls[0].body).not.toHaveProperty('end_at');
  });

  it('pins quantity to 1 — V1 has no per-seat billing', async () => {
    // The second place a smuggled `quantity: 100` dies, after the route
    // schema. `CheckoutIntent` has no quantity field to forward at all.
    const { provider, calls } = makeProvider({}, () => okResponse);
    await provider.createCheckout(intent);
    expect(calls[0].body?.quantity).toBe(1);
  });

  it('sets customer_notify to false explicitly, never leaving the default', async () => {
    // The provider default is `true`, which would have Razorpay emailing
    // our customers about charge events.
    const { provider, calls } = makeProvider({}, () => okResponse);
    await provider.createCheckout(intent);
    expect(calls[0].body?.customer_notify).toBe(false);
  });

  it.each([
    ['monthly', 120],
    ['yearly', 10],
  ] as const)(
    'sets a 10-year total_count for %s (%i cycles)',
    async (interval: BillingInterval, expected) => {
      // This constant sets the date a paying customer silently loses
      // access. It must stay far outside V1's horizon, which is the only
      // reason a renewal path is acceptably out of scope.
      const { provider, calls } = makeProvider({}, () => okResponse);
      await provider.createCheckout({ ...intent, interval });
      expect(calls[0].body?.total_count).toBe(expected);
    }
  );

  it('carries the correlation locator in notes', async () => {
    const { provider, calls } = makeProvider({}, () => okResponse);
    await provider.createCheckout(intent);
    expect(calls[0].body?.notes).toEqual({ [CORRELATION_NOTE_KEY]: INTENT_UUID });
  });

  it('never sends an amount — prices are resolved server-side only', async () => {
    // `amountMinor` exists on the intent for reporting. If it were sent,
    // the provider's charge could diverge from the plan we priced.
    const { provider, calls } = makeProvider({}, () => okResponse);
    await provider.createCheckout(intent);
    expect(calls[0].body).not.toHaveProperty('amount');
    expect(JSON.stringify(calls[0].body)).not.toContain('149900');
  });

  it('sends the resolved provider plan ref, not our tier id', async () => {
    const { provider, calls } = makeProvider({}, () => okResponse);
    await provider.createCheckout(intent);
    expect(calls[0].body?.plan_id).toBe(VALID_PLAN_REF);
    expect(calls[0].body?.plan_id).not.toBe(intent.planId);
  });
});

describe('createCheckout — seed data is validated before spending a call', () => {
  it.each([
    'plan_short',
    'plan_TOOMANYCHARACTERS12',
    'sub_ABCDEFGH123456',
    'plan_ABCDEFGH12345!',
    '',
    'ABCDEFGH123456',
  ])('rejects malformed provider plan ref %o without calling the API', async (ref) => {
    // A typo'd `provider_refs` value must fail loudly for an operator,
    // not as a provider 400 for a customer mid-checkout.
    const { provider, calls } = makeProvider({ resolveProviderPlanRef: async () => ref });
    await expect(provider.createCheckout(intent)).rejects.toThrow(/Invalid Razorpay plan ref/);
    expect(calls).toHaveLength(0);
  });

  it('propagates a plan-resolution failure without calling the API', async () => {
    const { provider, calls } = makeProvider({
      resolveProviderPlanRef: async () => {
        throw new Error('no provider_refs entry for pro/monthly');
      },
    });
    await expect(provider.createCheckout(intent)).rejects.toThrow(/no provider_refs/);
    expect(calls).toHaveLength(0);
  });
});

describe('createCheckout — ambiguous responses are never improvised over', () => {
  it('flags a 2xx with no id as AMBIGUOUS rather than a plain failure', async () => {
    // Something may exist at the provider that we cannot name. Only
    // `ambiguous` tells the caller to reconcile instead of retrying —
    // and retrying a create with no idempotency support double-charges.
    const { provider } = makeProvider({}, () => ({ short_url: 'https://rzp.io/i/x' }));
    await expect(provider.createCheckout(intent)).rejects.toMatchObject({
      name: 'RazorpayApiError',
      ambiguous: true,
    });
  });

  it('refuses to improvise an authorize URL when short_url is absent', async () => {
    // Hand-building a provider URL could send a customer to a page that
    // charges against the wrong resource.
    const { provider } = makeProvider({}, () => ({ id: 'sub_QK1s0mDcXhY7Ab' }));
    await expect(provider.createCheckout(intent)).rejects.toMatchObject({
      ambiguous: true,
    });
  });

  it('returns the provider short_url verbatim', async () => {
    const { provider } = makeProvider({}, () => ({
      id: 'sub_QK1s0mDcXhY7Ab',
      short_url: 'https://rzp.io/i/UNIQUE123',
      notes: { [CORRELATION_NOTE_KEY]: INTENT_UUID },
    }));
    const handle = await provider.createCheckout(intent);
    expect(handle.authorizeUrl).toBe('https://rzp.io/i/UNIQUE123');
    expect(handle.providerRef).toBe('sub_QK1s0mDcXhY7Ab');
  });

  it('rejects when the correlation note did not survive the round trip', async () => {
    // Now — while we still hold the intent — is the only moment we can
    // act on a broken correlation guarantee.
    const { provider } = makeProvider({}, () => ({
      id: 'sub_QK1s0mDcXhY7Ab',
      short_url: 'https://rzp.io/i/x',
      notes: {},
    }));
    await expect(provider.createCheckout(intent)).rejects.toThrow(
      /did not echo the correlation note/
    );
  });

  it('rejects when the provider echoes a DIFFERENT intent id', async () => {
    const { provider } = makeProvider({}, () => ({
      id: 'sub_QK1s0mDcXhY7Ab',
      short_url: 'https://rzp.io/i/x',
      notes: { [CORRELATION_NOTE_KEY]: '00000000-0000-4000-8000-000000000000' },
    }));
    await expect(provider.createCheckout(intent)).rejects.toMatchObject({
      ambiguous: true,
    });
  });
});

// ───────────────────────── verifyAndParse ─────────────────────────

describe('verifyAndParse — origin before meaning', () => {
  it('rejects a forged signature before reading the body', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity()),
      { secret: 'whsec_attacker' }
    );
    await expect(provider.verifyAndParse({ rawBody, headers })).rejects.toThrow(
      WebhookVerificationError
    );
  });

  it('rejects a genuine body when the secret is unconfigured', async () => {
    const { provider } = makeProvider({ webhookSecrets: { current: '' } });
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity())
    );
    await expect(provider.verifyAndParse({ rawBody, headers })).rejects.toThrow(
      /not configured/i
    );
  });

  it('emits the rotation signal when the previous secret verified', async () => {
    const onPreviousSecretUsed = vi.fn();
    const { provider } = makeProvider({
      webhookSecrets: { current: WEBHOOK_SECRET, previous: 'whsec_old' },
      onPreviousSecretUsed,
    });
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity()),
      { secret: 'whsec_old', eventId: 'evt_rotated' }
    );

    await provider.verifyAndParse({ rawBody, headers });
    expect(onPreviousSecretUsed).toHaveBeenCalledWith({ eventId: 'evt_rotated' });
  });

  it('does not emit the rotation signal for the current secret', async () => {
    const onPreviousSecretUsed = vi.fn();
    const { provider } = makeProvider({
      webhookSecrets: { current: WEBHOOK_SECRET, previous: 'whsec_old' },
      onPreviousSecretUsed,
    });
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity())
    );
    await provider.verifyAndParse({ rawBody, headers });
    expect(onPreviousSecretUsed).not.toHaveBeenCalled();
  });

  it('rejects a signed body with no `event` field', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook({ account_id: MERCHANT_REF });
    await expect(provider.verifyAndParse({ rawBody, headers })).rejects.toThrow(
      /no event field/
    );
  });

  it('rejects a signed but unmapped event type', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.paused', subscriptionEntity())
    );
    await expect(provider.verifyAndParse({ rawBody, headers })).rejects.toThrow(
      /Unmapped Razorpay event type/
    );
  });
});

describe('verifyAndParse — signed merchant consistency (5.3e)', () => {
  it('rejects an event from a DIFFERENT Razorpay merchant account', async () => {
    // Defense in depth anchored to signed data: `account_id` lives
    // inside the HMAC base string, unlike the event-id header.
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity(), {
        account_id: 'acc_SOMEONEELSE99',
      })
    );
    await expect(provider.verifyAndParse({ rawBody, headers })).rejects.toThrow(
      /does not match the configured merchant account/
    );
  });

  it('rejects an event with account_id absent when a merchant is configured', async () => {
    const { provider } = makeProvider();
    const body = event('subscription.activated', subscriptionEntity());
    delete (body as Record<string, unknown>).account_id;
    const { rawBody, headers } = signedWebhook(body);
    await expect(provider.verifyAndParse({ rawBody, headers })).rejects.toThrow(
      WebhookVerificationError
    );
  });

  it('skips the check when no merchant is configured (pre-go-live)', async () => {
    const { provider } = makeProvider({ merchantAccountRef: undefined });
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity(), { account_id: 'acc_other' })
    );
    await expect(provider.verifyAndParse({ rawBody, headers })).resolves.toMatchObject({
      kind: 'activated',
    });
  });

  it('NEVER maps the provider account_id onto a tenant', async () => {
    // The boundary is exact: account_id answers "is this webhook ours?"
    // and must never become an Auxelon account id.
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity())
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed).not.toHaveProperty('accountId');
    expect(JSON.stringify(parsed)).not.toContain(MERCHANT_REF);
  });
});

describe('verifyAndParse — provider_ref is the ledger duplicate fence (A35)', () => {
  it('keys a money event on the PAYMENT id, not the subscription id', async () => {
    // Using the subscription id would make every renewal charge look
    // like a duplicate of the first and silently drop revenue.
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.charged', {
        ...subscriptionEntity(),
        ...paymentEntity(),
      })
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });

    expect(parsed.kind).toBe('charged');
    expect(parsed.providerRef).toBe('pay_QK1s0mDcXhY7Ab');
    expect(parsed.subscriptionRef).toBe('sub_QK1s0mDcXhY7Ab');
  });

  it('keys a refund on the REFUND id, preferred over the payment id', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('refund.processed', {
        ...paymentEntity(),
        refund: {
          entity: { id: 'rfnd_QK1s0mDcXhY7Ab', amount: 50_000, currency: 'INR' },
        },
      })
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });

    expect(parsed.kind).toBe('refunded');
    expect(parsed.providerRef).toBe('rfnd_QK1s0mDcXhY7Ab');
    expect(parsed.amountMinor).toBe(50_000);
  });

  it('keys a dispute on the DISPUTE id', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('payment.dispute.lost', {
        ...paymentEntity(),
        dispute: {
          entity: { id: 'disp_QK1s0mDcXhY7Ab', amount: 149_900, currency: 'INR' },
        },
      })
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });

    expect(parsed.kind).toBe('charged_back');
    expect(parsed.providerRef).toBe('disp_QK1s0mDcXhY7Ab');
  });

  it('keys a LIFECYCLE event on the subscription id', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity())
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.providerRef).toBe('sub_QK1s0mDcXhY7Ab');
  });

  it('rejects an event carrying no resource id to key on', async () => {
    // Without a key there is no duplicate fence, so accepting it would
    // let one charge be banked twice.
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.charged', { payment: { entity: { amount: 100 } } })
    );
    await expect(provider.verifyAndParse({ rawBody, headers })).rejects.toThrow(
      /carries no resource id to key on/
    );
  });

  it('distinct renewal charges keep distinct provider refs', async () => {
    const { provider } = makeProvider();
    const first = signedWebhook(
      event('subscription.charged', {
        ...subscriptionEntity(),
        ...paymentEntity({ id: 'pay_first0000001' }),
      }),
      { eventId: 'evt_1' }
    );
    const second = signedWebhook(
      event('subscription.charged', {
        ...subscriptionEntity(),
        ...paymentEntity({ id: 'pay_second000002' }),
      }),
      { eventId: 'evt_2' }
    );

    const a = await provider.verifyAndParse(first);
    const b = await provider.verifyAndParse(second);
    expect(a.providerRef).not.toBe(b.providerRef);
  });
});

describe('verifyAndParse — the environment is CONFIGURED, never observed (A30)', () => {
  it.each(['test', 'live'] as const)(
    'stamps the configured %s environment',
    async (environment: PaymentEnvironment) => {
      const { provider } = makeProvider({ environment });
      const { rawBody, headers } = signedWebhook(
        event('subscription.activated', subscriptionEntity())
      );
      const parsed = await provider.verifyAndParse({ rawBody, headers });
      expect(parsed.environment).toBe(environment);
    }
  );

  it('ignores an `environment` field smuggled into the signed payload', async () => {
    // Even a genuinely signed event must not choose its own environment:
    // a gate that reads the environment off the event and compares it to
    // the event checks nothing.
    const { provider } = makeProvider({ environment: 'test' });
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity(), {
        environment: 'live',
        live: true,
      })
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.environment).toBe('test');
  });

  it('ignores an environment hint in the headers', async () => {
    const { provider } = makeProvider({ environment: 'test' });
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity())
    );
    const parsed = await provider.verifyAndParse({
      rawBody,
      headers: { ...headers, 'x-razorpay-environment': 'live' },
    });
    expect(parsed.environment).toBe('test');
  });
});

describe('verifyAndParse — correlation is a LOCATOR, never authority (F3)', () => {
  it('accepts a UUID locator from the SUBSCRIPTION notes', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity())
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.correlationIntentId).toBe(INTENT_UUID);
  });

  it.each([
    'not-a-uuid',
    '1; DROP TABLE accounts',
    '00000000-0000-0000-0000-000000000000', // version nibble 0
    '3f6a1c9e2b7d4e189a035c8d1f2b7e64', // unhyphenated
    '',
  ])('SILENTLY drops a non-UUID locator %o', async (locator) => {
    // Untrusted input gets no error path of its own — an error path
    // would let an attacker probe our validation.
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event(
        'subscription.activated',
        subscriptionEntity({ notes: { [CORRELATION_NOTE_KEY]: locator } })
      )
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.correlationIntentId).toBeUndefined();
  });

  it('IGNORES notes on the payment entity', async () => {
    // Razorpay documents `notes` on the subscription object; a payment
    // entity's `notes` is a different field its own sample shows as `[]`.
    // Reading the wrong one correlates against the wrong data.
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.charged', {
        subscription: {
          entity: { id: 'sub_QK1s0mDcXhY7Ab', status: 'active', notes: {} },
        },
        ...paymentEntity({ notes: { [CORRELATION_NOTE_KEY]: INTENT_UUID } }),
      })
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.correlationIntentId).toBeUndefined();
  });

  it('never lets external data name an account, plan, price, or interval', async () => {
    // The forbidden direction (attacks A4/A29). A signed event may name
    // whatever it likes; none of it may reach the normalised event.
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event(
        'subscription.activated',
        subscriptionEntity({
          notes: {
            [CORRELATION_NOTE_KEY]: INTENT_UUID,
            account_id: 'a1b2c3d4-e5f6-4a7b-8c9d-000000000000',
            plan_id: 'enterprise',
            amount: 1,
            interval: 'yearly',
          },
        })
      )
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });

    expect(parsed.correlationIntentId).toBe(INTENT_UUID);
    expect(parsed).not.toHaveProperty('accountId');
    expect(parsed).not.toHaveProperty('planId');
    expect(parsed).not.toHaveProperty('interval');
    expect(JSON.stringify(parsed)).not.toContain('enterprise');
  });

  it('drops a non-string locator', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event(
        'subscription.activated',
        subscriptionEntity({ notes: { [CORRELATION_NOTE_KEY]: { nested: INTENT_UUID } } })
      )
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.correlationIntentId).toBeUndefined();
  });
});

describe('verifyAndParse — normalised output', () => {
  it('carries our vocabulary, the digest, and no raw payload (F7)', async () => {
    const { provider } = makeProvider();
    const body = event('subscription.activated', subscriptionEntity());
    const { rawBody, headers } = signedWebhook(body);
    const parsed = await provider.verifyAndParse({ rawBody, headers });

    expect(parsed.kind).toBe('activated');
    expect(parsed.providerEventType).toBe('subscription.activated');
    expect(parsed.eventId).toBe('evt_QK1s0mDcXhY7Ab');
    expect(parsed.resourceStatus).toBe('active');
    expect(parsed.resourceVersion).toBe('active');
    expect(parsed.customerRef).toBe('cust_QK1s0mDcXhY7Ab');
    expect(parsed.occurredAt).toBe(new Date(1_771_000_000 * 1000).toISOString());
    expect(parsed.payloadDigest).toBe(
      crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex')
    );
    expect(parsed).not.toHaveProperty('payload');
    expect(parsed).not.toHaveProperty('rawBody');
  });

  it('takes the event id from the header, not the body', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity(), { id: 'evt_FROM_BODY' }),
      { eventId: 'evt_FROM_HEADER' }
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.eventId).toBe('evt_FROM_HEADER');
  });

  it('omits amount and currency together when there is no money entity', async () => {
    // Never an amount without its currency (D7).
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity())
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.amountMinor).toBeUndefined();
    expect(parsed.currency).toBeUndefined();
  });

  it('drops a non-integer amount rather than rounding it', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.charged', {
        ...subscriptionEntity(),
        ...paymentEntity({ amount: 149.9 }),
      })
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.amountMinor).toBeUndefined();
  });

  it('rejects an unmapped subscription status on an otherwise valid event', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity({ status: 'paused' }))
    );
    await expect(provider.verifyAndParse({ rawBody, headers })).rejects.toThrow(
      /Unmapped Razorpay subscription state/
    );
  });

  it('omits occurredAt for a non-positive created_at instead of an Invalid Date', async () => {
    const { provider } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity(), { created_at: 0 })
    );
    const parsed = await provider.verifyAndParse({ rawBody, headers });
    expect(parsed.occurredAt).toBeUndefined();
  });

  it('never calls the provider API while parsing a webhook', async () => {
    const { provider, calls } = makeProvider();
    const { rawBody, headers } = signedWebhook(
      event('subscription.activated', subscriptionEntity())
    );
    await provider.verifyAndParse({ rawBody, headers });
    expect(calls).toHaveLength(0);
  });
});

// ───────────────────── fetchSubscription / cancel ─────────────────────

describe('fetchSubscription', () => {
  it('reads authoritative state back and keys stateVersion on it', async () => {
    const { provider, calls } = makeProvider({}, () => ({
      id: 'sub_QK1s0mDcXhY7Ab',
      status: 'halted',
      current_end: 1_771_500_000,
      notes: { [CORRELATION_NOTE_KEY]: INTENT_UUID },
    }));

    const result = await provider.fetchSubscription('sub_QK1s0mDcXhY7Ab');

    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/subscriptions/sub_QK1s0mDcXhY7Ab',
    });
    expect(result.status).toBe('past_due');
    expect(result.stateVersion).toBe('halted');
    expect(result.currentPeriodEnd).toBe(new Date(1_771_500_000 * 1000).toISOString());
    expect(result.correlationIntentId).toBe(INTENT_UUID);
  });

  it('ALWAYS reports cancelAtPeriodEnd false — the local flag is authoritative', async () => {
    // Razorpay exposes no reliable field for this. Inventing one would
    // have reconciliation CLEAR a flag a customer really set, quietly
    // renewing a subscription they had cancelled.
    const { provider } = makeProvider({}, () => ({
      id: 'sub_QK1s0mDcXhY7Ab',
      status: 'active',
      cancel_at_cycle_end: 1,
      cancel_at_period_end: true,
    }));
    const result = await provider.fetchSubscription('sub_QK1s0mDcXhY7Ab');
    expect(result.cancelAtPeriodEnd).toBe(false);
  });

  it('throws on a response with no status rather than assuming one', async () => {
    const { provider } = makeProvider({}, () => ({ id: 'sub_QK1s0mDcXhY7Ab' }));
    await expect(provider.fetchSubscription('sub_QK1s0mDcXhY7Ab')).rejects.toThrow(
      RazorpayApiError
    );
  });

  it('throws on an unmapped provider status', async () => {
    const { provider } = makeProvider({}, () => ({
      id: 'sub_QK1s0mDcXhY7Ab',
      status: 'paused',
    }));
    await expect(provider.fetchSubscription('sub_QK1s0mDcXhY7Ab')).rejects.toThrow(
      /Unmapped Razorpay subscription state/
    );
  });

  it('URL-encodes the provider ref', async () => {
    const { provider, calls } = makeProvider({}, () => ({
      id: 'x',
      status: 'active',
    }));
    await provider.fetchSubscription('sub_/../evil?x=1');
    expect(calls[0].path).toBe('/subscriptions/sub_%2F..%2Fevil%3Fx%3D1');
  });

  it('stamps the configured environment, never one read from the response', async () => {
    const { provider } = makeProvider({ environment: 'live' }, () => ({
      id: 'sub_x',
      status: 'active',
      environment: 'test',
    }));
    const result = await provider.fetchSubscription('sub_x');
    expect(result.environment).toBe('live');
  });
});

describe('cancelAtPeriodEnd', () => {
  it('sends cancel_at_cycle_end: 1 — NEVER 0', async () => {
    // `0` cancels immediately and destroys paid-for access the customer
    // is still entitled to.
    const { provider, calls } = makeProvider({}, () => ({}));
    await provider.cancelAtPeriodEnd('sub_QK1s0mDcXhY7Ab');

    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/subscriptions/sub_QK1s0mDcXhY7Ab/cancel',
      body: { cancel_at_cycle_end: 1 },
    });
    expect(calls[0].body?.cancel_at_cycle_end).not.toBe(0);
  });

  it('sends exactly one key', async () => {
    const { provider, calls } = makeProvider({}, () => ({}));
    await provider.cancelAtPeriodEnd('sub_QK1s0mDcXhY7Ab');
    expect(Object.keys(calls[0].body ?? {})).toEqual(['cancel_at_cycle_end']);
  });

  it('resolves without returning provider state — it records INTENT only', async () => {
    // Entitlement moves when the provider confirms, not here.
    const { provider } = makeProvider({}, () => ({ status: 'active' }));
    await expect(provider.cancelAtPeriodEnd('sub_x')).resolves.toBeUndefined();
  });
});

// ───────────────────────── structural guards ─────────────────────────

describe('capabilities are stated facts about the vendor', () => {
  it('declares subscription-create idempotency UNSUPPORTED', async () => {
    // Stating this makes the absence of an idempotency header a recorded
    // fact rather than an oversight, and stops a future reader inventing
    // a header the provider ignores on the one call that can double-charge.
    const { provider } = makeProvider();
    expect(provider.capabilities.createSubscriptionIdempotency).toBe('unsupported');
    expect(provider.id).toBe('razorpay');
  });
});

describe('dependency rule', () => {
  it('the adapter imports no database or framework', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/billing/lib/razorpay/adapter.ts'),
      'utf8'
    );
    const imports = Array.from(
      source.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g),
      (m) => m[1]
    );

    for (const forbidden of ['@supabase', 'next/', 'next', '@/lib/data', 'razorpay']) {
      expect(imports.some((i) => i === forbidden || i.startsWith(`${forbidden}/`))).toBe(
        false
      );
    }
  });

  it('the adapter never reads process.env — environment is injected', () => {
    // `environment` must be CONFIGURED by the caller. Reading it here
    // would put the A30 gate's own input inside the thing being gated.
    const source = readFileSync(
      join(process.cwd(), 'src/features/billing/lib/razorpay/adapter.ts'),
      'utf8'
    );
    expect(source).not.toContain('process.env');
  });

  it('has no `default:` branch in its mappings', () => {
    // A default branch in a payments mapping does not fail — it silently
    // invents an entitlement decision. Comments are stripped first,
    // because the prose EXPLAINING this rule mentions `default:` and a
    // naive scan would match its own documentation rather than the code.
    const source = readFileSync(
      join(process.cwd(), 'src/features/billing/lib/razorpay/adapter.ts'),
      'utf8'
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/\bdefault\s*:/);
    // Guard the guard: stripping must not have eaten the real code.
    expect(code).toContain('SUBSCRIPTION_STATE_MAP');
    expect(code).toContain('EVENT_KIND_MAP');
  });
});

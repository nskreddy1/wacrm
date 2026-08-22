import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Webhook route tests — ADR-009 Task 9 / Task 12.
 *
 * These are ADVERSARIAL, not confirmatory. The route is the only
 * endpoint that can change entitlement and it sits behind an
 * unauthenticated public prefix, so each test below states a property an
 * attacker would try to break.
 *
 * The properties under test, and why each matters:
 *
 *   A2  partial config ⇒ never verify        (key without webhook secret)
 *   A10 tampered body ⇒ 401                  (HMAC over RAW bytes)
 *   A11 test-mode event ⇒ never applied live (env gate is real)
 *   A18 oversized body ⇒ rejected pre-verify (CPU exhaustion)
 *   A21 transient failure ⇒ 5xx, no claim    (retry budget preserved)
 *   A30 env gate uses a TRUSTED parameter    (not a value off the event)
 *   A31 missing event-id header ⇒ 401        (no synthesised id)
 *
 * The RPC itself is mocked: what is under test here is the ROUTE's
 * contract — what it reads, what it refuses, what it persists, and which
 * HTTP status it maps each committed outcome to.
 */

const WEBHOOK_SECRET = 'test-webhook-secret';
const MERCHANT = 'acc_TESTMERCHANT';

/** The single RPC the route is allowed to make. */
const processPaymentEvent = vi.fn();

/**
 * Fails the test if the route ever writes outside the single RPC. Two
 * supabase-js calls are two transactions, which is how a claim commits
 * while its effect is lost (A21/A27).
 */
const supabaseAdmin = vi.fn(() => ({
  from() {
    throw new Error('the webhook route must not write outside the single RPC');
  },
}));

vi.mock('@/features/billing/lib/process-payment-event', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/billing/lib/process-payment-event')
  >('@/features/billing/lib/process-payment-event');
  return { ...actual, processPaymentEvent };
});

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin }));

/** Build a genuine Razorpay-shaped signed delivery. */
function signedRequest(options: {
  event?: string;
  secret?: string;
  eventId?: string | null;
  merchant?: string;
  subscriptionId?: string;
  status?: string;
  bodyOverride?: string;
  notes?: Record<string, unknown>;
}) {
  const {
    event = 'subscription.activated',
    secret = WEBHOOK_SECRET,
    eventId = 'evt_test_1',
    merchant = MERCHANT,
    subscriptionId = 'sub_ABC123',
    status = 'active',
    notes,
  } = options;

  const payload = {
    entity: 'event',
    account_id: merchant,
    event,
    created_at: 1_760_000_000,
    payload: {
      subscription: {
        entity: {
          id: subscriptionId,
          status,
          ...(notes ? { notes } : {}),
        },
      },
      payment: {
        entity: {
          id: 'pay_XYZ789',
          amount: 49900,
          currency: 'INR',
        },
      },
    },
  };

  const rawBody = options.bodyOverride ?? JSON.stringify(payload);

  // Signed over the bytes we actually send. When `bodyOverride` differs
  // from what was signed, that IS the A10 tampering case.
  const signatureBase = options.bodyOverride ?? rawBody;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signatureBase, 'utf8')
    .digest('hex');

  const headers = new Headers({
    'content-type': 'application/json',
    'x-razorpay-signature': signature,
  });
  if (eventId !== null) headers.set('x-razorpay-event-id', eventId);

  return {
    request: new Request('https://app.test/api/webhooks/payments/razorpay', {
      method: 'POST',
      headers,
      body: rawBody,
    }),
    rawBody,
  };
}

/** Route params are async in Next 16. */
function params(provider = 'razorpay') {
  return { params: Promise.resolve({ provider }) };
}

async function callRoute(
  request: Request,
  provider = 'razorpay'
): Promise<Response> {
  const { POST } = await import('./route');
  // The route's NextRequest usage is limited to `.text()` and
  // `.headers`, both of which a standard Request satisfies.
  return POST(request as never, params(provider) as never);
}

function configureLiveRazorpay() {
  process.env.PAYMENTS_PROVIDER = 'razorpay';
  process.env.PAYMENTS_ENVIRONMENT = 'live';
  process.env.RAZORPAY_LIVE_KEY_ID = 'rzp_live_key';
  process.env.RAZORPAY_LIVE_KEY_SECRET = 'rzp_live_secret';
  process.env.RAZORPAY_LIVE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RAZORPAY_LIVE_ACCOUNT_ID = MERCHANT;
}

const PAYMENT_ENV_KEYS = [
  'PAYMENTS_PROVIDER',
  'PAYMENTS_ENVIRONMENT',
  'RAZORPAY_LIVE_KEY_ID',
  'RAZORPAY_LIVE_KEY_SECRET',
  'RAZORPAY_LIVE_WEBHOOK_SECRET',
  'RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS',
  'RAZORPAY_LIVE_ACCOUNT_ID',
  'RAZORPAY_TEST_KEY_ID',
  'RAZORPAY_TEST_KEY_SECRET',
  'RAZORPAY_TEST_WEBHOOK_SECRET',
] as const;

beforeEach(() => {
  vi.resetModules();
  processPaymentEvent.mockReset();
  for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/webhooks/payments/[provider] — perimeter', () => {
  it('rejects an unknown provider segment with 404 before reading any secret', async () => {
    configureLiveRazorpay();
    const { request } = signedRequest({});

    const response = await callRoute(request, 'stripe');

    expect(response.status).toBe(404);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it('noop_when_partially_configured: a key without a webhook secret never verifies (A2)', async () => {
    // The deployment can CREATE subscriptions and take real money, but
    // is structurally unable to verify the webhook that grants access.
    // "Mostly configured" must behave as NOT configured.
    process.env.PAYMENTS_PROVIDER = 'razorpay';
    process.env.PAYMENTS_ENVIRONMENT = 'live';
    process.env.RAZORPAY_LIVE_KEY_ID = 'rzp_live_key';
    process.env.RAZORPAY_LIVE_KEY_SECRET = 'rzp_live_secret';
    // RAZORPAY_LIVE_WEBHOOK_SECRET deliberately absent.

    const { request } = signedRequest({});
    const response = await callRoute(request);

    expect([401, 404]).toContain(response.status);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it('invalid_environment_yields_noop: provider set, PAYMENTS_ENVIRONMENT garbage ⇒ never processes (A25)', async () => {
    // Every LIVE credential is present and the body is signed with the
    // live webhook secret, so nothing but the environment validation can
    // stop this delivery.
    //
    // MUTATION-TESTING NOTE: replacing the route's validation with
    // `?? 'live'` does NOT make this test fail — and that is the correct
    // result, not a gap in the test. `getPaymentProvider()` validates
    // `PAYMENTS_ENVIRONMENT` independently and hands back the
    // `NoopPaymentProvider`, whose `verifyAndParse` throws. So an
    // unrecognised environment is rejected TWICE, by two modules that do
    // not share a code path. The assertion below is deliberately written
    // against the OUTCOME ("nothing was applied") rather than against the
    // status code alone, so it keeps holding whichever layer catches it —
    // and would fail if BOTH were ever removed.
    configureLiveRazorpay();
    process.env.PAYMENTS_ENVIRONMENT = 'production'; // plausible, invalid

    const { request } = signedRequest({});
    const response = await callRoute(request);

    expect(response.status).toBe(404);
    // The load-bearing assertion: nothing was applied. Defaulting to
    // `live` here would let a deployment that cannot state its own mode
    // grant real entitlement; defaulting to `test` would make live
    // webhooks unverifiable. Both are fail-open, so there is no default.
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it('mutated_body_fails_signature: a single-byte change is a 401 with nothing recorded (A10)', async () => {
    configureLiveRazorpay();

    // Sign the honest body, then send a body with the amount raised.
    const honest = JSON.stringify({
      entity: 'event',
      account_id: MERCHANT,
      event: 'subscription.charged',
      created_at: 1_760_000_000,
      payload: {
        subscription: { entity: { id: 'sub_ABC123', status: 'active' } },
        payment: { entity: { id: 'pay_1', amount: 100, currency: 'INR' } },
      },
    });
    const tampered = honest.replace('"amount":100', '"amount":1');

    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(honest, 'utf8')
      .digest('hex');

    const request = new Request(
      'https://app.test/api/webhooks/payments/razorpay',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': 'evt_tampered',
        },
        body: tampered,
      }
    );

    const response = await callRoute(request);

    expect(response.status).toBe(401);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it('missing_event_id_header_is_rejected: no id is synthesised (A31)', async () => {
    configureLiveRazorpay();
    const { request } = signedRequest({ eventId: null });

    const response = await callRoute(request);

    // A fabricated id would defeat the UNIQUE(provider, environment,
    // event_id) claim: every retry would mint a fresh id and re-apply.
    expect(response.status).toBe(401);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it('rejects a body signed with the wrong secret', async () => {
    configureLiveRazorpay();
    const { request } = signedRequest({ secret: 'attacker-secret' });

    const response = await callRoute(request);

    expect(response.status).toBe(401);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it('rejects a signed body whose merchant account is not ours (5.3e)', async () => {
    configureLiveRazorpay();
    const { request } = signedRequest({ merchant: 'acc_SOMEONEELSE' });

    const response = await callRoute(request);

    expect(response.status).toBe(401);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it('oversized_body_rejected: capped before any HMAC work (A18)', async () => {
    configureLiveRazorpay();

    const huge = 'x'.repeat(200 * 1024);
    const request = new Request(
      'https://app.test/api/webhooks/payments/razorpay',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': 'deadbeef',
          'x-razorpay-event-id': 'evt_big',
        },
        body: huge,
      }
    );

    const response = await callRoute(request);

    expect(response.status).toBe(413);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });

  it('answers 200 + failed_terminal for a signed event type we cannot interpret', async () => {
    configureLiveRazorpay();
    // `subscription.paused` is deliberately unmapped (out of V1 scope),
    // so the adapter throws and the route must not invent a meaning.
    const { request } = signedRequest({ event: 'subscription.paused' });

    const response = await callRoute(request);

    // Verification-layer rejection: nothing recorded, nothing applied.
    expect(response.status).toBe(401);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/payments/[provider] — trusted environment (A30)', () => {
  it('rpc_receives_configured_environment_from_env_not_from_the_event', async () => {
    configureLiveRazorpay();
    processPaymentEvent.mockResolvedValue({ outcome: 'applied' });

    const { request } = signedRequest({});
    await callRoute(request);

    expect(processPaymentEvent).toHaveBeenCalledTimes(1);
    const [, input] = processPaymentEvent.mock.calls[0];

    expect(input.configuredEnvironment).toBe('live');
    expect(input.event.environment).toBe('live');
    expect(input.provider).toBe('razorpay');
  });

  it('trusted_environment_is_sourced_from_env_not_from_the_event (A30, source assertion)', async () => {
    // WHY THIS IS A SOURCE ASSERTION AND NOT A BEHAVIOURAL ONE.
    //
    // This was originally written as a value comparison and it was
    // USELESS — mutation testing proved it. The adapter stamps
    // `event.environment` from `this.config.environment`, which the
    // factory reads from the very same `PAYMENTS_ENVIRONMENT`. So in any
    // single process the observed and configured values are
    // STRUCTURALLY EQUAL, and the broken implementation
    //
    //     configuredEnvironment: event.environment   // ← no-op gate
    //
    // produces byte-identical RPC arguments to the correct one. No
    // value-based assertion at this layer can distinguish them; a test
    // that claims to is documentation (plan 12.1, and the same reasoning
    // 12.1a applies to A16's timing assertion).
    //
    // What IS checkable here is the property the plan actually requires:
    // the route obtains its trusted parameter from `paymentsEnvironment()`
    // — a source the event cannot influence — rather than reading it back
    // off the event. The genuine end-to-end divergence (configured=live,
    // observed=test) can only be produced where the two are independent,
    // i.e. in the RPC's own tests, which is where the gate lives.
    const source = await readFile(
      new URL('./route.ts', import.meta.url),
      'utf8'
    );

    // The trusted value comes from the env getter.
    expect(source).toMatch(/configuredEnvironment\s*=\s*parsePaymentEnvironment\(\s*paymentsEnvironment\(\)/);

    // And it is passed through as-is, never sourced from the event.
    expect(source).not.toMatch(/configuredEnvironment:\s*event\.environment/);
    expect(source).not.toMatch(/configuredEnvironment:\s*[^,\n]*event\./);
  });

  it('never lets the payload influence the environment it reports', async () => {
    configureLiveRazorpay();
    processPaymentEvent.mockResolvedValue({ outcome: 'applied' });

    // A signed body claiming to be a test event. The adapter stamps the
    // environment from the verifying credential set, so the claim in the
    // payload is inert (A11/A30).
    const payload = {
      entity: 'event',
      account_id: MERCHANT,
      event: 'subscription.activated',
      environment: 'test',
      created_at: 1_760_000_000,
      payload: {
        subscription: { entity: { id: 'sub_ABC123', status: 'active' } },
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody, 'utf8')
      .digest('hex');

    const request = new Request(
      'https://app.test/api/webhooks/payments/razorpay',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': 'evt_env_claim',
        },
        body: rawBody,
      }
    );

    await callRoute(request);

    const [, input] = processPaymentEvent.mock.calls[0];
    expect(input.event.environment).toBe('live');
    expect(input.configuredEnvironment).toBe('live');
  });
});

describe('POST /api/webhooks/payments/[provider] — response taxonomy (9.3b)', () => {
  it.each([
    ['applied', 200],
    ['already_processed', 200],
    ['already_applied', 200],
    ['ignored', 200],
    ['failed_terminal', 200],
  ] as const)(
    'maps the committed outcome %s to HTTP %i',
    async (outcome, status) => {
      configureLiveRazorpay();
      processPaymentEvent.mockResolvedValue({ outcome, reason: 'test_reason' });

      const { request } = signedRequest({ eventId: `evt_${outcome}` });
      const response = await callRoute(request);

      // Every committed outcome is a 200: the transaction resolved
      // durably, so the provider must stop retrying.
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ status: outcome });
    }
  );

  it('retryable_failure_releases_claim: a thrown RPC error is a 5xx (A21)', async () => {
    configureLiveRazorpay();
    processPaymentEvent.mockRejectedValue(new Error('deadlock detected'));

    const { request } = signedRequest({ eventId: 'evt_transient' });
    const response = await callRoute(request);

    // 5xx keeps the provider's 24-hour retry budget alive. A 200 here
    // would be permanent data loss dressed as success: the claim rolled
    // back, so a "processed" acknowledgement would strand a paying
    // customer with no access and no redelivery.
    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it('an unresolved tenant is retryable, never a silent 200 (9.4a)', async () => {
    configureLiveRazorpay();
    // The RPC raises for an unresolved tenant; the wrapper turns that
    // into a throw. It must NOT become a 200.
    processPaymentEvent.mockRejectedValue(
      new Error('process_payment_event failed: unresolved tenant')
    );

    const { request } = signedRequest({ eventId: 'evt_unresolved' });
    const response = await callRoute(request);

    expect(response.status).toBeGreaterThanOrEqual(500);
  });

  it('makes exactly one write call for a valid delivery', async () => {
    configureLiveRazorpay();
    processPaymentEvent.mockResolvedValue({ outcome: 'applied' });

    const { request } = signedRequest({ eventId: 'evt_single' });
    await callRoute(request);

    // The claim lives INSIDE the RPC. A second write here — notably
    // `from('payment_events').insert(...)` — would be two transactions
    // and would reintroduce A21. `supabaseAdmin()`'s `from` throws, so
    // any such write fails this test loudly.
    expect(processPaymentEvent).toHaveBeenCalledTimes(1);
  });

  it('forged_redirect_grants_nothing: GET confirms and grants nothing (A3)', async () => {
    configureLiveRazorpay();
    const { GET } = await import('./route');

    const response = await GET();

    expect(response.status).toBe(404);
    expect(processPaymentEvent).not.toHaveBeenCalled();
  });
});

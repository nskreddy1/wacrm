// ============================================================
// ADR-009 Task 12 — RED TEAM.
//
// Adversarial, not confirmatory. Every test here is named for the
// attack it defends (A1–A35 of the plan's attack tree) and asserts a
// SECURITY OUTCOME, not an implementation detail.
//
// THE ATTACKER MODEL, ASSUMED BY EVERY TEST IN THIS FILE
// They hold a valid session on their own free workspace, can read all
// client-side code, can replay and craft arbitrary HTTP requests, know
// Razorpay's public API and event shapes, and have a legitimate paid
// account elsewhere. They do NOT have our webhook secret and they do
// NOT have database access.
//
// EVERY TEST HERE WAS MADE TO FAIL FIRST (12.1). A red-team test that
// has never failed is documentation. Each defense was temporarily
// reverted, the test observed failing, then the defense restored. The
// `MUTATION:` note on each block records the exact reversion used, so
// the next person can repeat it instead of trusting this comment.
//
// WHAT IS DELIBERATELY *NOT* IN THIS FILE
// Attacks whose defense lives inside Postgres — the event claim, the
// `FOR UPDATE` lock, RLS, the transition table, transaction rollback,
// and the RPC's environment gate — cannot be honestly proven from
// Vitest. Asserting them against a mocked supabase client would test
// the mock, not the database, and would give false confidence on
// exactly the money-critical paths. Those live in
// `supabase/tests/billing_attacks.sql` (pgTAP) and are listed in the
// `DB-RESIDENT` manifest at the bottom of this file so the split is
// explicit rather than an omission someone has to notice.
// ============================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildParams } from '../process-payment-event';
import {
  getPaymentProvider,
  hasPaymentsConfigured,
  parsePaymentEnvironment,
} from '../provider-factory';
import { NoopPaymentProvider } from '../noop';
import { RazorpayPaymentProvider } from '../razorpay/adapter';
import {
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  verifyRazorpayDelivery,
} from '../razorpay/verify';
import {
  PaymentsUnavailableError,
  WebhookVerificationError,
  type PaymentEvent,
} from '@/lib/ports/payment-provider';

// ── Attacker toolkit ────────────────────────────────────────────

const SECRET = 'whsec_the_secret_the_attacker_does_not_have';

/** Sign a body the way Razorpay does: HMAC-SHA256 over the RAW bytes. */
function sign(rawBody: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function headers(rawBody: string, overrides: Record<string, string> = {}) {
  return {
    [RAZORPAY_SIGNATURE_HEADER]: sign(rawBody),
    [RAZORPAY_EVENT_ID_HEADER]: 'evt_genuine_001',
    ...overrides,
  };
}

/** A genuine, minimal `subscription.charged` body. */
function chargedBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: 'subscription.charged',
    account_id: 'acc_merchant',
    payload: {
      subscription: {
        entity: { id: 'sub_ABCDEFGHIJKLMN', status: 'active', notes: {} },
      },
      payment: { entity: { id: 'pay_ABCDEFGHIJKLMN', amount: 49900, currency: 'INR' } },
    },
    ...overrides,
  });
}

function readSource(relative: string): string {
  return fs.readFileSync(
    path.join(__dirname, '..', relative),
    'utf8'
  );
}

/**
 * Strip comments and string literals before asserting on CODE.
 *
 * Without this, a source-level assertion is defeated by its own
 * documentation: `checkout/route.ts` explains that it "never calls
 * process_payment_event()", and a naive regex matches that sentence and
 * reports the route as vulnerable. Prose is not behaviour — and the
 * inverse error is worse, since a reader who "fixes" the test by
 * deleting the comment would hide the real signal.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // line comments (keep URLs)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ================================================================
// A10 / A16 / A31 / A35 — the verification perimeter.
//
// `/api/webhooks/` is a PUBLIC, UNAUTHENTICATED prefix. This signature
// check is the entire boundary between the internet and a function
// that grants paid access, so these are the highest-value tests here.
// ================================================================

describe('A10 — valid signature, tampered body', () => {
  // MUTATION: in `verify.ts`, move `JSON.parse` above the HMAC and sign
  // the re-serialised string ⇒ this test passes a mutated body.
  it('mutated_body_fails_signature', () => {
    const original = chargedBody();
    const captured = headers(original);

    // The attacker raises the amount on a body they captured verbatim.
    const tampered = original.replace('49900', '4990000');
    expect(tampered).not.toBe(original);

    expect(() =>
      verifyRazorpayDelivery(tampered, captured, { current: SECRET })
    ).toThrow(WebhookVerificationError);
  });

  it('rejects a body whose keys were merely reordered', () => {
    // The subtler form: semantically identical JSON, different bytes.
    // A verifier that parsed first and re-serialised would accept this,
    // which is the same bug that makes A10 exploitable.
    const original = chargedBody();
    const reordered = JSON.stringify(JSON.parse(original), [
      'payload',
      'event',
      'account_id',
    ]);

    expect(() =>
      verifyRazorpayDelivery(reordered, headers(original), { current: SECRET })
    ).toThrow(WebhookVerificationError);
  });

  it('a truncated signature is not accepted as a prefix', () => {
    // `Buffer.from(hex)` truncates at the first invalid character, so a
    // short/odd-length digest could otherwise compare equal against a
    // correspondingly truncated buffer.
    const raw = chargedBody();
    const full = sign(raw);

    for (const forged of [full.slice(0, 32), full.slice(0, 2), 'zz' + full.slice(2)]) {
      expect(() =>
        verifyRazorpayDelivery(
          raw,
          { ...headers(raw), [RAZORPAY_SIGNATURE_HEADER]: forged },
          { current: SECRET }
        )
      ).toThrow(WebhookVerificationError);
    }
  });
});

describe('A16 — timing attack on the signature comparison', () => {
  // 12.1a: this is an IMPLEMENTATION assertion, deliberately not a
  // statistical one. A JIT, a noisy runner and GC make a timing
  // measurement flaky at best and meaningless at worst. Constant-time
  // behaviour is a property of the primitive; the test's job is to
  // prove we chose that primitive and did not regress to `===`.
  //
  // MUTATION: replace `crypto.timingSafeEqual(a, b)` with `a.equals(b)`
  // ⇒ the first assertion fails.
  it('verify_uses_constant_time_comparison', () => {
    const source = readSource('razorpay/verify.ts');

    expect(source).toMatch(/crypto\.timingSafeEqual\(/);

    // The length guard must exist: `timingSafeEqual` THROWS on unequal
    // lengths, and an uncaught throw there would leak "wrong length" as
    // an outcome distinguishable from "wrong digest".
    expect(source).toMatch(/a\.length !== b\.length/);

    // And no direct equality on the digest anywhere in the file.
    expect(source).not.toMatch(/signature\s*===\s*expected/);
    expect(source).not.toMatch(/\.equals\(/);
  });

  it('a length-mismatched signature is rejected without throwing a RangeError', () => {
    const raw = chargedBody();
    // A bare `timingSafeEqual` on these would throw RangeError, not a
    // WebhookVerificationError — a different error class is itself an
    // oracle, and would bypass the route's 401 mapping.
    expect(() =>
      verifyRazorpayDelivery(
        raw,
        { ...headers(raw), [RAZORPAY_SIGNATURE_HEADER]: 'abcd' },
        { current: SECRET }
      )
    ).toThrow(WebhookVerificationError);
  });
});

describe('A31 — strip the event-id header so an id gets synthesised', () => {
  // MUTATION: fall back to `eventId ?? crypto.randomUUID()` (or a hash
  // of the body, or `Date.now()`) ⇒ both tests pass and every redelivery
  // mints a fresh identity, defeating the UNIQUE event claim entirely.
  it('missing_event_id_header_is_rejected', () => {
    const raw = chargedBody();
    const { [RAZORPAY_EVENT_ID_HEADER]: _dropped, ...withoutEventId } = headers(raw);

    expect(() =>
      verifyRazorpayDelivery(raw, withoutEventId, { current: SECRET })
    ).toThrow(/refusing to synthesise an event id/);
  });

  it('an empty or whitespace-only event id is rejected, not defaulted', () => {
    const raw = chargedBody();
    for (const blank of ['', '   ', '\t']) {
      expect(() =>
        verifyRazorpayDelivery(
          raw,
          { ...headers(raw), [RAZORPAY_EVENT_ID_HEADER]: blank },
          { current: SECRET }
        )
      ).toThrow(WebhookVerificationError);
    }
  });

  it('never synthesises an id from the payload or the clock', () => {
    const source = readSource('razorpay/verify.ts');
    // Guard the specific shapes a "helpful" refactor reaches for.
    expect(source).not.toMatch(/randomUUID/);
    expect(source).not.toMatch(/Date\.now\(\)/);
    expect(source).not.toMatch(/eventId\s*(\?\?|\|\|)\s*/);
  });
});

describe('A35 — replay a signed body under a substituted event id', () => {
  // The exact point of A35 is that verification is NOT where this is
  // stopped: the HMAC covers the body, and the event id travels in a
  // header OUTSIDE the base string. Anyone holding a validly-signed
  // body (leaked log, TLS interception, insider) can mint a fresh
  // event identity. So this test asserts the UNCOMFORTABLE truth, and
  // the money defense is asserted at the ledger in pgTAP.
  //
  // MUTATION: none possible here — a test that expected a throw would
  // be asserting a false belief about where this attack dies.
  it('replayed_body_with_new_event_id_still_verifies_by_design', () => {
    const raw = chargedBody();
    const captured = headers(raw);

    const first = verifyRazorpayDelivery(raw, captured, { current: SECRET });
    const replayed = verifyRazorpayDelivery(
      raw,
      { ...captured, [RAZORPAY_EVENT_ID_HEADER]: 'evt_attacker_minted_999' },
      { current: SECRET }
    );

    // Both verify. The event-level claim is bypassed.
    expect(first.eventId).toBe('evt_genuine_001');
    expect(replayed.eventId).toBe('evt_attacker_minted_999');

    // The identical payload digest is what makes the anomaly detectable
    // and what the ledger's provider_ref uniqueness keys off downstream.
    expect(replayed.payloadDigest).toBe(first.payloadDigest);
  });

  it('payload_digest is never itself the idempotency key', () => {
    // `UNIQUE (provider, environment, payload_digest)` would reject
    // legitimate identical-payload events (two ₹499 charges in the same
    // period are genuinely distinct) — the plan forbids it explicitly.
    const migrations = fs.readdirSync(
      path.join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations')
    );
    const billing = migrations.filter((f) => /payment|subscri|billing/i.test(f));
    expect(billing.length).toBeGreaterThan(0);

    for (const file of billing) {
      const sql = fs.readFileSync(
        path.join(
          __dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations', file
        ),
        'utf8'
      );
      expect(sql).not.toMatch(/UNIQUE\s*\([^)]*payload_digest/i);
      expect(sql).not.toMatch(/unique\s+index[^;]*payload_digest/i);
    }
  });
});

// ================================================================
// A2 / A25 — fail-closed configuration.
//
// These two are the "insecure defaults" class: the vulnerability is
// not a bad check, it is a MISSING check plus a plausible default.
// ================================================================

describe('A2 — API key configured, webhook secret absent', () => {
  // The dangerous state: the deployment can create real subscriptions
  // and take real money while being structurally unable to verify the
  // webhook that grants the customer access.
  //
  // MUTATION: in `razorpayCredentials`, drop `webhookSecret` from the
  // `if (!keyId || !keySecret || !webhookSecret) return undefined`
  // guard ⇒ a real adapter is returned with no way to verify anything.
  it('noop_when_partially_configured', () => {
    vi.stubEnv('PAYMENTS_PROVIDER', 'razorpay');
    vi.stubEnv('PAYMENTS_ENVIRONMENT', 'live');
    vi.stubEnv('RAZORPAY_LIVE_KEY_ID', 'rzp_live_key');
    vi.stubEnv('RAZORPAY_LIVE_KEY_SECRET', 'rzp_live_secret');
    // The webhook secret is the one thing missing.
    vi.stubEnv('RAZORPAY_LIVE_WEBHOOK_SECRET', '');

    expect(hasPaymentsConfigured()).toBe(false);
    expect(
      getPaymentProvider({ resolveProviderPlanRef: async () => 'plan_ABCDEFGHIJKLMN' })
    ).toBeInstanceOf(NoopPaymentProvider);
  });

  it('the noop refuses to verify rather than accepting', async () => {
    // "Unconfigured ⇒ skip verification" is the fail-open form of this
    // bug. Every Noop method must throw, including the read-only ones:
    // a `fetchSubscription` that returned empty would let the
    // reconciliation cron revoke access for every paying customer
    // because an env var went missing.
    const noop = new NoopPaymentProvider();
    await expect(noop.verifyAndParse()).rejects.toThrow(PaymentsUnavailableError);
    await expect(noop.createCheckout()).rejects.toThrow(PaymentsUnavailableError);
    await expect(noop.fetchSubscription()).rejects.toThrow(PaymentsUnavailableError);
    await expect(noop.cancelAtPeriodEnd()).rejects.toThrow(PaymentsUnavailableError);
  });

  it('verification with no configured secret throws instead of skipping', () => {
    const raw = chargedBody();
    for (const secrets of [undefined, { current: '' }, { current: '   ' }]) {
      expect(() => verifyRazorpayDelivery(raw, headers(raw), secrets)).toThrow(
        /not configured/
      );
    }
  });
});

describe('A25 — PAYMENTS_ENVIRONMENT absent or garbage', () => {
  // Both possible defaults are fail-open, which is why there is no
  // default: `test` makes live webhooks unverifiable (revenue loss),
  // `live` lets a sandbox event grant real entitlement (theft).
  //
  // MUTATION: `parsePaymentEnvironment` → `return raw === 'test' ? 'test' : 'live'`
  // ⇒ `invalid_environment_yields_noop` fails on every garbage value.
  it('invalid_environment_yields_noop', () => {
    vi.stubEnv('PAYMENTS_PROVIDER', 'razorpay');
    vi.stubEnv('RAZORPAY_LIVE_KEY_ID', 'rzp_live_key');
    vi.stubEnv('RAZORPAY_LIVE_KEY_SECRET', 'rzp_live_secret');
    vi.stubEnv('RAZORPAY_LIVE_WEBHOOK_SECRET', 'whsec_live');
    vi.stubEnv('RAZORPAY_TEST_KEY_ID', 'rzp_test_key');
    vi.stubEnv('RAZORPAY_TEST_KEY_SECRET', 'rzp_test_secret');
    vi.stubEnv('RAZORPAY_TEST_WEBHOOK_SECRET', 'whsec_test');

    // Every one of these is a plausible-looking value someone would
    // expect to "just work". None may resolve.
    for (const bad of [
      '', 'production', 'prod', 'sandbox', 'Live', 'LIVE', 'TEST', 'staging', 'dev', 'true',
    ]) {
      vi.stubEnv('PAYMENTS_ENVIRONMENT', bad);
      expect(parsePaymentEnvironment(bad)).toBeUndefined();
      expect(hasPaymentsConfigured()).toBe(false);
      expect(
        getPaymentProvider({ resolveProviderPlanRef: async () => 'plan_ABCDEFGHIJKLMN' })
      ).toBeInstanceOf(NoopPaymentProvider);
    }
  });

  it('only the exact strings test and live are accepted', () => {
    expect(parsePaymentEnvironment('test')).toBe('test');
    expect(parsePaymentEnvironment('live')).toBe('live');
    expect(parsePaymentEnvironment(undefined)).toBeUndefined();
  });

  it('an unknown provider id never selects a default provider', () => {
    vi.stubEnv('PAYMENTS_ENVIRONMENT', 'live');
    vi.stubEnv('RAZORPAY_LIVE_KEY_ID', 'rzp_live_key');
    vi.stubEnv('RAZORPAY_LIVE_KEY_SECRET', 'rzp_live_secret');
    vi.stubEnv('RAZORPAY_LIVE_WEBHOOK_SECRET', 'whsec_live');

    // Case variants and other vendors must NOT resolve. Note that
    // surrounding whitespace is deliberately absent from this list —
    // see the trimming test below for why that is not a hole.
    for (const bad of ['razorPay', 'stripe', 'RAZORPAY', 'razorpay2', 'noop']) {
      vi.stubEnv('PAYMENTS_PROVIDER', bad);
      expect(
        getPaymentProvider({ resolveProviderPlanRef: async () => 'plan_ABCDEFGHIJKLMN' })
      ).toBeInstanceOf(NoopPaymentProvider);
    }
  });

  it('trims surrounding whitespace on the provider id, by design', () => {
    // `env.read()` trims every value, so `PAYMENTS_PROVIDER="razorpay "`
    // resolves. This is deliberate and is NOT the A25 fail-open shape:
    // it normalises a copy-paste error into the SAME explicitly-named
    // provider rather than defaulting an absent/unknown value to one.
    // An attacker cannot set our environment variables, so the only
    // party affected is the operator who typed it.
    vi.stubEnv('PAYMENTS_PROVIDER', ' razorpay ');
    vi.stubEnv('PAYMENTS_ENVIRONMENT', ' live ');
    vi.stubEnv('RAZORPAY_LIVE_KEY_ID', 'rzp_live_key');
    vi.stubEnv('RAZORPAY_LIVE_KEY_SECRET', 'rzp_live_secret');
    vi.stubEnv('RAZORPAY_LIVE_WEBHOOK_SECRET', 'whsec_live');

    expect(hasPaymentsConfigured()).toBe(true);

    // Crucially, trimming normalises — it never INVENTS. An empty or
    // whitespace-only value still resolves to undefined, not a default.
    vi.stubEnv('PAYMENTS_PROVIDER', '   ');
    expect(hasPaymentsConfigured()).toBe(false);
  });

  it('credentials are read only for the configured environment', () => {
    // This is what makes "the environment stamped on an event is the
    // credential set that verified its signature" true by construction.
    // If a live deployment could fall back to test credentials, A11
    // becomes exploitable at the credential layer.
    vi.stubEnv('PAYMENTS_PROVIDER', 'razorpay');
    vi.stubEnv('PAYMENTS_ENVIRONMENT', 'live');
    vi.stubEnv('RAZORPAY_TEST_KEY_ID', 'rzp_test_key');
    vi.stubEnv('RAZORPAY_TEST_KEY_SECRET', 'rzp_test_secret');
    vi.stubEnv('RAZORPAY_TEST_WEBHOOK_SECRET', 'whsec_test');
    // No LIVE credentials at all.

    expect(hasPaymentsConfigured()).toBe(false);
  });
});

// ================================================================
// A29 / A33 — the adapter's outbound and inbound contracts.
// ================================================================

describe('A33 — smuggle a seat quantity to multiply the amount', () => {
  function adapterWith(capture: { body?: unknown }) {
    const client = {
      request: vi.fn(async (_m: string, _p: string, body: unknown) => {
        capture.body = body;
        return {
          id: 'sub_ABCDEFGHIJKLMN',
          short_url: 'https://rzp.io/i/authorise',
          notes: { auxelon_checkout_intent: '11111111-1111-4111-8111-111111111111' },
        };
      }),
    };
    const provider = new RazorpayPaymentProvider(client as never, {
      environment: 'test',
      webhookSecrets: { current: SECRET },
      resolveProviderPlanRef: async () => 'plan_ABCDEFGHIJKLMN',
    });
    return { provider, client };
  }

  // MUTATION: change the adapter's `quantity: 1` to
  // `quantity: (intent as any).quantity ?? 1` and add `quantity` to the
  // intent ⇒ this test fails, and the amount becomes attacker-scaled.
  it('adapter_always_sends_quantity_one', async () => {
    const capture: { body?: unknown } = {};
    const { provider } = adapterWith(capture);

    await provider.createCheckout({
      intentId: '11111111-1111-4111-8111-111111111111',
      accountId: 'acc-1',
      planId: 'pro',
      interval: 'monthly',
      amountMinor: 49900,
      currency: 'INR',
      // The attacker's smuggled field, present on the object the
      // adapter receives. It must not survive into the provider call.
      ...({ quantity: 100 } as Record<string, never>),
    });

    const body = capture.body as Record<string, unknown>;
    expect(body.quantity).toBe(1);
  });

  it('the outbound body is a closed contract of exactly five keys', async () => {
    // A "completeness" refactor that spreads the intent into the body is
    // how a per-seat field would arrive. Pinning the key SET — not just
    // the quantity value — is what stops that class of change.
    const capture: { body?: unknown } = {};
    const { provider } = adapterWith(capture);

    await provider.createCheckout({
      intentId: '11111111-1111-4111-8111-111111111111',
      accountId: 'acc-1',
      planId: 'pro',
      interval: 'monthly',
      amountMinor: 49900,
      currency: 'INR',
    });

    expect(Object.keys(capture.body as object).sort()).toEqual([
      'customer_notify',
      'notes',
      'plan_id',
      'quantity',
      'total_count',
    ]);
  });

  it('no client-supplied amount is ever sent to the provider', async () => {
    // The amount travels on `CheckoutIntent` only so the adapter can
    // REPORT it. It must not appear in the provider request: Razorpay
    // derives the charge from the plan ref.
    const capture: { body?: unknown } = {};
    const { provider } = adapterWith(capture);

    await provider.createCheckout({
      intentId: '11111111-1111-4111-8111-111111111111',
      accountId: 'acc-1',
      planId: 'pro',
      interval: 'monthly',
      amountMinor: 49900,
      currency: 'INR',
    });

    const serialised = JSON.stringify(capture.body);
    expect(serialised).not.toContain('49900');
    expect(serialised).not.toContain('amount');
  });
});

describe('A29 — a note that tries to name an account', () => {
  function verifyingAdapter() {
    return new RazorpayPaymentProvider({ request: vi.fn() } as never, {
      environment: 'test',
      webhookSecrets: { current: SECRET },
      resolveProviderPlanRef: async () => {
        throw new Error('not needed');
      },
    });
  }

  // MUTATION: read `notes.account_id` into any tenant-bearing field on
  // the returned event ⇒ this test fails. The relaxation that allows a
  // correlation LOCATOR must not be read as allowing a tenant CLAIM.
  it('note_cannot_name_an_account', async () => {
    const raw = JSON.stringify({
      event: 'subscription.charged',
      account_id: 'acc_merchant',
      payload: {
        subscription: {
          entity: {
            id: 'sub_ABCDEFGHIJKLMN',
            status: 'active',
            notes: {
              // Every shape an attacker would try.
              account_id: 'victim-account-uuid',
              accountId: 'victim-account-uuid',
              auxelon_account_id: 'victim-account-uuid',
              plan_id: 'enterprise',
              amount: 1,
            },
          },
        },
        payment: {
          entity: { id: 'pay_ABCDEFGHIJKLMN', amount: 49900, currency: 'INR' },
        },
      },
    });

    const event: PaymentEvent = await verifyingAdapter().verifyAndParse({
      rawBody: raw,
      headers: headers(raw),
    });

    // The port has no tenant field at all — that is the structural
    // defense. Assert it stayed that way, and that no plan/price
    // authority leaked in either.
    const asRecord = event as unknown as Record<string, unknown>;
    for (const forbidden of [
      'accountId', 'account_id', 'planId', 'plan_id', 'amount', 'price',
    ]) {
      expect(asRecord[forbidden]).toBeUndefined();
    }

    // A note that is not a UUID locator must not become one.
    expect(event.correlationIntentId).toBeUndefined();
  });

  it('a non-uuid correlation note is rejected rather than passed through', async () => {
    const raw = JSON.stringify({
      event: 'subscription.charged',
      account_id: 'acc_merchant',
      payload: {
        subscription: {
          entity: {
            id: 'sub_ABCDEFGHIJKLMN',
            status: 'active',
            notes: { auxelon_checkout_intent: "'; DROP TABLE payment_events; --" },
          },
        },
        payment: {
          entity: { id: 'pay_ABCDEFGHIJKLMN', amount: 49900, currency: 'INR' },
        },
      },
    });

    const event = await verifyingAdapter().verifyAndParse({
      rawBody: raw,
      headers: headers(raw),
    });

    expect(event.correlationIntentId).toBeUndefined();
  });
});

// ================================================================
// A30 — the RPC environment gate's two trust levels.
// ================================================================

describe('A30 — deliver a test-mode event to a live deployment', () => {
  // The bug this guards is subtle and was real once: a gate that reads
  // the environment off the EVENT and compares it to the EVENT checks
  // nothing. The trusted value must arrive from outside the payload,
  // because Postgres cannot read `PAYMENTS_ENVIRONMENT` itself.
  //
  // MUTATION: set `p_event_environment: configuredEnvironment` ⇒ the
  // first test fails and the gate silently becomes a tautology.
  const event: PaymentEvent = {
    eventId: 'evt_1',
    providerEventType: 'subscription.charged',
    kind: 'charged',
    environment: 'test', // observed: stamped by the verifying credential set
    providerRef: 'pay_ABCDEFGHIJKLMN',
  };

  it('passes the observed and configured environments as distinct params', () => {
    const params = buildParams({
      provider: 'razorpay',
      configuredEnvironment: 'live', // trusted: this deployment is live
      event,
    });

    expect(params.p_environment).toBe('live');
    expect(params.p_event_environment).toBe('test');
    // The whole point: they must be able to differ.
    expect(params.p_environment).not.toBe(params.p_event_environment);
  });

  it('never derives the trusted environment from the event', () => {
    const source = readSource('process-payment-event.ts');
    // `p_environment` must be bound to the caller's value, never the
    // event's. This is the source-level form of the same invariant.
    expect(source).toMatch(/p_environment:\s*configuredEnvironment/);
    expect(source).toMatch(/p_event_environment:\s*event\.environment/);
    expect(source).not.toMatch(/p_environment:\s*event\./);
  });

  it('a correlation locator is passed as a locator, never as a tenant', () => {
    const params = buildParams({
      provider: 'razorpay',
      configuredEnvironment: 'live',
      event: { ...event, correlationIntentId: '11111111-1111-4111-8111-111111111111' },
    });

    expect(params.p_correlation_intent_id).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    // There is no account parameter to smuggle a tenant through.
    expect(Object.keys(params)).not.toContain('p_account_id');
  });
});

// ================================================================
// A3 — the return URL grants nothing.
// ================================================================

describe('A3 — call the success/return path directly', () => {
  // MUTATION: add a `process_payment_event` / `plan_id` write to any
  // non-webhook billing route ⇒ these assertions fail.
  it('forged_redirect_grants_nothing', () => {
    // Entitlement may be written by exactly two callers: the verified
    // webhook and the reconciliation cron. Assert no other billing
    // route can reach the RPC or touch the plan column.
    const apiDir = path.join(
      __dirname, '..', '..', '..', '..', 'app', 'api', 'billing'
    );
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(apiDir);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      // Code only: the checkout route DOCUMENTS that it never calls the
      // RPC, and that sentence must not read as a violation.
      const source = codeOnly(fs.readFileSync(file, 'utf8'));
      expect(source, `${file} must not apply payment events`).not.toMatch(
        /process_payment_event|processPaymentEvent/
      );
      expect(source, `${file} must not write entitlement`).not.toMatch(
        /update\(\s*\{[^}]*plan_id/
      );
    }
  });

  it('there is no route that accepts a provider redirect as proof', () => {
    // A `/api/billing/success` or `/callback` handler is the shape this
    // attack needs. Its absence is the defense.
    const apiDir = path.join(
      __dirname, '..', '..', '..', '..', 'app', 'api', 'billing'
    );
    const names = fs.readdirSync(apiDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const forbidden of ['success', 'callback', 'return', 'complete', 'confirm']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

// ================================================================
// DB-RESIDENT MANIFEST — proven in pgTAP, not here.
//
// Listed as a live test so the split cannot silently rot: if a
// pgTAP assertion for one of these is deleted, this fails.
// ================================================================

describe('DB-resident attacks are covered by the pgTAP suite', () => {
  it('every database-resident attack has a named pgTAP assertion', () => {
    const suite = path.join(
      __dirname, '..', '..', '..', '..', '..', 'supabase', 'tests', 'billing_attacks.sql'
    );
    expect(
      fs.existsSync(suite),
      'supabase/tests/billing_attacks.sql must exist — see Task 12 DB-resident split'
    ).toBe(true);

    const sql = fs.readFileSync(suite, 'utf8');

    // Each of these lives inside Postgres: the event claim, the row
    // lock, RLS, the transition table, transaction rollback, and the
    // RPC's own gates. A Vitest mock cannot prove any of them.
    for (const testName of [
      'duplicate_event_applies_once',                                  // A6
      'concurrent_checkouts_create_one_provider_subscription',         // A7
      'one_live_subscription_per_account',                             // A7
      'stale_event_is_ignored',                                        // A8
      'illegal_transition_rejected',                                   // A9
      'test_mode_event_rejected_in_prod',                              // A11
      'chargeback_is_recorded_without_implicit_entitlement_change',    // A12
      'manual_account_never_auto_downgraded',                          // A14
      'override_survives_downgrade',                                   // A15
      'cross_tenant_ledger_read_blocked',                              // A19
      'partial_apply_rolls_back',                                      // A20
      'retryable_failure_releases_claim',                              // A21
      'subscription_reconstructed_from_intent',                        // A22
      'orphan_is_never_adopted',                                       // A23
      'reconcile_cursor_is_per_environment',                           // A24
      'provider_halted_after_chargeback_revokes_entitlement',          // A26
      'claim_and_apply_share_one_transaction',                         // A27
      'correlation_note_cannot_rebind_a_bound_intent',                 // A28
      'correlation_note_for_unknown_intent_is_rejected',               // A28
      'rpc_rejects_event_environment_mismatch',                        // A30
      'rpc_refuses_missing_configured_environment',                    // A30
      'wrong_environment_event_creates_no_subscription_row',           // A32
      'replayed_body_with_new_event_id_has_no_duplicate_money_effect', // A35
    ]) {
      expect(sql, `pgTAP suite is missing ${testName}`).toContain(testName);
    }
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isMoneyEvent, type PaymentEventKind } from './payment-provider';

/**
 * The port is an anti-corruption boundary (ADR-009/D1). These are
 * MECHANICAL assertions on the source text, in the same style as
 * `omnichannel-migration.test.ts`: a reviewer's good intentions do not
 * survive a year of edits, but a failing test does.
 */
const source = readFileSync(
  join(process.cwd(), 'src/lib/ports/payment-provider.ts'),
  'utf8'
);

/** Import specifiers only — prose in comments must not trip these. */
const importedModules = Array.from(
  source.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g),
  (m) => m[1]
);

describe('PaymentProvider port — dependency rule', () => {
  it('imports nothing at all', () => {
    // A port is types plus one pure helper. The moment it imports
    // anything, the "no vendor SDK" rule becomes a judgement call.
    expect(importedModules).toEqual([]);
  });

  it.each([
    'razorpay',
    'stripe',
    'next/server',
    'next/headers',
    '@supabase/supabase-js',
    '@supabase/ssr',
    'node:crypto',
  ])('does not import %s', (mod) => {
    expect(importedModules).not.toContain(mod);
  });
});

describe('PaymentProvider port — no provider vocabulary leaks', () => {
  /**
   * The rule is about provider words used as DOMAIN VALUES, so these
   * assertions must read CODE ONLY. The file's own header deliberately
   * quotes Razorpay's vocabulary (`'cancelled'` vs `'canceled'`) to
   * explain why the boundary exists — scanning raw source would flag
   * that documentation as the very leak it warns against.
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, ''); // line comments

  /**
   * `authenticated` and `created` are excluded deliberately: they are
   * ordinary English (and `created` is our own intent status), so
   * asserting on them would be noise rather than signal.
   */
  it.each(['halted', 'cancelled', 'completed', 'paused'])(
    'does not carry the provider spelling %s as a value',
    (word) => {
      expect(code).not.toMatch(new RegExp(`['"\`]${word}['"\`]`));
    }
  );

  it('spells the domain status "canceled", not the provider "cancelled"', () => {
    expect(code).toContain("'canceled'");
    expect(code).not.toContain("'cancelled'");
  });

  it('still documents the provider-vocabulary hazard in prose', () => {
    // Guards the stripping above from hiding a genuine regression: the
    // explanation must survive even though it is excluded from the scan.
    expect(source).toContain("compares `'cancelled'` to");
  });
});

describe('PaymentProvider port — tamperable inputs are absent', () => {
  /**
   * F1: an amount must never travel INTO the provider from a caller.
   * `CheckoutIntent.amountMinor` is server-resolved from `plans`, so
   * the assertion is about the shape of what crosses the boundary, not
   * about the string appearing at all.
   */
  it('takes no amount, price, or plan id as a provider-call argument', () => {
    const createCheckout = source.match(/createCheckout\([^)]*\)/)?.[0];
    expect(createCheckout).toBe('createCheckout(intent: CheckoutIntent)');
  });

  it('has no quantity or seat count anywhere (V1 has no per-seat billing)', () => {
    // Attack A33: no seat count exists to tamper with.
    expect(source).not.toMatch(/\bquantity\??:/);
    expect(source).not.toMatch(/\bseats\??:/);
  });

  it('exposes no caller-supplied idempotency key', () => {
    // Derived from `intentId` — a row we wrote — so uniqueness is
    // enforceable in our own database rather than hoped for.
    expect(source).not.toMatch(/idempotencyKey\??:/);
  });
});

describe('PaymentProvider port — fails closed', () => {
  it('makes verifyAndParse throw rather than return a checkable flag', () => {
    // `/api/webhooks/` is public and unauthenticated: the signature
    // check is the entire perimeter (F2). A `{ ok: false }` result is
    // one forgotten `if` away from processing forged events.
    expect(source).toContain('verifyAndParse(raw: RawWebhook): Promise<PaymentEvent>');
    expect(source).not.toMatch(/verifyAndParse[^;]*ok:\s*boolean/);
    expect(source).toContain('class WebhookVerificationError');
  });

  it('has a distinct not-configured error so the surface can fail closed', () => {
    expect(source).toContain('class PaymentsUnavailableError');
  });
});

describe('money / lifecycle event split', () => {
  it('classifies money events', () => {
    expect(isMoneyEvent('charged')).toBe(true);
    expect(isMoneyEvent('refunded')).toBe(true);
    expect(isMoneyEvent('charged_back')).toBe(true);
  });

  it('classifies lifecycle events as not money', () => {
    const lifecycle: PaymentEventKind[] = [
      'activated',
      'payment_failed',
      'cancel_scheduled',
      'canceled',
      'expired',
    ];
    for (const kind of lifecycle) {
      expect(isMoneyEvent(kind)).toBe(false);
    }
  });

  it('treats a chargeback as a money event, not an entitlement verdict', () => {
    // A dispute always writes a negative ledger row; access is revoked
    // only if the provider ALSO emits a lifecycle event. The split is
    // what keeps those two consequences independent.
    expect(isMoneyEvent('charged_back')).toBe(true);
  });
});

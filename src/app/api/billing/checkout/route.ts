// ============================================================
// POST /api/billing/checkout — ADR-009 Task 7 (D5, F1, F4).
//
// Starts (or resumes) a self-serve subscription checkout.
//
// THE ONE RULE THIS ROUTE EXISTS TO ENFORCE (F1): the amount the
// customer is charged is resolved HERE, server-side, from the
// `plans` table. The request body carries an opaque tier id and an
// interval and nothing else. There is no code path — none — by which
// a number in the request body reaches the provider or the intent.
//
// Why the body schema is `.strict()` and rejects rather than strips
// (7.3): a request containing `amount`, `currency`, `quantity`, or
// `discount` is not a client with a stale contract, it is someone
// probing for price tampering. Zod's default behaviour would silently
// drop those keys and return 200, which is safe for the charge but
// destroys the signal. We fail the request and log it instead.
//
// This route writes NO entitlement. It does not touch
// `accounts.plan_id`, and it never calls `process_payment_event()`.
// A started checkout is an intention to pay; only a provider-verified
// webhook (Task 9) may move a tenant onto a paid tier.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  requireRole,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { startCheckout } from '@/features/billing/lib/checkout-intent';
import { resolveProviderPlanRef } from '@/features/billing/lib/plan-refs';
import {
  getPaymentProvider,
  hasPaymentsConfigured,
} from '@/features/billing/lib/provider-factory';
import { logAuditEvent } from '@/lib/audit-events';
import type { BillingInterval } from '@/lib/ports/payment-provider';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Exactly `{ planId, interval }`. `.strict()` is the F1 tripwire — see
 * the module header for why an unexpected key is a 400 and not a
 * silent strip.
 *
 * `planId` is bounded and pattern-checked because it is a tier key
 * from our own `plans` table (`free`, `pro`, ...), not free text. An
 * unbounded string here would let a caller push arbitrary bytes into
 * a parameterised lookup and into log lines.
 */
const bodySchema = z
  .object({
    planId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, 'invalid plan id'),
    interval: z.enum(['monthly', 'yearly']),
  })
  .strict();

/** Keys whose presence indicates a deliberate price-tampering probe. */
const TAMPER_KEYS = new Set([
  'amount',
  'amount_minor',
  'amountMinor',
  'currency',
  'quantity',
  'discount',
  'plan_price',
  'planPrice',
  'price',
  'total',
]);

export async function POST(request: NextRequest) {
  let ctx;
  try {
    // 7.1 — owner-only, re-checked server-side. Route placement is
    // never the authority; this is.
    ctx = await requireRole('owner');
  } catch (err) {
    return toErrorResponse(err);
  }

  const { accountId, userId } = ctx;

  // 7.2 — keyed on the ACCOUNT, not the IP. An attacker rotating IPs
  // must not get more attempts at an account's billing state, and
  // colleagues behind one office NAT must not throttle each other.
  const limit = await checkRateLimit(
    `billing:checkout:${accountId}`,
    RATE_LIMITS.billingCheckout
  );
  // `RateLimitResult.success`, NOT `.ok` — there is no `ok` field, so
  // `!limit.ok` was `!undefined` and every checkout answered 429.
  if (!limit.success) return rateLimitResponse(limit);

  // 7.3 — parse the body defensively. A malformed JSON body is a 400,
  // never an exception that reaches the 500 handler.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    // Distinguish "extra key" from "bad value" so the tamper attempt
    // is loud in the logs and specific on the wire.
    const unexpected =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.keys(raw).filter((k) => k !== 'planId' && k !== 'interval')
        : [];

    if (unexpected.length > 0) {
      const tampering = unexpected.filter((k) => TAMPER_KEYS.has(k));
      // Loud on purpose (F1). A price-shaped key in a checkout body is
      // a security event, not a validation nit.
      console.warn(
        '[billing/checkout] rejected unexpected field(s)',
        JSON.stringify({
          accountId,
          userId,
          unexpected,
          priceTamperingSuspected: tampering.length > 0,
        })
      );
      if (tampering.length > 0) {
        // Fire-and-forget; a failed audit write must not block the
        // rejection we have already decided on.
        void logAuditEvent(supabaseAdmin(), {
          accountId,
          actorId: userId,
          action: 'billing.checkout.rejected',
          entity: `account:${accountId}`,
          meta: { reason: 'price_tampering_attempt', fields: tampering },
        });
      }
      return NextResponse.json(
        {
          error: 'unexpected_field',
          message:
            'Request contained fields that are not accepted. The price is determined by the server from the selected plan.',
          fields: unexpected,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'invalid_request', message: 'Invalid planId or interval.' },
      { status: 400 }
    );
  }

  const { planId, interval } = parsed.data;

  // 7.5 — provider not configured ⇒ 503 BEFORE any row is written. The
  // factory would hand back the Noop adapter, which would fail the
  // journey later and leave a dead intent behind for no reason.
  if (!hasPaymentsConfigured()) {
    return NextResponse.json(
      {
        error: 'payments_unavailable',
        message: 'Payments are not available right now. Please try again later.',
      },
      { status: 503 }
    );
  }

  const db = supabaseAdmin();

  // 7.4 — load the plan SERVER-SIDE. This row, not the request, is the
  // source of truth for what the customer will be charged.
  const { data: plan, error: planErr } = await db
    .from('plans')
    .select('id, name, is_active, price_monthly, price_yearly, currency, provider_refs')
    .eq('id', planId)
    .maybeSingle();

  if (planErr) {
    console.error('[billing/checkout] plan lookup failed:', planErr);
    return NextResponse.json(
      { error: 'internal_error', message: 'Could not start checkout.' },
      { status: 500 }
    );
  }
  // Unknown and inactive collapse to the same response: an enumeration
  // oracle over our plan catalogue buys an attacker nothing, but it is
  // free to withhold.
  if (!plan || plan.is_active !== true) {
    return NextResponse.json(
      { error: 'plan_unavailable', message: 'That plan is not available.' },
      { status: 400 }
    );
  }

  // Captured after the guard because TypeScript discards the null
  // narrowing inside the `resolveForProvider` closure below — it cannot
  // prove when the closure runs. Re-reading `plan` there would compile
  // only with a `!`, which is the assertion this const replaces.
  const activePlan = plan;

  // NULL price = "contact us" tier. Not self-serve purchasable, and a
  // NULL must never be coerced to 0 — that would be a free upgrade.
  const amountMinor =
    interval === 'monthly' ? plan.price_monthly : plan.price_yearly;
  if (typeof amountMinor !== 'number' || !Number.isInteger(amountMinor)) {
    return NextResponse.json(
      {
        error: 'plan_not_self_serve',
        message: 'This plan cannot be purchased online. Please contact sales.',
      },
      { status: 400 }
    );
  }
  // A zero-amount checkout is not a checkout. The free tier is granted,
  // never bought, and sending 0 to the provider is an error at best.
  if (amountMinor <= 0) {
    return NextResponse.json(
      {
        error: 'plan_not_purchasable',
        message: 'This plan does not require payment.',
      },
      { status: 400 }
    );
  }

  const currency =
    typeof plan.currency === 'string' && /^[A-Z]{3}$/.test(plan.currency)
      ? plan.currency
      : null;
  if (!currency) {
    // Misconfigured catalogue row. Refuse rather than default to INR:
    // guessing a currency is guessing a price.
    console.error(
      '[billing/checkout] plan has invalid currency',
      JSON.stringify({ planId, currency: plan.currency })
    );
    return NextResponse.json(
      { error: 'plan_misconfigured', message: 'That plan is not available.' },
      { status: 400 }
    );
  }

  // The adapter asks us to map our tier id → the provider's plan id.
  // Resolution reads the plan row we already loaded and NEVER accepts a
  // provider plan id from the request.
  //
  // Declared as a `function` (not a const arrow) so it can reference
  // `provider` below: the factory needs the resolver at construction
  // time and the resolver needs the constructed provider's id and
  // environment, and only a hoisted declaration closes that cycle
  // without a mutable placeholder. It is invoked strictly after
  // `provider` is initialised, so the reference is always live.
  async function resolveForProvider(
    tierId: string,
    forInterval: BillingInterval
  ): Promise<string> {
    // Defensive: the adapter is only ever asked about the tier we
    // validated. If that ever stops being true, fail rather than
    // resolve a plan we did not price.
    if (tierId !== planId || forInterval !== interval) {
      throw new Error('plan ref requested for an unvalidated plan');
    }
    const ref = resolveProviderPlanRef(
      plan.provider_refs,
      provider.id,
      provider.environment,
      forInterval
    );
    if (!ref) {
      throw new PlanRefMissingError(tierId, forInterval);
    }
    return ref;
  }

  const provider = getPaymentProvider({
    resolveProviderPlanRef: resolveForProvider,
  });

  // 7.4 (continued) — verify the mapping exists BEFORE writing an
  // intent, so a catalogue gap is a clean 400 instead of a dead row.
  if (
    !resolveProviderPlanRef(
      plan.provider_refs,
      provider.id,
      provider.environment,
      interval
    )
  ) {
    console.error(
      '[billing/checkout] plan is missing a provider mapping',
      JSON.stringify({
        planId,
        interval,
        provider: provider.id,
        environment: provider.environment,
      })
    );
    return NextResponse.json(
      {
        error: 'plan_unavailable',
        message: 'That plan is not available for purchase right now.',
      },
      { status: 400 }
    );
  }

  // 7.6 — intent-first. `startCheckout` owns the ordering, the A7
  // unique-index arbitration, and the failure marking; this route does
  // not reimplement any of it.
  try {
    const outcome = await startCheckout(db, provider, {
      accountId,
      userId,
      planId,
      interval,
      // Server-resolved. This is the only amount in the request path.
      amountMinor,
      currency,
    });

    if (outcome.kind === 'in_progress') {
      // Lost the race to an intent that has not reached the provider
      // yet. There is no handle to hand back and creating one would be
      // the double-charge the index exists to prevent.
      return NextResponse.json(
        {
          error: 'checkout_in_progress',
          message:
            'A checkout is already in progress for this workspace. Please wait a moment and try again.',
        },
        { status: 409 }
      );
    }

    void logAuditEvent(db, {
      accountId,
      actorId: userId,
      action:
        outcome.kind === 'resumed'
          ? 'billing.checkout.resumed'
          : 'billing.checkout.started',
      entity: `checkout_intent:${outcome.intentId}`,
      // PII-light and price-free beyond the tier we resolved.
      meta: {
        planId,
        interval,
        provider: provider.id,
        environment: provider.environment,
      },
    });

    // 7.7 — the provider handle plus the SERVER-RESOLVED amount. No
    // value here originates from the request body.
    return NextResponse.json(
      {
        intentId: outcome.intentId,
        resumed: outcome.kind === 'resumed',
        authorizeUrl: outcome.handle.authorizeUrl,
        planId,
        interval,
        amountMinor,
        currency,
      },
      { status: outcome.kind === 'resumed' ? 200 : 201 }
    );
  } catch (err) {
    if (err instanceof PlanRefMissingError) {
      // Raced with a catalogue edit between our pre-check and the
      // adapter's resolution. The intent is already marked `failed`.
      return NextResponse.json(
        {
          error: 'plan_unavailable',
          message: 'That plan is not available for purchase right now.',
        },
        { status: 400 }
      );
    }
    // Provider outage or adapter error. `startCheckout` has already
    // marked the intent `failed`, so the account is not wedged.
    console.error('[billing/checkout] provider call failed:', err);
    return NextResponse.json(
      {
        error: 'provider_error',
        message: 'We could not reach the payment provider. Please try again.',
      },
      { status: 502 }
    );
  }
}

/** Thrown by the resolver so the catch block can answer 400, not 502. */
class PlanRefMissingError extends Error {
  constructor(planId: string, interval: string) {
    super(`No provider plan ref for ${planId}/${interval}`);
    this.name = 'PlanRefMissingError';
  }
}

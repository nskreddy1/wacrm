// ============================================================
// POST /api/webhooks/payments/[provider] — ADR-009 Task 9 (D9, D11).
//
// THE ONLY ENDPOINT THAT CAN CHANGE ENTITLEMENT. Treat every byte as
// hostile.
//
// `/api/webhooks/` is an UNAUTHENTICATED PUBLIC PREFIX
// (`src/middleware.ts`). There is no session, no CSRF token, and no
// other gate on this path: the signature check inside
// `provider.verifyAndParse()` is the ENTIRE perimeter (F2). A refactor
// that moves, skips, or "optimises" that call makes this file publicly
// callable by anyone on the internet.
//
// THE SHAPE OF THIS HANDLER IS A SECURITY PROPERTY, NOT A STYLE:
//
//     read raw body → verify → normalize → ONE rpc → respond
//
// - The body is read as TEXT first. A parsed-then-re-serialised object
//   has different bytes and can never match the provider's HMAC.
// - The route performs NO claim of its own. The claim and the apply are
//   one database transaction inside `process_payment_event()`, reached
//   through exactly one `processPaymentEvent()` call (9.3, 9.3a).
// - Nothing here resolves a tenant. Tenant resolution lives inside the
//   RPC, off rows WE wrote (9.4, F3).
//
// FAIL CLOSED — THE DELIBERATE INVERSE OF MESSAGE INGRESS.
// `IngressDedupeStore.claim()` fails OPEN so a Redis blip cannot drop a
// customer's WhatsApp message. This route fails CLOSED: any error is a
// 5xx so the provider spends its 24-hour retry budget. Dropping a
// message costs a conversation; dropping a payment costs a paying
// customer their access. Do not "harmonise" the two policies.
//
// RESPONSE BUDGET (9.8). Razorpay resends an event when the endpoint
// does not answer within ~5 seconds, so a slow handler manufactures its
// own duplicate storm. Hence, inside this handler:
//     No provider API call. No reconciliation. No unbounded query.
//     One RPC.
// Repairs that need a provider round-trip belong to the Task 10 cron.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';

import {
  processPaymentEvent,
  type PaymentEventResult,
} from '@/features/billing/lib/process-payment-event';
import {
  getPaymentProvider,
  parsePaymentEnvironment,
} from '@/features/billing/lib/provider-factory';
import {
  PaymentsUnavailableError,
  WebhookVerificationError,
} from '@/lib/ports/payment-provider';
import { paymentsEnvironment, paymentsProvider } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Body cap (9.1). Razorpay subscription events are a few KB; 128 KB is
 * generous. The cap exists so a flood of large bodies cannot burn CPU
 * on HMAC work before we have any reason to trust the sender (A18) —
 * and it is enforced on the ACTUAL bytes read, not on a
 * `content-length` header an attacker controls.
 */
const MAX_BODY_BYTES = 128 * 1024;

/**
 * Providers this route will even consider. An unknown `[provider]`
 * segment is a 404 before any secret is read, so this endpoint cannot
 * be used to probe which providers we have configured.
 */
const KNOWN_PROVIDERS = new Set(['razorpay']);

/**
 * Never resolved here. The webhook path resolves NO plan refs — that is
 * a checkout-time concern — so the factory is handed a resolver that
 * throws. If a future edit makes the webhook reach for a plan ref, this
 * fails loudly in tests instead of silently querying the catalogue
 * inside the 5-second budget.
 */
function unreachablePlanRefResolver(): Promise<string> {
  return Promise.reject(
    new Error(
      'resolveProviderPlanRef must never be called on the webhook path'
    )
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  // Next 16: route params are async and MUST be awaited.
  const { provider: providerSegment } = await context.params;

  // ── 9.6 — unknown or unconfigured provider ⇒ 404. ──
  //
  // 404 and not 503: an unconfigured webhook endpoint should not
  // confirm that it exists. But 404 externally must NOT mean invisible
  // internally — real provider traffic arriving at an endpoint we
  // cannot verify means someone has wired live Razorpay at a
  // deployment where payments are dormant, and we are silently
  // discarding paying customers' events. That is an alert, not a
  // shrug.
  if (!KNOWN_PROVIDERS.has(providerSegment)) {
    return notFound();
  }

  const configuredProvider = paymentsProvider();
  const configuredEnvironment = parsePaymentEnvironment(paymentsEnvironment());

  if (!configuredProvider || configuredProvider !== providerSegment) {
    console.error(
      '[billing/webhook] provider traffic reached an unconfigured endpoint',
      JSON.stringify({
        alert: 'BILLING_WEBHOOK_PROVIDER_NOT_CONFIGURED',
        requestedProvider: providerSegment,
        configuredProvider: configuredProvider ?? null,
      })
    );
    return notFound();
  }

  // The trusted environment is what makes the RPC's gate real (4.1c).
  // A deployment that cannot state its own mode must not process money
  // events at all — guessing `test` makes live webhooks unverifiable,
  // and guessing `live` lets a sandbox event grant real entitlement
  // (A25). Both guesses are fail-open, so there is no default.
  if (!configuredEnvironment) {
    console.error(
      '[billing/webhook] PAYMENTS_ENVIRONMENT is absent or invalid',
      JSON.stringify({
        alert: 'BILLING_WEBHOOK_ENVIRONMENT_UNCONFIGURED',
        provider: providerSegment,
      })
    );
    return notFound();
  }

  // ── 9.1 — read the RAW body first, and cap it. ──
  //
  // `request.text()` before any parse: these exact bytes are the HMAC
  // base string.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    // Truncated/aborted upload. Nothing to verify, nothing recorded.
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    console.warn(
      '[billing/webhook] rejected oversized body',
      JSON.stringify({ provider: providerSegment, bytes: rawBody.length })
    );
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  if (rawBody.length === 0) {
    return NextResponse.json({ error: 'empty_body' }, { status: 400 });
  }

  const provider = getPaymentProvider({
    resolveProviderPlanRef: unreachablePlanRefResolver,
  });

  // ── 9.2 — verify, then parse. THROWS on failure. ──
  //
  // Headers are collected as a plain object for the port, which must
  // stay free of Next.js types.
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let event;
  try {
    event = await provider.verifyAndParse({ rawBody, headers });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      // 401, and RECORD NOTHING. An unverified body is not evidence of
      // a billing event — writing a row for it would let anyone on the
      // internet fill our forensic ledger, and would burn the
      // `event_id` claim for an event the provider may yet deliver
      // genuinely.
      //
      // The message is deliberately not echoed to the caller: which
      // check failed, and by how much, is not the sender's business.
      console.warn(
        '[billing/webhook] signature verification failed',
        JSON.stringify({
          alert: 'BILLING_WEBHOOK_SIGNATURE_REJECTED',
          provider: providerSegment,
          environment: configuredEnvironment,
          reason: err.message,
        })
      );
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    if (err instanceof PaymentsUnavailableError) {
      // The Noop adapter. Config changed between the check above and
      // here, or credentials are partial (A2). Never process.
      return notFound();
    }

    // An unmapped event type also arrives as a verification error from
    // the adapter (5.3c). Anything else reaching here is a genuine
    // fault: fail closed.
    console.error('[billing/webhook] normalization failed', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  // ── 9.3 / 9.5 — ONE write call. The claim happens INSIDE it. ──
  //
  // DO NOT add `from('payment_events').insert(...)` here, ever. Two
  // supabase-js calls are two transactions: the claim would commit
  // while the apply failed, the provider would stop retrying, and every
  // redelivery would read as `already_processed` — the event becomes
  // permanently unapplicable (A21, A27). The single RPC is the only
  // thing that makes claim-and-apply atomic.
  let result: PaymentEventResult;
  try {
    result = await processPaymentEvent(supabaseAdmin(), {
      provider: provider.id,
      // TRUSTED: this deployment's own mode, from env — not from the
      // event. Postgres cannot read PAYMENTS_ENVIRONMENT, so the gate
      // only works because this value arrives from outside the payload
      // (4.1c, A30).
      configuredEnvironment,
      // OBSERVED: stamped by the adapter from the credential set whose
      // secret verified the signature.
      event,
    });
  } catch (err) {
    // 5xx and NOTHING PERSISTED (the transaction rolled back, claim
    // included). This includes the deliberate raises for an unresolved
    // tenant (9.4a): the mapping may exist moments later — a
    // concurrent checkout still committing, a replica catching up — and
    // a 200 here would permanently forfeit the redelivery that is the
    // only mechanism able to recover a real paying customer.
    //
    // We never guess a tenant to make a 200 possible (F3).
    console.error(
      '[billing/webhook] processing failed — provider must retry',
      JSON.stringify({
        alert: 'BILLING_WEBHOOK_PROCESSING_FAILED',
        provider: provider.id,
        environment: configuredEnvironment,
        eventId: event.eventId,
        providerEventType: event.providerEventType,
        // The message only. Never the payload (F7).
        reason: err instanceof Error ? err.message : 'unknown',
      })
    );
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
  }

  // ── 9.7 — structured log. Never the payload, the secret, or any
  // payment-instrument data (F7). ──
  console.info(
    '[billing/webhook] processed',
    JSON.stringify({
      provider: provider.id,
      environment: configuredEnvironment,
      eventId: event.eventId,
      providerEventType: event.providerEventType,
      kind: event.kind,
      outcome: result.outcome,
      reason: result.reason ?? null,
    })
  );

  // `subscription.completed` is an OPERATIONAL ALERT, not a routine
  // terminal state (5.3b-t). With a 10-year horizon its likeliest cause
  // is that we under-set `total_count` on a live payer, so it must not
  // revoke access quietly.
  if (event.providerEventType === 'subscription.completed') {
    console.warn(
      '[billing/webhook] subscription reached full term',
      JSON.stringify({
        alert: 'BILLING_SUBSCRIPTION_COMPLETED',
        provider: provider.id,
        environment: configuredEnvironment,
        eventId: event.eventId,
      })
    );
  }

  // ── 9.3b — the response taxonomy, as ONE switch. ──
  //
  // The distinction between "we decided not to act" and "we failed to
  // act" is the whole operational contract, so it is decided in exactly
  // one place rather than by scattered returns.
  //
  // Every outcome below is a COMMITTED transaction, so every one is a
  // 200: the provider must stop retrying something we have durably
  // resolved. A retryable failure never reaches this switch — it left
  // through the catch above with nothing persisted.
  switch (result.outcome) {
    case 'applied':
    case 'already_processed':
    case 'already_applied':
    case 'ignored':
    case 'failed_terminal':
      // `failed_terminal` + 200 is deliberate: a signed event we can
      // never interpret must not be retried for 24 hours. It is NOT a
      // bucket for "we could not do it right now" — that is the 5xx.
      return NextResponse.json(
        { status: result.outcome, reason: result.reason ?? null },
        { status: 200 }
      );
    default: {
      // Unreachable: the wrapper already rejected unrecognised
      // outcomes. Kept as a fail-closed backstop so that if the RPC and
      // the wrapper ever drift, the safe reading is "we do not know
      // whether it applied" — which means retry, not success.
      const unexpected: never = result.outcome;
      console.error(
        '[billing/webhook] unrecognised RPC outcome',
        JSON.stringify({ outcome: unexpected })
      );
      return NextResponse.json({ error: 'processing_failed' }, { status: 500 });
    }
  }
}

/**
 * Uniform 404 for every "this endpoint is not here" case, so the
 * response cannot be used to distinguish an unknown provider from a
 * configured-but-dormant one.
 */
function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

/**
 * GET exists only to avoid a framework 405 that looks like a
 * misconfiguration in provider dashboards. It confirms nothing and
 * verifies nothing.
 */
export async function GET(): Promise<NextResponse> {
  return notFound();
}

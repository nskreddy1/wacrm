// ============================================================
// plans.provider_refs → the provider's own plan id.
//
// This is the ONLY direction this mapping is ever read. We resolve
// "our tier + our interval + the configured environment" into a
// provider plan id. We never read a provider plan id out of an event
// payload and trust it to name a tier (F3): that would let anyone who
// can forge a payload pick the tier they get.
//
// Two shapes are accepted, because the column's documented example is
// ambiguous about whether interval is a dimension:
//
//   { "razorpay": { "live": "plan_ABC", "test": "plan_XYZ" } }
//   { "razorpay": { "live": { "monthly": "plan_M", "yearly": "plan_Y" } } }
//
// Razorpay plan ids encode the billing period, so the nested form is
// the correct one for a catalogue with both intervals; the flat form is
// accepted for a single-interval tier. Anything else — a number, an
// array, an empty string — resolves to `undefined`.
//
// EVERY failure path here is a hard failure at the call site, never a
// fallback to "some other plan id". Charging a customer against a plan
// we guessed is worse than not starting the checkout at all.
// ============================================================

import type { BillingInterval } from '@/lib/ports/payment-provider';

/**
 * Resolve the provider's plan id for one tier / interval / environment.
 *
 * @returns The provider plan id, or `undefined` when the mapping is
 *   absent or malformed. Deliberately not throwing: the caller turns
 *   this into a domain-specific 4xx with a message about *its* request,
 *   which it can do better than this function can.
 */
export function resolveProviderPlanRef(
  providerRefs: unknown,
  provider: string,
  environment: 'test' | 'live',
  interval: BillingInterval
): string | undefined {
  if (!isRecord(providerRefs)) return undefined;

  const byProvider = providerRefs[provider];
  if (!isRecord(byProvider)) return undefined;

  const byEnvironment = byProvider[environment];

  // Flat form: one id serves the tier regardless of interval.
  if (typeof byEnvironment === 'string') {
    return nonEmpty(byEnvironment);
  }

  // Nested form: an id per interval.
  if (isRecord(byEnvironment)) {
    const byInterval = byEnvironment[interval];
    if (typeof byInterval === 'string') return nonEmpty(byInterval);
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

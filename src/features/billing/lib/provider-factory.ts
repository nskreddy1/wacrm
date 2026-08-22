import { paymentsEnvironment, paymentsProvider, razorpayCredentials } from '@/lib/env';
import type {
  BillingInterval,
  PaymentEnvironment,
  PaymentProvider,
} from '@/lib/ports/payment-provider';

import { NoopPaymentProvider } from './noop';
import { RazorpayPaymentProvider } from './razorpay/adapter';
import { RazorpayClient } from './razorpay/client';

/**
 * Payment provider factory (ADR-009/D3, F8).
 *
 * ONE RULE, APPLIED WITHOUT EXCEPTION
 * A real provider is returned only when EVERY input is present and
 * valid. Any gap — unknown provider id, unrecognised environment, a
 * missing credential — yields the `NoopPaymentProvider`, which throws
 * on every method.
 *
 * The partial-configuration case is the one this exists for. A
 * deployment holding a Razorpay key but no webhook secret can create
 * real subscriptions and take real money, while being structurally
 * incapable of verifying the webhook that would grant the customer
 * access (attack A2). "Mostly configured" is therefore treated as NOT
 * configured — the credential bundle in `env.ts` makes the three
 * secrets resolve together so this cannot be half-satisfied.
 *
 * Nothing here is cached at module scope. The Workers runtime populates
 * `process.env` per isolate and tests mutate it between cases, so a
 * cached provider would freeze the first read and quietly serve a stale
 * environment — the one value we most need to be current.
 */

/** Resolves our plan tier to the provider's plan id. Injected, not queried. */
export type ProviderPlanRefResolver = (
  planId: string,
  interval: BillingInterval
) => Promise<string>;

/**
 * Parse the configured environment. TOTAL and STRICT.
 *
 * Returns `undefined` for anything that is not exactly `test` or
 * `live`, including a plausible-looking `production` or `sandbox`. The
 * caller degrades to the Noop rather than guessing, because both
 * possible guesses are fail-open: `test` makes live webhooks
 * unverifiable, and `live` lets a sandbox event grant real entitlement.
 */
export function parsePaymentEnvironment(
  raw: string | undefined
): PaymentEnvironment | undefined {
  if (raw === 'test' || raw === 'live') return raw;
  return undefined;
}

export interface PaymentProviderDeps {
  /**
   * How to resolve `plans.provider_refs`. Required for checkout; the
   * webhook path never calls it, so a caller that only verifies events
   * may pass a resolver that throws.
   */
  readonly resolveProviderPlanRef: ProviderPlanRefResolver;
  /** Rotation observability sink (5.1a step 3). */
  readonly onPreviousSecretUsed?: (details: { eventId: string }) => void;
}

/**
 * The single place a payment provider is constructed.
 *
 * @returns A configured adapter, or `NoopPaymentProvider` when payments
 *   are not fully configured. NEVER `null` — a nullable return would
 *   put an easily-forgotten guard in front of every money path.
 */
export function getPaymentProvider(deps: PaymentProviderDeps): PaymentProvider {
  const provider = paymentsProvider();
  if (!provider) return new NoopPaymentProvider();

  // Unknown provider id ⇒ Noop. A typo must not silently select some
  // default provider.
  if (provider !== 'razorpay') return new NoopPaymentProvider();

  const environment = parsePaymentEnvironment(paymentsEnvironment());
  if (!environment) return new NoopPaymentProvider();

  // All three credentials for THAT environment, or nothing. The bundle
  // cannot be partially satisfied by construction.
  const credentials = razorpayCredentials(environment);
  if (!credentials) return new NoopPaymentProvider();

  const client = new RazorpayClient({
    keyId: credentials.keyId,
    keySecret: credentials.keySecret,
  });

  return new RazorpayPaymentProvider(client, {
    environment,
    webhookSecrets: {
      current: credentials.webhookSecret,
      previous: credentials.webhookSecretPrevious,
    },
    merchantAccountRef: credentials.merchantAccountRef,
    resolveProviderPlanRef: deps.resolveProviderPlanRef,
    onPreviousSecretUsed: deps.onPreviousSecretUsed,
  });
}

/**
 * Whether a real provider is configured, WITHOUT constructing one.
 *
 * Lets a read-only surface (the settings page deciding whether to show
 * an upgrade button) degrade gracefully instead of catching
 * `PaymentsUnavailableError` and using an exception as control flow.
 */
export function hasPaymentsConfigured(): boolean {
  const provider = paymentsProvider();
  if (provider !== 'razorpay') return false;
  const environment = parsePaymentEnvironment(paymentsEnvironment());
  if (!environment) return false;
  return razorpayCredentials(environment) !== undefined;
}

import {
  type CheckoutHandle,
  type PaymentEnvironment,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentProviderCapabilities,
  type ProviderSubscription,
  PaymentsUnavailableError,
} from '@/lib/ports/payment-provider';

/**
 * The Null Object for payments (ADR-009/D3, F8).
 *
 * WHY A NULL OBJECT RATHER THAN `null`
 * If `getPaymentProvider()` could return `null`, every call site would
 * need a guard, and the day someone forgets one the failure is a
 * `TypeError` at runtime — in a route that handles money. Returning an
 * object that satisfies the interface and THROWS on every method makes
 * "payments not configured" a single, uniform, loud outcome instead of
 * N optional checks.
 *
 * WHY EVERY METHOD THROWS, INCLUDING THE READ-ONLY ONES
 * `fetchSubscription` returning an empty result would let the
 * reconciliation cron conclude "the provider says this subscription
 * does not exist" and revoke access for every paying customer, purely
 * because an env var went missing. A misconfigured deployment must be
 * unable to make an entitlement decision at all — that is the whole
 * point of failing closed rather than failing quiet.
 *
 * `verifyAndParse` throwing is the load-bearing one: with no webhook
 * secret we cannot distinguish a genuine event from a forged one, so
 * the only safe answer is to accept neither.
 */
export class NoopPaymentProvider implements PaymentProvider {
  readonly id = 'noop';

  /**
   * Reported as `test` so that anything which persists an environment
   * alongside a record can never mint a row claiming to be `live`.
   * The Noop cannot actually reach a provider, so this value is only
   * ever a label on something inert — and the safer of the two labels.
   */
  readonly environment: PaymentEnvironment = 'test';

  readonly capabilities: PaymentProviderCapabilities = {
    createSubscriptionIdempotency: 'unsupported',
  };

  async createCheckout(): Promise<CheckoutHandle> {
    throw new PaymentsUnavailableError(
      'Payments are not configured: set PAYMENTS_PROVIDER, PAYMENTS_ENVIRONMENT ' +
        'and the credential set for that environment'
    );
  }

  async verifyAndParse(): Promise<PaymentEvent> {
    // Never "accept because unconfigured". This is the entire webhook
    // perimeter, and a public unauthenticated one at that.
    throw new PaymentsUnavailableError(
      'Cannot verify a payment webhook: no payments provider is configured'
    );
  }

  async fetchSubscription(): Promise<ProviderSubscription> {
    throw new PaymentsUnavailableError(
      'Cannot read provider subscription state: no payments provider is configured'
    );
  }

  async cancelAtPeriodEnd(): Promise<void> {
    throw new PaymentsUnavailableError(
      'Cannot cancel a subscription: no payments provider is configured'
    );
  }
}

/**
 * PaymentProvider port — the payments anti-corruption boundary (ADR-009/D1).
 *
 * Dependency Rule: this file is a port. It MUST NOT import Next.js,
 * `@supabase/*`, `razorpay`, `stripe`, or any vendor SDK. Adapters are
 * injected by the caller and are the ONLY place a provider's vocabulary
 * is allowed to exist. `payment-provider.test.ts` asserts this
 * mechanically, in the same style as `message-ingress.ts`.
 *
 * WHY THE BOUNDARY IS STRICT HERE SPECIFICALLY
 * Provider lifecycle states are not domain states. Razorpay has
 * `created / authenticated / active / pending / halted / cancelled /
 * completed / expired / paused`; we have five. If a provider word
 * reaches domain code, someone eventually compares `'cancelled'` to
 * `'canceled'` and an entitlement decision silently falls through.
 *
 * WHAT THIS PORT DELIBERATELY DOES NOT EXPRESS
 * - No amount ever arrives FROM a caller. Prices are resolved
 *   server-side from our `plans` table; `CheckoutIntent` carries the
 *   already-resolved amount purely so the adapter can report it.
 * - No `quantity`. V1 has no per-seat billing (ADR-008/D1), so there is
 *   no seat count to tamper with (attack A33). The adapter pins the
 *   provider's `quantity` to 1 itself.
 * - No free-form `idempotencyKey`. It is derived from `intentId`, which
 *   is a row WE wrote, so uniqueness is enforceable in our own database.
 */

/** Deployment credential mode. First-class and configured, never inferred. */
export type PaymentEnvironment = 'test' | 'live';

/** Billing cadence. The price for each lives in our `plans` table. */
export type BillingInterval = 'monthly' | 'yearly';

/**
 * A payment journey that ALREADY EXISTS LOCALLY.
 *
 * The adapter receives this only after `checkout_intents` has been
 * written, so `intentId` is a durable local identity rather than a
 * hope. Every field is server-resolved.
 */
export interface CheckoutIntent {
  /** Our `checkout_intents.id`. The provider idempotency-key input and
   *  the correlation locator echoed through provider metadata. */
  readonly intentId: string;
  readonly accountId: string;
  /** Our tier id (`plans.id`), not the provider's plan id. */
  readonly planId: string;
  readonly interval: BillingInterval;
  /** Minor units, resolved from `plans` — never from a request body. */
  readonly amountMinor: number;
  readonly currency: string;
}

/**
 * What the provider handed back for a created journey.
 *
 * `authorizeUrl` is READ BACK from the provider's response, never
 * constructed from a template — and it grants nothing on its own
 * (attack A3: entitlement comes only from a verified webhook or the
 * reconciliation cron, never from the customer arriving back).
 */
export interface CheckoutHandle {
  readonly providerRef: string;
  readonly authorizeUrl: string;
  readonly customerRef?: string;
}

/** Provider-read subscription state, used by reconciliation (D14). */
export interface ProviderSubscription {
  readonly providerRef: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd?: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly environment: PaymentEnvironment;
  /**
   * The provider's own authoritative state version where exposed.
   * Reconciliation keys its synthetic event id on this, so each
   * MATERIALLY DIFFERENT observed state is its own idempotent event
   * while a re-observation of an unchanged state collapses to one row.
   */
  readonly stateVersion?: string;
  readonly correlationIntentId?: string;
}

/** Raw, unparsed delivery. `rawBody` is the exact bytes as received. */
export interface RawWebhook {
  /** The RAW body string. A re-serialised object has different bytes
   *  and will never match the provider's HMAC. */
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Our five statuses. Provider vocabulary is translated into this set by
 * a total mapping table inside the adapter that THROWS on anything
 * unmapped — a `default:` branch there silently invents entitlement.
 */
export type SubscriptionStatus =
  | 'incomplete'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired';

/**
 * Event vocabulary, SPLIT IN TWO so nobody has to remember which is
 * which. A ledger row and an entitlement change are separate
 * consequences of an event.
 *
 * MONEY events write the ledger and never move status by themselves.
 * A goodwill refund must not silently delete a customer's access.
 */
export type MoneyEventKind = 'charged' | 'refunded' | 'charged_back';

/**
 * LIFECYCLE events are the ONLY ones that move status, and therefore
 * the only ones that change entitlement.
 *
 * A dispute therefore does two independent things: it always writes a
 * negative ledger row, and it revokes access ONLY IF the provider also
 * emits a lifecycle event (e.g. the subscription is halted). "A
 * chargeback never affects access" is NOT a rule we encode.
 */
export type LifecycleEventKind =
  | 'activated'
  | 'payment_failed'
  | 'cancel_scheduled'
  | 'canceled'
  | 'expired';

export type PaymentEventKind = MoneyEventKind | LifecycleEventKind;

const MONEY_EVENT_KINDS: readonly MoneyEventKind[] = [
  'charged',
  'refunded',
  'charged_back',
];

/** Narrowing helper so callers branch on the split rather than re-listing it. */
export function isMoneyEvent(kind: PaymentEventKind): kind is MoneyEventKind {
  return (MONEY_EVENT_KINDS as readonly string[]).includes(kind);
}

/** A normalised, signature-verified provider event. */
export interface PaymentEvent {
  /** OUR vocabulary. Never the provider's event name. */
  readonly kind: PaymentEventKind;

  /**
   * The provider's event identity — the idempotency claim key.
   *
   * NOT authenticated data for Razorpay: their HMAC covers the raw
   * body, and the event id travels in a header outside the signature
   * base string. So this dedupes DELIVERIES; duplicate money EFFECTS
   * are fenced separately by `providerRef` uniqueness in the ledger,
   * whose value comes from inside the signed body (attack A35).
   */
  readonly eventId: string;

  /** The provider money/resource id, from INSIDE the signed body. */
  readonly providerRef: string;
  readonly customerRef?: string;
  readonly subscriptionRef?: string;
  readonly invoiceRef?: string;

  /** Ordering HINT only. Prefer `resourceStatus`/`resourceVersion`. */
  readonly occurredAt?: string;

  /** The provider's own authoritative state, where it exposes one. */
  readonly resourceStatus?: SubscriptionStatus;
  readonly resourceVersion?: string;

  /** Always together, never an amount without its currency (D7). */
  readonly amountMinor?: number;
  readonly currency?: string;

  /**
   * The environment OBSERVED on this event — i.e. stamped from the
   * credential set whose secret verified the signature. The RPC
   * compares it against the CONFIGURED environment, which the trusted
   * caller passes separately; a gate that reads the environment off the
   * event and compares it to the event checks nothing (attack A30).
   */
  readonly environment: PaymentEnvironment;

  /**
   * A correlation LOCATOR from provider metadata — UUID-validated, and
   * able only to point at one of OUR OWN `checkout_intents` rows.
   *
   * The distinction is exact and load-bearing:
   *   ALLOWED:   note → an existing local intent → that row's account_id
   *   FORBIDDEN: note → an account, plan, price, or interval
   *
   * Naming a tenant from external data stays forbidden outright (F3,
   * attacks A4/A29). This exists solely to close the crash window where
   * the provider object exists but `provider_ref` was never persisted,
   * so both provider_ref lookups miss by construction.
   */
  readonly correlationIntentId?: string;

  /** The raw provider type, for forensics. */
  readonly providerEventType: string;

  /** Digest of the raw body — NEVER the payload itself (F7). */
  readonly payloadDigest?: string;
}

/**
 * Facts about a VENDOR'S API, not about payments.
 *
 * Kept off the business-facing methods so the port keeps talking about
 * payments instead of about HTTP headers. "Does this vendor accept an
 * idempotency mechanism on subscription creation?" is a fact about that
 * vendor; expressing it here means the ABSENCE of such a header is a
 * stated fact rather than an oversight in the adapter.
 */
export interface PaymentProviderCapabilities {
  readonly createSubscriptionIdempotency: 'supported' | 'unsupported';
}

/** Thrown when payments are not configured. The surface fails CLOSED. */
export class PaymentsUnavailableError extends Error {
  constructor(message = 'Payments are not configured') {
    super(message);
    this.name = 'PaymentsUnavailableError';
  }
}

/** Thrown when a delivery's signature does not verify. */
export class WebhookVerificationError extends Error {
  constructor(message = 'Webhook signature verification failed') {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface PaymentProvider {
  readonly id: string;
  readonly environment: PaymentEnvironment;
  readonly capabilities: PaymentProviderCapabilities;

  /** Create the provider-side journey for an intent WE already wrote. */
  createCheckout(intent: CheckoutIntent): Promise<CheckoutHandle>;

  /**
   * Verify then parse. THROWS on a bad or absent signature — never
   * returns `{ ok: false }` that a caller can forget to check, because
   * `/api/webhooks/` is an unauthenticated public prefix and this
   * signature check is the ENTIRE perimeter (F2).
   */
  verifyAndParse(raw: RawWebhook): Promise<PaymentEvent>;

  /** Read authoritative state back, for reconciliation. */
  fetchSubscription(providerRef: string): Promise<ProviderSubscription>;

  /** Ask the provider to cancel at period end. Records intent only —
   *  entitlement moves later, when the provider confirms. */
  cancelAtPeriodEnd(providerRef: string): Promise<void>;
}

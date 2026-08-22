import {
  type BillingInterval,
  type CheckoutHandle,
  type CheckoutIntent,
  type PaymentEnvironment,
  type PaymentEvent,
  type PaymentEventKind,
  type PaymentProvider,
  type PaymentProviderCapabilities,
  type ProviderSubscription,
  type RawWebhook,
  type SubscriptionStatus,
  WebhookVerificationError,
} from '@/lib/ports/payment-provider';

import { RazorpayApiError, type RazorpayClient } from './client';
import { verifyRazorpayDelivery, type WebhookSecrets } from './verify';

/**
 * Razorpay adapter — the anti-corruption layer (ADR-009/D1).
 *
 * This is the ONLY module allowed to know Razorpay's vocabulary. Every
 * translation below is a TOTAL lookup that throws on anything unmapped,
 * because a `default:` branch in a payments mapping does not fail — it
 * silently invents an entitlement decision, and the failure surfaces
 * months later as a customer with access they never paid for, or a
 * paying customer locked out.
 *
 * TWO SEPARATE MAPPINGS, DELIBERATELY NOT MERGED
 *   1. provider subscription STATE → our `SubscriptionStatus`
 *      (used for `resourceStatus` and `fetchSubscription`)
 *   2. provider EVENT TYPE → our `PaymentEventKind`
 *      (what actually drives the state machine)
 * Collapsing them is tempting because the names rhyme
 * (`subscription.activated` / `active`), and wrong: an event named after
 * a state is not the same fact as the resource being in that state.
 */

/** Razorpay plan ids are `plan_` + 14 alphanumerics = 19 characters. */
const PROVIDER_PLAN_REF_PATTERN = /^plan_[A-Za-z0-9]{14}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The `notes` key carrying our correlation locator. */
export const CORRELATION_NOTE_KEY = 'auxelon_checkout_intent';

/**
 * Billing horizon, in cycles (5.3b-t).
 *
 * Razorpay REQUIRES a bounded subscription — `total_count` or `end_at`,
 * never both — so an "indefinite" SaaS subscription does not exist at
 * the provider. When the count is exhausted the provider moves the
 * subscription to `completed`, which we map to `expired`, which revokes
 * access. For a customer who never cancelled and would have kept
 * paying. So this constant sets the date a paying customer silently
 * loses access, and it is chosen, not defaulted:
 *
 *   10 years, against a documented 100-year API maximum.
 *
 * That pushes the cliff far outside V1's horizon, which is the ONLY
 * reason a renewal path is acceptably out of V1 scope. The two
 * decisions are load-bearing on each other — if this number is ever
 * reduced, the renewal path stops being optional.
 */
const TOTAL_COUNT_BY_INTERVAL: Readonly<Record<BillingInterval, number>> = {
  monthly: 120,
  yearly: 10,
};

/**
 * Provider subscription state → our status.
 *
 * `authenticated → incomplete` is a PRODUCT DECISION, not a technical
 * one: the mandate is approved but the first debit may not have
 * settled, and we grant access only once money has actually moved.
 * Mapping it to `active` would hand out paid access on the strength of
 * an authorisation that can still fail.
 *
 * `halted → past_due` is the other decision that matters. Razorpay's
 * lifecycle lets a halted subscription persist across billing cycles
 * and return to `active` once a debit succeeds, so mapping it to a
 * terminal state would throw away a recoverable paying customer.
 * Entitlement ends from OUR grace expiry under an explicit local
 * policy, never from the provider's state name.
 *
 * `paused`/`resumed` are absent on purpose — out of V1 scope, so they
 * throw rather than being guessed at.
 */
const SUBSCRIPTION_STATE_MAP: Readonly<Record<string, SubscriptionStatus>> = {
  created: 'incomplete',
  authenticated: 'incomplete',
  active: 'active',
  pending: 'past_due',
  halted: 'past_due',
  cancelled: 'canceled',
  completed: 'expired',
  expired: 'expired',
};

export function mapSubscriptionState(state: string): SubscriptionStatus {
  const mapped = SUBSCRIPTION_STATE_MAP[state];
  if (mapped === undefined) {
    throw new WebhookVerificationError(
      `Unmapped Razorpay subscription state: ${state}`
    );
  }
  return mapped;
}

/**
 * Provider event type → our event kind.
 *
 * `subscription.charged` is a MONEY event and moves no status. The
 * subscription becomes active on `subscription.activated`; conflating
 * the two would make a mid-term renewal charge re-activate a
 * subscription the provider had already cancelled.
 *
 * `subscription.completed → expired` is a full-term completion, not a
 * failure — and per 5.3b-t it is an OPERATIONAL ALERT, because with a
 * 10-year horizon its most likely cause is that we under-set
 * `total_count` on a live payer.
 */
const EVENT_KIND_MAP: Readonly<Record<string, PaymentEventKind>> = {
  // Mandate approved. Recorded for forensics; grants nothing.
  'subscription.authenticated': 'mandate_authenticated',
  'subscription.activated': 'activated',
  // Money only. Never a status move.
  'subscription.charged': 'charged',
  // Debit failed; provider still retrying.
  'subscription.pending': 'payment_failed',
  // Provider gave up retrying. RECOVERABLE — maps to past_due, not canceled.
  'subscription.halted': 'payment_failed',
  'subscription.cancelled': 'canceled',
  'subscription.completed': 'expired',
  // Refunds and disputes: ledger effects, no implied entitlement verdict.
  'refund.created': 'refunded',
  'refund.processed': 'refunded',
  'payment.dispute.created': 'charged_back',
  'payment.dispute.lost': 'charged_back',
};

export function mapEventType(providerEventType: string): PaymentEventKind {
  const mapped = EVENT_KIND_MAP[providerEventType];
  if (mapped === undefined) {
    // Throwing beats defaulting. An unrecognised event is either a
    // provider addition we have not reviewed or a subscription to an
    // event we did not intend — both need a human, and neither should
    // reach an entitlement decision.
    throw new WebhookVerificationError(
      `Unmapped Razorpay event type: ${providerEventType}`
    );
  }
  return mapped;
}

export interface RazorpayAdapterConfig {
  /** CONFIGURED, never inferred from a payload (6.1a). */
  readonly environment: PaymentEnvironment;
  readonly webhookSecrets: WebhookSecrets;
  /**
   * Our Razorpay merchant account id (`acc_…`), for the signed
   * account-consistency check (5.3e). Optional: the webhook secret is
   * the actual perimeter, this is defense in depth anchored to signed
   * data. Go-live requires it.
   */
  readonly merchantAccountRef?: string;
  /**
   * Resolves our `plans.provider_refs` entry to a Razorpay plan id.
   *
   * Injected rather than queried here so the adapter keeps no database
   * import — the port's dependency rule applies to its implementations
   * too, and it keeps this file unit-testable without a database.
   */
  readonly resolveProviderPlanRef: (
    planId: string,
    interval: BillingInterval
  ) => Promise<string>;
  /** Structured log sink for rotation observability (5.1a step 3). */
  readonly onPreviousSecretUsed?: (details: { eventId: string }) => void;
}

/** Narrow an unknown into an index-able object without asserting shape. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(source: unknown, key: string): string | undefined {
  const record = asRecord(source);
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readInteger(source: unknown, key: string): number | undefined {
  const record = asRecord(source);
  const value = record?.[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** `payload.<entity>.entity`, the shape Razorpay wraps every event in. */
function entity(payload: unknown, name: string): Record<string, unknown> | undefined {
  return asRecord(asRecord(asRecord(payload)?.[name])?.entity);
}

/** Unix seconds → ISO. Returns undefined rather than an Invalid Date. */
function unixToIso(seconds: number | undefined): string | undefined {
  if (seconds === undefined || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export class RazorpayPaymentProvider implements PaymentProvider {
  readonly id = 'razorpay';
  readonly environment: PaymentEnvironment;

  /**
   * Razorpay's Create Subscription API documents no idempotency
   * mechanism. Stating that as a capability makes the ABSENCE of an
   * idempotency header a recorded fact about the vendor rather than an
   * oversight here — and stops a future reader "completing" the adapter
   * by inventing a header the provider ignores, which would give a
   * false sense of safety on the one call that can double-charge.
   *
   * Because it is unsupported, an ambiguous create is resolved by
   * READING STATE BACK, never by sending the create again.
   */
  readonly capabilities: PaymentProviderCapabilities = {
    createSubscriptionIdempotency: 'unsupported',
  };

  private readonly client: RazorpayClient;
  private readonly config: RazorpayAdapterConfig;

  constructor(client: RazorpayClient, config: RazorpayAdapterConfig) {
    this.client = client;
    this.config = config;
    this.environment = config.environment;
  }

  /**
   * Create the provider-side subscription for an intent we already wrote.
   *
   * The request body is a CLOSED literal. Razorpay's Create
   * Subscription API is strict in both directions — a missing required
   * field and an unrecognised extra field are both `400` — so there is
   * no spreading of caller input and no passthrough object anywhere in
   * this method. Every documented `400` on that endpoint is a failed
   * checkout for a real customer, so each one is prevented structurally
   * rather than handled after the fact.
   */
  async createCheckout(intent: CheckoutIntent): Promise<CheckoutHandle> {
    const providerPlanRef = await this.config.resolveProviderPlanRef(
      intent.planId,
      intent.interval
    );

    // Validate the shape of OUR seed data before spending a network
    // call on it. A typo'd `provider_refs` value must fail loudly here,
    // for an operator, rather than as a provider 400 for a customer
    // halfway through checkout.
    if (!PROVIDER_PLAN_REF_PATTERN.test(providerPlanRef)) {
      throw new Error(
        `Invalid Razorpay plan ref for plan ${intent.planId}/${intent.interval}: ` +
          'expected the documented plan_<14 alphanumerics> shape'
      );
    }

    const totalCount = TOTAL_COUNT_BY_INTERVAL[intent.interval];

    // ── The closed contract. Exactly five keys, nothing else. ──
    //
    // Notably ABSENT, each for a documented reason:
    //   start_at — omitted so the subscription starts after
    //              authorisation. A computed "now" is a clock-skew
    //              `start_at cannot be lesser than the current time`
    //              400 waiting to happen.
    //   end_at   — mutually exclusive with total_count, not merely
    //              redundant. Sending both is a documented 400.
    const body = {
      plan_id: providerPlanRef,
      total_count: totalCount,
      // Pinned. V1 has no per-seat billing (D6), so this is NEVER read
      // from a request body — the second place, after Task 7's strict
      // schema, where a smuggled `quantity: 100` dies.
      quantity: 1,
      // Explicit product decision (5.3b-n). The provider default is
      // `true`, which would have Razorpay emailing our customers about
      // charge events — duplicate and off-brand for a product that owns
      // its own transactional email. Never left to the default.
      customer_notify: false,
      // The correlation locator (5.3a-i). REQUIRED, not diagnostic:
      // without it, a crash between "provider created" and
      // "provider_ref persisted" leaves both provider_ref lookups
      // missing by construction, and a paying customer unrecoverable.
      notes: { [CORRELATION_NOTE_KEY]: intent.intentId },
    } as const;

    const response = await this.client.request<Record<string, unknown>>(
      'POST',
      '/subscriptions',
      body
    );

    const providerRef = readString(response, 'id');
    if (!providerRef) {
      throw new RazorpayApiError(
        'Razorpay create subscription returned no id',
        // Ambiguous: a 2xx without an id means something exists that we
        // cannot name. Reconcile by intent; never retry the create.
        { status: 200, ambiguous: true }
      );
    }

    // Never hand-build a provider URL from an id or a template. If the
    // documented `short_url` is absent from a 2xx, that is an ambiguous
    // create to be reconciled — not an invitation to improvise a
    // redirect that may take a customer to a page that charges them
    // against the wrong resource.
    const authorizeUrl = readString(response, 'short_url');
    if (!authorizeUrl) {
      throw new RazorpayApiError(
        `Razorpay subscription ${providerRef} has no short_url to authorise against`,
        { status: 200, ambiguous: true }
      );
    }

    // Echo-verify the locator. The response echoes `notes`; if ours did
    // not survive the round trip, the correlation guarantee above is
    // void for this subscription, and the only moment we can still act
    // on that is now, while we hold the intent in hand.
    const echoedIntentId = readString(
      asRecord(response)?.notes,
      CORRELATION_NOTE_KEY
    );
    if (echoedIntentId !== intent.intentId) {
      throw new RazorpayApiError(
        `Razorpay subscription ${providerRef} did not echo the correlation note — ` +
          'correlation cannot be guaranteed for this subscription',
        { status: 200, ambiguous: true }
      );
    }

    return {
      providerRef,
      authorizeUrl,
      customerRef: readString(response, 'customer_id'),
    };
  }

  /**
   * Verify, then parse. Throws on every failure (F2).
   *
   * Order is load-bearing and identical to `verify.ts`: origin first,
   * meaning second. Nothing in this method reads the body before
   * `verifyRazorpayDelivery` has returned.
   */
  async verifyAndParse(raw: RawWebhook): Promise<PaymentEvent> {
    const verified = verifyRazorpayDelivery(
      raw.rawBody,
      raw.headers,
      this.config.webhookSecrets
    );

    if (verified.matchedSecret === 'previous') {
      // Not an error — the provider's retry window outlives a rotation
      // — but the rotation runbook's "wait until no retries rely on the
      // old secret" step reads this signal, so it must be emitted.
      this.config.onPreviousSecretUsed?.({ eventId: verified.eventId });
    }

    const body = asRecord(verified.body);
    const providerEventType = readString(body, 'event');
    if (!providerEventType) {
      throw new WebhookVerificationError('Razorpay webhook has no event field');
    }

    // ── Signed provider-account consistency (5.3e). ──
    //
    // Razorpay carries `account_id` INSIDE the signed body, so unlike
    // the event-id header this is authenticated data. It anchors the
    // environment gate to something signed rather than to configuration
    // alone.
    //
    // The boundary is exact:
    //   ALLOWED:   Razorpay account_id → "is this webhook ours?"
    //   FORBIDDEN: Razorpay account_id → an Auxelon account_id
    // It is a provider-identity assertion, never tenant resolution.
    const configuredMerchant = this.config.merchantAccountRef;
    if (configuredMerchant) {
      const observedMerchant = readString(body, 'account_id');
      if (observedMerchant !== configuredMerchant) {
        throw new WebhookVerificationError(
          'Razorpay webhook account_id does not match the configured merchant account'
        );
      }
    }

    const kind = mapEventType(providerEventType);
    const payload = asRecord(body)?.payload;

    const subscriptionEntity = entity(payload, 'subscription');
    const paymentEntity = entity(payload, 'payment');
    const refundEntity = entity(payload, 'refund');
    const disputeEntity = entity(payload, 'dispute');

    const subscriptionRef = subscriptionEntity
      ? readString(subscriptionEntity, 'id')
      : undefined;

    // ── `provider_ref` selection is the ledger's duplicate fence. ──
    //
    // For a money event it MUST be the money resource's own id (payment
    // / refund / dispute), because `payment_transactions` enforces
    // uniqueness on it — that is what stops one charge being banked
    // twice when a delivery arrives with a fresh event id (A35). Using
    // the subscription id here would make every renewal charge look
    // like a duplicate of the first and silently drop revenue.
    const moneyEntity = refundEntity ?? disputeEntity ?? paymentEntity;
    const providerRef =
      kind === 'charged' || kind === 'refunded' || kind === 'charged_back'
        ? readString(moneyEntity, 'id')
        : subscriptionRef;

    if (!providerRef) {
      throw new WebhookVerificationError(
        `Razorpay ${providerEventType} carries no resource id to key on`
      );
    }

    const amountSource = moneyEntity;
    const amountMinor = readInteger(amountSource, 'amount');
    const currency = readString(amountSource, 'currency');

    // ── The correlation locator. ──
    //
    // Read ONLY from the subscription entity: Razorpay documents `notes`
    // on the subscription object, while a payment entity's `notes` is a
    // different field that its own published sample shows as `[]`.
    // Reading the wrong one would correlate against attacker-influenced
    // data on some events and nothing at all on others.
    //
    // Anything that is not a UUID is dropped SILENTLY — it is untrusted
    // input, so it gets no error path of its own. And it is a locator,
    // never authority: it can only point at one of our own
    // `checkout_intents` rows, and the tenant still comes from that row.
    const rawLocator = readString(
      subscriptionEntity?.notes,
      CORRELATION_NOTE_KEY
    );
    const correlationIntentId =
      rawLocator && UUID_PATTERN.test(rawLocator) ? rawLocator : undefined;

    const providerState = subscriptionEntity
      ? readString(subscriptionEntity, 'status')
      : undefined;

    return {
      kind,
      // From the header. Deduplicates DELIVERIES; because it is outside
      // the HMAC, duplicate money EFFECTS are fenced separately at the
      // ledger by `provider_ref` uniqueness (A35).
      eventId: verified.eventId,
      providerRef,
      subscriptionRef,
      customerRef: readString(subscriptionEntity, 'customer_id'),
      invoiceRef: readString(paymentEntity, 'invoice_id'),
      occurredAt: unixToIso(readInteger(body, 'created_at')),
      // The provider's own authoritative state, preferred over
      // `occurredAt` for ordering.
      resourceStatus: providerState ? mapSubscriptionState(providerState) : undefined,
      resourceVersion: providerState,
      amountMinor,
      currency,
      // Stamped from the credential set that verified this signature —
      // which, because only one set is loaded, is the CONFIGURED one.
      // Never a payload field and never a header (A30).
      environment: this.config.environment,
      correlationIntentId,
      providerEventType,
      payloadDigest: verified.payloadDigest,
    };
  }

  /** Read authoritative state back. The resolution for any ambiguity. */
  async fetchSubscription(providerRef: string): Promise<ProviderSubscription> {
    const response = await this.client.request<Record<string, unknown>>(
      'GET',
      `/subscriptions/${encodeURIComponent(providerRef)}`
    );

    const state = readString(response, 'status');
    if (!state) {
      throw new RazorpayApiError(
        `Razorpay subscription ${providerRef} returned no status`,
        { status: 200, ambiguous: false }
      );
    }

    return {
      providerRef: readString(response, 'id') ?? providerRef,
      status: mapSubscriptionState(state),
      currentPeriodEnd: unixToIso(readInteger(response, 'current_end')),
      // ── DELIBERATELY ALWAYS FALSE, AND NOT A STUB. ──
      //
      // Razorpay exposes no field that reliably reports "cancels at
      // cycle end" on a subscription that is still `active`. Inventing
      // one would be worse than omitting it: reconciliation would read
      // `false` off the provider and CLEAR a flag a customer really
      // set, quietly renewing a subscription they had cancelled.
      //
      // Contract for reconciliation (Task 10): this field must never be
      // used to clear a locally-set `cancel_at_period_end`. The local
      // flag is authoritative for scheduling; the provider is
      // authoritative for status.
      cancelAtPeriodEnd: false,
      environment: this.config.environment,
      // Reconciliation keys its synthetic event id on this, so each
      // materially different observed state is its own idempotent
      // event while a re-observation collapses to one row.
      stateVersion: state,
      correlationIntentId: (() => {
        const locator = readString(asRecord(response)?.notes, CORRELATION_NOTE_KEY);
        return locator && UUID_PATTERN.test(locator) ? locator : undefined;
      })(),
    };
  }

  /**
   * Ask the provider to cancel at the end of the paid period.
   *
   * Records INTENT only. Entitlement does not move here — it moves when
   * the provider confirms via webhook or reconciliation. A local write
   * on the strength of this call would revoke access for a customer
   * whose cancellation the provider then rejected.
   */
  async cancelAtPeriodEnd(providerRef: string): Promise<void> {
    await this.client.request(
      'POST',
      `/subscriptions/${encodeURIComponent(providerRef)}/cancel`,
      // `1` = at cycle end. `0` would cancel IMMEDIATELY and destroy
      // paid-for access the customer is still entitled to.
      { cancel_at_cycle_end: 1 }
    );
  }
}

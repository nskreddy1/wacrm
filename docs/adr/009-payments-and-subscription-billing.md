# ADR-009: Payments, subscription lifecycle, and the entitlement projection

**Status:** Proposed
**Date:** 2026-08-22
**Deciders:** Owner/product (provider account, price list, refund policy), backend (port + state machine + webhook), security (signature handling, money authority)
**Relates to:** ADR-008 (decides *what* we charge — this ADR decides *how* the money moves; closes ADR-008/D12), ADR-007 (module ceiling the tier buys), ADR-INFRA-001 (Workers runtime limits this must live inside), ADR-INFRA-002 (database portability — no vendor SQL here)

> **Why this is a separate ADR.** ADR-008 fixed the *pricing shape* — per
> workspace, metered on conversations, seats free. It deliberately left
> "self-serve payment/checkout" out of scope (D12) because that needs a provider
> decision and a money-handling contract. Those are the two things this ADR
> decides. Pricing changes for commercial reasons; payment mechanics change for
> compliance and provider reasons. Different reviewers, different blast radius.

---

## Context

**What already exists (verified in code, not assumed).**

| Fact | Where |
| --- | --- |
| `plans` is a real, admin-editable table with `price_monthly`, `price_yearly`, `currency` (default `INR`), `features`, `is_active`, `is_default`, `sort_order` | `supabase/migrations/20260726130000_customizable_plans.sql` |
| Prices are already stored in **minor units** (paise), integer, `NULL` = "contact us" | same migration, lines 19–23 |
| `accounts.plan_id` is the **only** entitlement input to enforcement | `20260726120000_plans_and_quotas.sql`, `src/lib/quotas/index.ts` |
| Per-tenant `account_limit_overrides` beat the plan value, `unlimited_all` beats everything | `src/lib/quotas/index.ts` (`resolveLimit`) |
| Quota checks **fail open** by design | `src/lib/quotas/index.ts` header |
| Plan writes go through `/api/admin/plans` behind `requireSuperAdmin()`, service-role, no RLS write policies | `src/app/api/admin/plans/route.ts`, `plan-validation.ts` |
| An idempotent webhook-claim pattern already exists (`webhook_events`, PK = provider event id, `INSERT … ON CONFLICT DO NOTHING`) | `20260822130000_webhook_event_dedupe.sql` |
| A port convention exists for swappable infrastructure, with a hard "no vendor SDK in a port" rule | `src/lib/ports/message-ingress.ts` |
| Env names resolve in exactly one module; optional getters return `undefined` and the feature must degrade or fail closed | `src/lib/env.ts` |
| Cron routes authenticate with `authorizeCronRequest()` + `cronAuthEnv()` | `src/features/flows/lib/cron-auth.ts`, `src/lib/env.ts`, used by `/api/flows/cron` |
| `/api/webhooks/` is **already** an unauthenticated public prefix — a route placed there has no gate but its own signature check | `src/middleware.ts` (`PUBLIC_PREFIXES`) |

So the billing *catalogue* is done. What is missing is everything between "the
tenant clicks Upgrade" and "`accounts.plan_id` says `growth`", plus the far
harder half: what happens when that path fails halfway.

**Runtime constraints (ADR-INFRA-001).** One Next.js process on the Cloudflare
Workers free tier: ~100k requests/day, 10 ms CPU per invocation, 50 subrequests
per invocation, Hyperdrive 100k queries/day. There is **no long-running worker
and no queue consumer**. Anything that must happen "later" is either a webhook
we receive or a cron route we already have. A payment design that assumes a
background job runner does not fit this system.

**Commercial constraint.** Canonical site is `https://auxelon.in`, prices are
seeded in INR. India's recurring-payment rules (RBI e-mandate framework) require
additional-factor authentication, pre-debit notification, and impose a
per-transaction auto-debit ceiling above which every debit needs AFA. The exact
current ceiling is a **provider-confirmed input, not an architectural constant** —
do not hard-code a number from memory into pricing.

**No payment provider account exists yet**, exactly as no Meta app exists.
ADR-008's env work already established the policy for that situation: the
credential is optional, and the feature stays dormant and fails closed until it
is set.

---

## Decision

### Part 1 — Shape: payments is a bounded context behind a port

1. **D1 — One port, `src/lib/ports/payment-provider.ts`, and no vendor SDK
   outside its adapters.** Same rule as `message-ingress.ts`: the port imports
   no Next.js, no `@supabase/*`, no provider SDK. The domain speaks
   `CheckoutIntent`, `ProviderSubscription`, `PaymentEvent`; only the adapter
   knows what a Razorpay `subscription.charged` payload looks like.

   ```ts
   // shape only — the contract, not the implementation
   export interface PaymentProvider {
    readonly id: 'razorpay' | 'stripe' | 'noop';
    /**
     * Does this provider *document* idempotency on subscription creation?
     * Declared, not assumed: Razorpay documents idempotency for some APIs
     * (refunds, payouts) but not for Create Subscription, so its adapter sends
     * no idempotency header and relies on provider_ref reconciliation instead.
     */
    readonly supportsCreateIdempotency: boolean;
    /** Create a provider-hosted checkout for one plan+interval. */
    createCheckout(intent: CheckoutIntent): Promise<CheckoutHandle>;
     /** Translate a raw request into a verified, normalised domain event. */
     verifyAndParse(raw: RawWebhook): Promise<PaymentEvent>;   // throws = reject
     /** Truth-from-source, for the reconciliation cron (D14). */
     fetchSubscription(providerRef: string): Promise<ProviderSubscription>;
     cancelAtPeriodEnd(providerRef: string): Promise<void>;
   }
   ```

2. **D2 — Razorpay is the first adapter; Stripe is the second, not the
   fallback.** INR-domestic collection with UPI Autopay / e-mandate is the
   requirement `auxelon.in` actually has, and it is the axis where the two
   providers differ most. Provider selection is a **Strategy** resolved from
   `PAYMENTS_PROVIDER` in `src/lib/env.ts` — one optional getter, one factory,
   no `if (razorpay)` scattered through features.

3. **D3 — Unset credentials ⇒ `NoopPaymentProvider` (Null Object), and the
   whole surface fails closed.** `POST /api/billing/checkout` returns
   `503 payments_unavailable`; the pricing UI renders "Contact us" instead of
   Upgrade; the webhook route returns 404. No half-configured state where we
   create an order we can never verify a payment for.

4. **D4 — Provider-hosted checkout only. Card data never touches our origin.**
   We create the order/subscription server-side and hand the browser a provider
   handle. No PAN, CVV, or UPI credential is ever posted to, logged by, or
   proxied through this application. This is a hard boundary, not an
   optimisation: it keeps us in the lightest PCI scope (SAQ-A) permanently.

### Part 2 — Money integrity

5. **D5 — The server is the only price authority.** The checkout request body
   is `{ planId, interval: 'monthly' | 'yearly' }` **and nothing else**. Amount
   and currency are read from the `plans` row inside the same request; a plan
   with `is_active = false` or `price_monthly IS NULL` is rejected `400`. Any
   request that carries an `amount`, `currency`, `quantity`, or `discount` field
   is rejected outright rather than ignored — silently ignoring an injected
   amount trains no-one and hides an attack in the logs.

6. **D6 — No seat quantity exists, so no quantity is multiplied.** ADR-008/D1
   priced per workspace. The absence of a quantity field is a *feature*: the
   entire class of "quantity tampering" bugs cannot occur.

7. **D7 — Integer minor units end to end, currency always adjacent.** Every
   money column is `INTEGER` (paise) plus a `currency TEXT`, matching `plans`.
   No floats, no `NUMERIC` arithmetic in JS, no bare amount without its
   currency. Display goes through the existing `formatCurrencyPrecise`
   (`src/lib/currency.ts`), which is already total on bad codes.

8. **D8 — Append-only ledger.** `payment_transactions` rows (charge, refund,
   chargeback) are **inserted, never updated**. A refund is a new negative-signed
   row referencing the original, not a mutation of it. Balances and invoices are
   *derived*. This is what makes reconciliation and dispute handling possible at
   all; a mutable "current amount" column destroys the evidence you need on the
   day it matters.

### Part 3 — Lifecycle: the webhook is the truth

9. **D9 — The browser redirect grants nothing.** The return URL is a UX hint
   that polls our own read model. Entitlement changes only when a **verified
   webhook** (or the reconciliation cron, D14) says so. Anyone can hit a return
   URL; nobody can forge a signed event.

10. **D10 — An explicit state machine on `subscriptions.status`, with illegal
    transitions rejected rather than shrugged at.**

    ```
    incomplete ──activated──> active ──payment_failed──> past_due
        │                       │  ↑                        │
        │                       │  └──────recovered─────────┘
        │                       │                            │ grace expired (D13)
        └──abandoned──> expired │                            ▼
                                └──cancel_at_period_end──> canceled ──> expired
    ```

    The transition table lives in one pure module with its own unit tests
    (`src/features/billing/lib/subscription-state.ts`), takes
    `(current, event) → next | Illegal`, and touches no I/O. Pure state logic is
    the cheapest thing in this entire design to test exhaustively, and the most
    expensive to get wrong.

    **This enum is *our* vocabulary, and the provider's is not it.** Razorpay's
    subscription lifecycle is a different, larger set (`created`,
    `authenticated`, `active`, `pending`, `halted`, `cancelled`, `completed`,
    `expired`, `paused`/`resumed`, plus money events like
    `subscription.charged`), and Stripe's is different again. The translation is
    an **explicit, total mapping table inside each adapter** (the D1
    anti-corruption layer) that **throws on an unmapped provider state** rather
    than falling through to a plausible default — because a `default:` branch in
    that position silently invents entitlement. Notably: `authenticated` (mandate
    approved, first debit possibly unsettled), `halted` (provider stopped
    retrying), and `completed` (term ran out normally — terminal, *not* a
    failure) each need a deliberate product decision, not a guess; and
    `subscription.charged` moves no status at all, it appends to the ledger. The
    per-state mapping is enumerated in the implementation plan and unit-tested
    row by row.

11. **D11 — Idempotent receiver, but failing *closed* — the opposite of message
    ingress.** Webhook dedupe reuses the proven `INSERT … ON CONFLICT DO NOTHING`
    claim shape, in its **own** `payment_events` table, claiming on
    **`(provider, environment, event_id)`** — a provider event id is unique only
    within one provider's one environment, so the triple is the identity and a
    bare `event_id` primary key would break the moment Stripe (D2) or test/live
    separation arrives. This claim is also the **entire** replay defense (F2).
    The difference is
    deliberate and must be stated in the code: `IngressDedupeStore.claim()` fails
    **open** because a duplicate reply beats a dropped customer message. A
    payment claim fails **closed** — if the claim insert errors we return `5xx`
    so the provider retries. Double-processing money is worse than delaying it,
    and the provider's retry is a free, reliable second chance.

12. **D12 — Out-of-order events are rejected by a monotonic guard, not
    last-write-wins.** Providers deliver at-least-once and out of order; a stale
    `payment_failed` arriving after a recovery would downgrade a paying tenant.
    Each subscription row carries `last_event_at` (provider timestamp) and the
    apply step ignores any event not strictly newer for that subscription —
    optimistic concurrency against the provider's own clock.

13. **D13 — `past_due` degrades on a grace period; it never cuts mid-sentence.**
    Consistent with ADR-008/D4: on failed payment we warn in Settings →
    Plan & usage and keep serving for a grace window (default 7 days, one column,
    no deploy to change). Only when it expires does the account move to the
    `is_default` plan. And a downgrade **never deletes data** that exceeds the new
    caps — the tenant keeps every contact, and the quota engine simply refuses
    *additions* (which it already does, from `accounts.plan_id`, with no new code).

14. **D14 — A daily reconciliation cron is part of the design, not a
    contingency.** Webhooks are at-least-once, not guaranteed-once: an outage on
    our side during a delivery window is a silently unactivated paying customer.
    `/api/cron/billing-reconcile` (existing `authorizeCronRequest()` pattern) pages through
    non-terminal subscriptions, calls `fetchSubscription`, and applies drift
    through the same transition table. It is **cursor-based and bounded per run**
    to respect the Workers 50-subrequest and 10 ms-CPU limits — a cron that tries
    to reconcile everything in one invocation is a cron that reconciles nothing.

    **Orphans are alerted, never adopted.** If the provider reports an active
    subscription whose `(provider, environment, provider_ref)` matches neither a
    `subscriptions` row nor a `checkout_intents` row, the cron records
    `ORPHAN_PROVIDER_SUBSCRIPTION`, counts it, and **alerts a human**. It must not
    create a tenant mapping to make the discrepancy go away: inventing an
    `account_id` from an unknown external resource is precisely the tenant
    assignment `F3` forbids, and the failure mode is granting a paying stranger's
    subscription to the wrong tenant. An orphan means a real customer we cannot
    identify — that is an incident, and it should be loud rather than quietly
    healed into the wrong account.

### Part 4 — The join to entitlement

15. **D15 — `accounts.plan_id` stays the single read model, and the hot path
    never reads a payment table.** Activation claims the event in
    `payment_events` and writes `subscriptions`, `payment_transactions`, *and*
    `accounts.plan_id` in **one transaction** through a single RPC,
    `process_payment_event(...)`. The claim is inside that RPC deliberately: in
    `supabase-js` each call is its own transaction, so a separate claim insert
    could commit while the apply rolled back, permanently consuming the
    provider's redelivery for an event that was never applied. Consequence, and the
    reason for this decision: a total payment-provider outage cannot slow or
    break message delivery, because messaging reads `plan_id` and knows nothing
    about billing. A CQRS-style projection here buys real fault isolation, not
    architectural decoration.

16. **D16 — Payments must never overwrite an override or a manual account.**
    `account_limit_overrides` continues to win (`src/lib/quotas/index.ts`,
    unchanged). A new `accounts.billing_mode` (`'self_serve' | 'manual'`) makes
    enterprise/hand-priced tenants immune to provider-driven plan changes: an
    event for a `manual` account is recorded and **not applied**, then alerted.
    Without this, one stale provider event silently downgrades the biggest
    customer you have.

17. **D17 — Deliberately out of scope.** India GST invoice-series compliance
    (legal work, not architecture), multi-currency price localisation,
    usage-based overage *billing* (ADR-008/D4 keeps overage soft), per-seat
    billing (never — ADR-008/D1), marketplace payouts, and a dunning email
    sequence beyond the single grace-period warning.

---

## Options considered

### Where payment state lives

| Option | Money integrity | Fits Workers free tier | Verdict |
| --- | --- | --- | --- |
| **A. Trust the redirect, set `plan_id` on return** | None — forgeable by URL | Yes | **Rejected.** This is the classic self-serve billing hole. |
| **B. Webhook-authoritative + idempotent ledger + reconciliation cron (chosen)** | Strong: signed events, dedupe, append-only, drift repair | Yes — one route + one bounded cron | **Chosen** (D9–D14) |
| **C. Full event-sourced billing with projections rebuilt on read** | Strongest | No — replay CPU per request blows the 10 ms budget | Rejected as over-built for four tiers. |
| **D. Provider is the only store; query it on every entitlement check** | Good | No — an API call in the messaging hot path, and a provider outage becomes our outage | **Rejected** (contradicts D15). |

### Provider

| Option | INR / UPI mandate | Non-INR reach | Lock-in | Verdict |
| --- | --- | --- | --- | --- |
| **A. Razorpay first, behind the port (chosen)** | Native UPI Autopay / e-mandate | Weaker | Contained by D1 | **Chosen** (D2) |
| **B. Stripe only** | Constrained for domestic Indian recurring | Excellent | Contained | Deferred — becomes the second adapter when non-INR demand is real. |
| **C. Both from day one** | — | — | — | Rejected: two reconciliation paths and two webhook contracts to secure, for one merchant's worth of revenue. |
| **D. Manual bank transfer + admin sets the plan** | n/a | n/a | None | Kept as the `manual` `billing_mode` (D16) — it is the enterprise path, not the self-serve one. |

---

## Design patterns applied

Each row is here because it removes a specific failure, not because it has a name.

| Pattern | Applied to | Failure it removes |
| --- | --- | --- |
| Ports & Adapters (Hexagonal) | `PaymentProvider` port (D1) | Provider swap becoming a rewrite; SDK types leaking into features |
| Strategy | Provider chosen by env (D2) | Conditionals per provider spread across call sites |
| Null Object | `NoopPaymentProvider` (D3) | Half-configured billing that creates unverifiable orders |
| Anti-corruption layer | `verifyAndParse` → domain `PaymentEvent` (D1) | Provider payload shapes becoming our schema |
| State machine | `subscription-state.ts` (D10) | Impossible states; "how did it get from expired to active?" |
| Idempotent receiver | `payment_events` claim, inside the apply transaction (D11, D15) | Double activation; or a committed claim whose apply rolled back, silently burning the provider's redelivery |
| Optimistic concurrency | `last_event_at` guard (D12) | A stale failure event downgrading a recovered tenant |
| Ledger / append-only log | `payment_transactions` (D8) | Losing the evidence trail exactly when a dispute needs it |
| Unit of Work | single `apply_subscription_state` RPC (D15) | A subscription row that says `active` while `plan_id` says `free` |
| CQRS-style read model | `accounts.plan_id` projection (D15) | Billing availability coupling into message delivery |
| Fail-closed boundary | signature + claim + missing config (D3, D11, F2) | Unsigned or unverifiable input reaching money code |
| Reconciliation loop | `billing-reconcile` cron (D14) | A lost webhook = a silently unactivated paying customer |

---

## Data model (additive; no existing column changes)

```
plans (existing)                accounts (existing)
  price_monthly / price_yearly    plan_id            ← the read model (D15)
  currency / is_active            billing_mode  (+)  ← 'self_serve' | 'manual' (D16)
  provider_refs JSONB (+)         grace_until   (+)  ← nullable, set on past_due (D13)
        │
        │  1:N
        ▼
subscriptions (new)                    payment_events (new)         payment_transactions (new)
  id UUID PK                           id UUID PK                      id UUID PK, account_id
  account_id → accounts                provider, environment           subscription_id
  plan_id → plans                      event_id                        kind: charge|refund|chargeback
  provider, environment                UNIQUE (provider,               amount_minor INTEGER  (signed)
  provider_ref                           environment, event_id)        currency
  UNIQUE (provider, environment,         ← the claim (D11)             provider, environment, provider_ref
          provider_ref)                subscription_id (nullable)      UNIQUE (provider, environment,
  status  (D10 enum)                   status: applied|ignored|failed          provider_ref)
  interval, amount_minor, currency     ignored_reason                  occurred_at
  current_period_end                   received_at, event_at           (append-only, D8)
  cancel_at_period_end BOOLEAN         payload_digest ← not payload
  last_event_at  (D12)
```

**Every provider identifier is scoped, never globally unique.** A provider ref
and a provider event id are unique only within `(provider, environment)` — the
same string can legitimately exist in Razorpay test and Razorpay live, and
Stripe (D2) has its own id space entirely. So each uniqueness constraint above is
a **three-column** constraint, and every internal foreign key points at our own
surrogate `UUID` rather than at a provider string. A bare `event_id PRIMARY KEY`
would have made the second provider — or the first day of test/live separation —
a migration.

- **RLS:** members may `SELECT` their own account's `subscriptions` and
  `payment_transactions`. **No write policies at all** — every write is
  service-role through the RPC, matching the `plans` security model.
- `payment_events` stores a **digest**, not the raw payload: enough to debug a
  redelivery, no PII or instrument data at rest (F7).
- `provider_refs JSONB` on `plans` maps our tier id to the provider's plan id
  per provider, so adding Stripe adds a key, not a column.

## Request flows

**Upgrade (happy path).** `POST /api/billing/checkout {planId, interval}` →
rate limit + `channels`-style permission check (owner only) → load plan, assert
`is_active` and price present (D5) → record a `checkout_intents` row, **whose id
is the idempotency identity of this payment journey** → `createCheckout` → row in
`subscriptions` as `incomplete` → browser completes provider-hosted checkout
(D4) → **webhook** `subscription.activated` → verify (F2) → claim (D11) →
transition (D10) → one RPC writes `subscriptions` + `accounts.plan_id` + audit
event (D15) → return page's poll sees the new plan.

**The race that will actually happen:** the webhook lands *before* the browser
returns. That is why the return page polls our read model instead of asserting
anything — both orders converge on the same state, and neither grants
entitlement on its own.

**Failed renewal.** `payment.failed` → `active → past_due`, `grace_until = now +
7d`, warning in Settings → Plan & usage. Recovery inside the window →
`past_due → active`, grace cleared. Window expires (detected by the same cron as
D14) → move to `is_default` plan, data untouched (D13).

**Refund.** New negative `payment_transactions` row (D8). Entitlement changes
only if the provider also cancels the subscription — a refund is not a
cancellation, and inferring one from the other is how customers lose access they
paid for.

## Failure modes

| Failure | Behaviour | Why acceptable |
| --- | --- | --- |
| Provider API down at checkout | `503`, no local row committed, tenant keeps current plan | Nothing partially created; retry is safe |
| Webhook signature invalid/absent secret | `401`, nothing recorded except an alert | Fail closed (F2) |
| Duplicate webhook delivery | Claim conflict → `200`, no re-apply | D11 |
| Out-of-order webhook | Recorded as `ignored`, reason stored | D12 |
| DB error mid-apply | Transaction rolls back, `5xx` → provider retries | D11 + D15 |
| Webhook never arrives | Cron repairs within 24 h | D14 |
| Payment system entirely broken | Messaging, flows, AI unaffected | D15 |
| Stale event for a `manual` account | Recorded, not applied, alerted | D16 |

---

## Security and correctness review (binding)

- **F1 — Amount and currency are never accepted from the client** (D5). The
  handler recomputes from `plans`; a body carrying `amount` is a `400`, logged as
  a suspicious request.
- **F2 — Webhook signature verification is mandatory and fails closed.** Read
  the **raw** body before any JSON parse, constant-time compare
  (`crypto.timingSafeEqual`), parse only after the signature verifies, and treat a
  missing webhook secret as "reject everything" — never as "skip verification".
  The webhook path is exempt from session auth *and therefore* has no other gate
  than this one.
  **Replay is defended by identity, not by freshness.** Do **not** reject a
  validly signed event for being old: Razorpay's signature is an HMAC over the
  raw body with no documented signed timestamp to anchor a freshness check on, and
  Razorpay retries failed deliveries with backoff for up to 24 hours — so a
  timestamp window discards legitimate retries (real money) while stopping nothing
  an attacker could otherwise send. The `UNIQUE (provider, environment, event_id)`
  claim (D11) is the replay defense. Where a provider *does* sign a timestamp,
  freshness enforcement is that **adapter's** business, never a shared rule.
- **F3 — Provider payload is data, never instructions** (`AGENTS.md`). The
  tenant is resolved from **our** `subscriptions.provider_ref` mapping. A
  `metadata.account_id` in the payload may be used to *cross-check* and alert on
  mismatch, never as the sole authority for whose plan changes.
- **F4 — Checkout is owner-scoped and rate-limited.** Re-check owner permission
  server-side (not from layout placement, per ADR-008/F3) and reuse
  `src/lib/rate-limit.ts` so a compromised session cannot spam provider orders.
- **F5 — Overrides and manual accounts are untouchable by payments** (D16). Test:
  an `unlimited_all` account receiving a downgrade event keeps unlimited.
- **F6 — Every entitlement change writes an audit event** (`src/lib/audit-events.ts`)
  with actor `system:billing` and the causing `event_id`. "Why is this account on
  Free?" must be answerable from the record.
- **F7 — No instrument data, no raw payloads at rest or in logs.** Digest only
  (data model). Logs carry `event_id`, `account_id`, `status` — never the
  payload, never card/UPI identifiers.
- **F8 — Secrets resolve only through `src/lib/env.ts`** (key, webhook secret,
  provider id) as optional getters that degrade to `NoopPaymentProvider`. New
  names go in both `.env.*.example` manifests so `check-env-completeness
  --contract` stays green.
- **F9 — Money reads and writes are `account_id`-scoped end to end**; the usage
  page must not be able to surface another tenant's amounts (ADR-008/F6).
- **F10 — Cancellation is confirmed and reversible until period end**
  (`cancel_at_period_end`), and downgrade deletes no data (D13).

---

## Consequences

**Easier**

- Self-serve revenue with no new pricing surface: the tiers, prices, and
  currency already exist in `plans` and stay super-admin-editable without a
  deploy.
- Enforcement is unchanged. The quota engine keeps reading `plan_id` and never
  learns that payments exist.
- Provider migration is one adapter plus one `provider_refs` key.
- "What happened to this account's billing?" is answerable from an append-only
  ledger plus an event log with reasons for every ignored event.

**Harder**

- Webhook + cron + state machine is genuinely more code than "set the plan on
  redirect" — that is the price of not corrupting money state, and it is worth
  paying once.
- Refunds, chargebacks, and India GST invoicing remain manual for now (D17), and
  GST is a legal dependency that could force an invoice-numbering schema later.
- The grace period makes revenue slightly less predictable than a hard cutoff
  and creates a support workload at the boundary.
- Two provider environments (test/live) means two webhook secrets and a real
  chance of pointing one at the other; the `provider` column on every row is
  what makes that mistake visible instead of silent.

**Revisit when**

- Non-INR demand appears → add the Stripe adapter (D2), no domain change.
- Overage becomes material → ADR-008/D4's "degrade, don't bill" gets revisited
  *before* any metered-billing code is written.
- Webhook volume or reconciliation cost approaches the Workers/Hyperdrive free
  quotas → measure first, then scale the one component that bound (ADR-INFRA-001
  discipline; a payment webhook is a rounding error against 100k requests/day).
- A dispute or audit forces invoice-series compliance → the ledger is already
  the right substrate; only presentation and numbering are missing.

---

## Action items

> Sequenced, with an adversarial review pass (attack tree A1–A27), in
> [`.agents/plans/2026-08-22-payments-subscriptions.md`](../../.agents/plans/2026-08-22-payments-subscriptions.md).

1. [ ] `src/lib/ports/payment-provider.ts` — port + domain types, zero vendor
   imports; boundary test asserts no SDK/Next/Supabase import (D1)
2. [ ] `src/features/billing/lib/subscription-state.ts` — pure transition table
   with exhaustive tests, including every illegal transition (D10)
3. [ ] Migration: `subscriptions`, `payment_events`, `payment_transactions`,
   `accounts.billing_mode`, `accounts.grace_until`, `plans.provider_refs`; RLS
   read-only for members, no write policies (data model, F9)
4. [ ] `process_payment_event(...)` RPC — event claim + subscription + `plan_id`
   + ledger + audit in **one** transaction (the route makes no second write),
   with subscription reconstruction from `checkout_intents`, the `last_event_at`
   monotonic guard and the `manual` short-circuit (D11, D12, D15, D16)
5. [ ] Razorpay adapter: `createCheckout`, `verifyAndParse` (raw body,
   constant-time compare, parse-after-verify, **no timestamp window**), the total
   provider→domain lifecycle mapping that throws on unmapped states,
   `fetchSubscription`, `cancelAtPeriodEnd` (D2, D10, F2)
6. [ ] `NoopPaymentProvider` + factory from `PAYMENTS_PROVIDER`; env getters and
   both `.env.*.example` manifests updated so `--contract` passes (D3, F8)
7. [ ] `POST /api/billing/checkout` — owner-only, rate-limited, server-priced,
   rejects client amounts (D5, F1, F4)
8. [ ] `POST /api/webhooks/payments/[provider]` — verify → claim → transition →
   apply; `5xx` on claim failure so the provider retries (D11)
9. [ ] `/api/cron/billing-reconcile` — `cronSecret()`, cursor-based, bounded per
   run; also expires `grace_until` (D13, D14)
10. [ ] Settings → Plan & usage: current tier, subscription status, grace-period
    warning, upgrade/cancel actions, invoice list from the ledger (reuses
    `getAccountUsageSummary`)
11. [ ] Tests: forged redirect grants nothing; duplicate event applies once;
    out-of-order event ignored with a reason; `unlimited_all` survives a
    downgrade event; `manual` account is never auto-downgraded; downgrade
    deletes no data; missing webhook secret rejects (F1–F10)
12. [ ] Update `.agents/context/` (security.md money-handling rules, lld.md
    billing module), add ADR-009 to `docs/README.md`, then `pnpm docs:sync` and
    `pnpm check`

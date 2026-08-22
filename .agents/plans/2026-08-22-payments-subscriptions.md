# Payments & Subscription Billing — Implementation Plan (ADR-009)

> **For agentic workers:** REQUIRED SUB-SKILL — use `in-repo-executing-plans`
> (inline) or `in-repo-subagent-driven-development` and implement task-by-task,
> committing per task. All schema work follows `in-repo-supabase` (imperative
> idempotent migrations, RLS checklist, explicit Data API posture). Before
> starting the red-team tasks (12–14) load `in-repo-fp-check` for verdicts and
> `in-repo-insecure-defaults` for the fail-open sweep.

**Goal:** implement ADR-009 — self-serve subscription payments where a *verified
webhook*, never a browser redirect, is the only thing that can change
`accounts.plan_id`; money state is append-only; and a total payment outage
cannot touch message delivery.

**Source of truth:** [`docs/adr/009-payments-and-subscription-billing.md`](../../docs/adr/009-payments-and-subscription-billing.md).
Decision ids (`D1`–`D17`) and security rules (`F1`–`F10`) below refer to it. If
implementation reality contradicts a decision, **update the ADR in the same PR**
— do not silently diverge.

---

## Relationship to the existing invoices plan (read this first)

`.agents/plans/2026-07-26-phase1-invoices.md` already plans a Razorpay
integration — for **one-off GST invoices via payment links**. Neither that plan
nor its tables are built yet (`src/features/invoices` and `src/app/api/webhooks`
do not exist). This plan covers **recurring subscriptions**, which is a
different lifecycle. Overlap must be resolved deliberately, not by duplication:

| Concern | Decision for this plan |
| --- | --- |
| Razorpay HTTP client + signature verification | **Shared.** Build it here as the adapter's internals (`src/features/billing/lib/razorpay/*`). Whichever plan lands first owns the client; the second imports it. |
| Webhook route | **Separate routes, one verifier.** Invoices consume `payment_link.*`; subscriptions consume `subscription.*`/`payment.*`. A single fat route branching on event type is how one team's bug takes down the other's revenue. |
| Webhook event dedupe table | **Separate.** `payment_events` (this plan) vs `razorpay_webhook_events` (invoices plan). Both use the proven `INSERT … ON CONFLICT DO NOTHING` claim from `20260822130000_webhook_event_dedupe.sql`. |
| Money units | **Shared rule:** integer minor units + adjacent currency, always (`D7`). |
| Outbox | **Not required here.** Subscription webhooks apply in one transaction (`D15`) and the reconciliation cron (`D14`) repairs anything lost. Do not block this plan on `outbox_jobs`. |

If the invoices plan ships first, Task 5 shrinks to "extend the existing client".

---

## Global constraints

- **Tenancy column is `account_id`**, never `workspace_id`. Every money table,
  every query, every RLS policy (`F9`).
- **All money is `INTEGER` minor units (paise) with an adjacent `currency TEXT`.**
  No floats, no `NUMERIC` in JS, no amount without its currency (`D7`). Matches
  the existing `plans.price_monthly` convention.
- **The server is the only price authority.** Request bodies carry
  `{ planId, interval }` and nothing else (`D5`, `F1`).
- **No vendor SDK types outside the adapter** (`D1`) — enforced by
  `pnpm check:boundaries` plus an explicit import test.
- **Secrets resolve only through `src/lib/env.ts`** as optional getters; unset ⇒
  `NoopPaymentProvider` and the surface fails closed (`D3`, `F8`).
- **`/api/webhooks/` is already an unauthenticated public prefix** in
  `src/middleware.ts:21`. There is no session, no CSRF token, and no other gate
  on that path — **the signature check is the entire perimeter** (`F2`). A route
  file placed there with a missing or skipped verification step is publicly
  callable by anyone on the internet.
- **Cron auth reuses the existing pattern:** `authorizeCronRequest` from
  `src/features/flows/lib/cron-auth.ts` with `cronAuthEnv()` from
  `src/lib/env.ts`. (ADR-009 cites `src/lib/routes/cron-auth.ts`; that path does
  not exist — the flows module is correct. Fixed in Task 15.)
- **Existing infra to reuse, not rebuild:** `checkRateLimit`/`RATE_LIMITS`
  (`src/lib/rate-limit.ts`), `logAuditEvent` (`src/lib/audit-events.ts`),
  `formatCurrencyPrecise` (`src/lib/currency.ts`), `getAccountUsageSummary`
  (`src/lib/quotas/index.ts`), `requireSuperAdmin()` for any admin surface.
- **Every payment journey has a local identity before the provider sees it.**
  A `checkout_intents` row is written **first**; the provider is called second.
  Never depend on the checkout HTTP request surviving long enough to persist the
  `provider_ref → account_id` mapping (Task 1.2, Task 7).
- **Event ordering has a strict hierarchy** — do not collapse it into "trust the
  timestamp":
  | Signal | Role |
  | --- | --- |
  | `(provider, environment, provider event id)` | **identity** (the idempotency claim, and the whole replay defense) |
  | provider resource state/version | **authoritative** where the provider exposes it |
  | provider event timestamp | ordering **hint** only |
  | `subscriptions.last_event_at` | defensive **monotonic guard** |
  Ordering semantics that vary by provider live **inside the adapter**, not in the
  RPC. Stripe (`D2`, second adapter) does not behave identically to Razorpay.
- **No replay window on a validly signed webhook** (Task 5.1). Razorpay retries
  failed deliveries for up to 24 hours, so "reject events older than N minutes"
  drops real payments while blocking nothing an attacker could send anyway. The
  event-id claim is the replay defense. Freshness rules, where a provider signs a
  timestamp, belong to that provider's adapter.
- **Every provider identifier is unique only within `(provider, environment)`.**
  Provider refs and provider event ids are never globally unique on their own —
  every uniqueness constraint on one is a three-column constraint, and internal
  foreign keys point at our own surrogate `UUID`s (`Task 1`).
- **Provider vocabulary never becomes domain vocabulary.** Provider lifecycle
  states are mapped to our status enum by an explicit, total table in the adapter
  (Task 5.3d) that throws on anything unmapped.
- **No unsupported provider API surface may be invented.** If this plan implies a
  provider header, parameter, or behaviour, verify it against that provider's
  current documentation before sending it; declare the gap as a capability flag
  rather than guessing (Task 5.3a).
- **Financial event ≠ entitlement event.** A ledger row and an entitlement change
  are separate consequences. Money events (`charge`/`refund`/`chargeback`) write
  the ledger; **only the subscription/payment lifecycle state determines
  entitlement**. Do not hard-code "a chargeback never affects access" — a dispute
  may drive a provider lifecycle event of its own, and if it does, that event is
  what revokes access.
- **Quotas stay untouched.** `src/lib/quotas/index.ts` must not gain a single
  import from billing. Enforcement keeps reading `accounts.plan_id` and never
  learns that payments exist (`D15`).
- **Feature flag:** whole surface behind `PAYMENTS_PROVIDER`; absent ⇒ dormant.
  Default absent in production until Task 14 passes.
- Test-first wherever there is logic. `npx vitest run <file>` per task,
  `pnpm check` before the final task.

## File structure

```
supabase/migrations/2026MMDDHHMMSS_subscriptions_and_payments.sql  (T1)
supabase/migrations/2026MMDDHHMMSS_apply_subscription_state.sql    (T4)
src/lib/ports/payment-provider.ts                                 (T2)  zero vendor imports
src/lib/ports/payment-provider.test.ts                            (T2)  boundary test
src/features/billing/lib/subscription-state.ts + .test.ts          (T3)  pure, no I/O
src/features/billing/lib/checkout-intent.ts + .test.ts             (T7)  local intent, written first
src/features/billing/lib/apply-state.ts + .test.ts                 (T4)  RPC wrapper
src/features/billing/lib/reconciliation.ts + .test.ts              (T10) durable cursor
src/features/billing/lib/razorpay/client.ts                        (T5)
src/features/billing/lib/razorpay/verify.ts + .test.ts             (T5)  raw body HMAC
src/features/billing/lib/razorpay/adapter.ts + .test.ts            (T5)
src/features/billing/lib/provider-factory.ts + noop.ts + .test.ts   (T6)
src/app/api/billing/checkout/route.ts                             (T7)
src/app/api/billing/subscription/route.ts                         (T8)  status + cancel
src/app/api/webhooks/payments/[provider]/route.ts                 (T9)
src/app/api/cron/billing-reconcile/route.ts                       (T10)
src/features/billing/components/*                                 (T11)
src/app/(dashboard)/settings/billing/page.tsx                     (T11)
src/features/billing/lib/__tests__/attacks.test.ts                (T12) red-team suite
```

---

## Task 1 — Schema: subscriptions, events, ledger

**Files:** create `supabase/migrations/<ts>_subscriptions_and_payments.sql`

Additive only; no existing column is changed (ADR-009 data model).

- [ ] **1.1** `subscriptions`: `id`, `account_id → accounts`, `plan_id → plans`,
  `provider TEXT`, `environment TEXT NOT NULL CHECK (environment IN
  ('test','live'))`, `provider_ref TEXT`, `status TEXT`, `interval TEXT`,
  `amount_minor INTEGER`, `currency TEXT`, `current_period_end TIMESTAMPTZ`,
  `cancel_at_period_end BOOLEAN DEFAULT false`, `last_event_at TIMESTAMPTZ`,
  timestamps.
  - `UNIQUE (provider, environment, provider_ref)` — the mapping that resolves
    tenant from event (`F3`). **`(provider, provider_ref)` alone is wrong:** a
    provider reference is only unique *within* one provider's one environment, so
    a two-provider or test/live deployment can collide on it. Every
    provider-reference uniqueness constraint in this plan is a three-column
    constraint for that reason.
  - `CREATE UNIQUE INDEX … ON subscriptions (account_id) WHERE status IN
    ('active','past_due')` — **one live subscription per account**, enforced by
    the database, not by application care (kills attack A7).
  - `CHECK (amount_minor >= 0)`, `CHECK (status IN (…))` matching the `D10` enum.
  - `checkout_intent_id UUID UNIQUE REFERENCES checkout_intents(id)` — every
    subscription traces back to a local intent (see 1.2).
  - **Comment the partial unique index as a business rule, not a billing law:**
    *"One live self-serve subscription per account is a V1 invariant (ADR-008/D1,
    no seats). Provider migration or scheduled plan changes would need this
    relaxed."* Keep it for V1 — but do not let a future reader think it is
    universally true.
- [ ] **1.2** `checkout_intents` — **the local identity of a payment journey,
  created before the provider is called.** This closes the plan's most serious
  failure mode: provider creates a real subscription → our process crashes → the
  `INSERT` never runs → the webhook arrives and `provider_ref` resolves to no
  account, so a paying customer is unresolvable.
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `account_id → accounts`,
    `plan_id → plans`, `interval TEXT`, `provider TEXT`,
    `environment TEXT NOT NULL CHECK (environment IN ('test','live'))`,
    `amount_minor INTEGER NOT NULL`, `currency TEXT NOT NULL` (the
    server-resolved price, frozen at intent time — the audit trail for `F1`),
    `status TEXT CHECK (status IN ('created','provider_attached','completed','abandoned','failed'))`,
    `provider_ref TEXT`, `provider_customer_ref TEXT`, `created_by → auth.users`,
    timestamps.
  - `UNIQUE (provider, environment, provider_ref)` where `provider_ref IS NOT
    NULL` — the second half of the tenant-resolution mapping (`F3`). A webhook
    that cannot match `subscriptions.provider_ref` **must** still be resolvable
    here.
  - `id` doubles as the provider idempotency key input (Task 5.3), so uniqueness
    is ours and explicit, not derived from a coarse hash.
- [ ] **1.3** `billing_reconciliation_state` — durable cursor for Task 10.
  `provider TEXT PRIMARY KEY`, `cursor TEXT`, `last_run_at`,
  `last_status TEXT`, `orphans_seen INTEGER DEFAULT 0`. Workers isolates are
  ephemeral: a cursor held in a module-level variable resets on every cold start,
  so the cron would re-scan from the beginning forever and never reach the tail.
- [ ] **1.4** `payment_events`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
  `provider TEXT NOT NULL`, `environment TEXT NOT NULL`, `event_id TEXT NOT NULL`
  (the provider's id), `provider_event_type TEXT`, `subscription_id NULL`,
  `account_id NULL`, `kind`, `status TEXT CHECK (status IN
  ('applied','ignored','failed'))`, `ignored_reason TEXT`, `event_at`,
  `received_at DEFAULT now()`, `payload_digest TEXT`.
  - **`UNIQUE (provider, environment, event_id)` is the idempotency claim**, and
    the surrogate `id UUID` is the row identity every foreign key points at.
    `event_id TEXT PRIMARY KEY` would be wrong the moment a second provider or a
    second environment exists: provider event ids are namespaced *by* the
    provider, and Razorpay test-mode and live-mode ids come from different
    id spaces with no cross-guarantee. The uniqueness that matters is the triple.
  - **This unique triple is also the entire replay defense** (see Task 5.1): a
    redelivered or replayed event loses the claim and is never applied twice, and
    that holds no matter how old the delivery is.
  - **Digest only — never the raw payload** (`F7`).
  - `environment TEXT NOT NULL CHECK (environment IN ('test','live'))` — an
    **explicit stored column**, not something an adapter infers later. Attack A11
    (point our webhook at the provider's test mode and pay ₹1) is only defensible
    if the environment is a first-class field the RPC can reject on.
  - `provider_event_type TEXT` — the raw provider type alongside the normalised
    `kind`, so forensics can tell "we mapped it wrong" from "they sent something
    new".
- [ ] **1.5** `payment_transactions` (append-only ledger, `D8`):
  `id`, `account_id`, `subscription_id`, `provider TEXT NOT NULL`,
  `environment TEXT NOT NULL`, `kind TEXT CHECK (kind IN
  ('charge','refund','chargeback'))`, `amount_minor INTEGER` (**signed**),
  `currency`, `provider_ref TEXT`,
  `payment_event_id UUID REFERENCES payment_events(id)`, `occurred_at`,
  `created_at`.
  - `UNIQUE (provider, environment, provider_ref)`, not `provider_ref UNIQUE` —
    same reasoning as 1.1.
  - The ledger references `payment_events.id` (the surrogate), **never** the
    provider's `event_id` string. Internal foreign keys must not be provider
    identifiers.
  - Trigger `payment_transactions_append_only`: `BEFORE UPDATE OR DELETE …
    RAISE EXCEPTION`. Append-only is worthless if it is only a comment.
  - `CHECK (kind = 'charge' AND amount_minor >= 0 OR kind <> 'charge' AND
    amount_minor <= 0)` — sign discipline at the schema level.
- [ ] **1.6** `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS billing_mode TEXT
  NOT NULL DEFAULT 'self_serve' CHECK (billing_mode IN ('self_serve','manual'))`
  (`D16`) and `grace_until TIMESTAMPTZ` (`D13`).
- [ ] **1.7** `ALTER TABLE plans ADD COLUMN IF NOT EXISTS provider_refs JSONB
  NOT NULL DEFAULT '{}'::jsonb` — our tier id → provider plan id, per provider.
- [ ] **1.8** RLS on **all five** new tables: `ENABLE ROW LEVEL SECURITY`;
  **`SELECT` only**, `TO authenticated`, predicate `is_account_member(account_id)`.
  **No `INSERT`/`UPDATE`/`DELETE` policies at all** — every write is
  service-role through the Task 4 RPC, matching the `plans` model.
  `payment_events` and `billing_reconciliation_state` get **no member-readable
  policy** (internal forensics / operational state, and the latter has no
  `account_id` to scope by).
- [ ] **1.9** Apply with `pnpm db:push`, then `pnpm db:doc`, then `pnpm docs:sync`.

**Verify:** as an authenticated member of account B, `select * from
subscriptions` returns zero rows for account A; any `insert` fails; `update` on
`payment_transactions` raises.

## Task 2 — The port (`D1`)

**Files:** create `src/lib/ports/payment-provider.ts`, `…test.ts`

- [ ] **2.1** Domain types with **no provider vocabulary**: `CheckoutIntent`
  (`intentId`, `accountId`, `planId`, `interval`, `amountMinor`, `currency`),
  `CheckoutHandle`, `ProviderSubscription`, `RawWebhook` (`rawBody: string`,
  `headers`), and `PaymentEvent` — normalised as:
  | Field | Why |
  | --- | --- |
  | `kind` | our vocabulary, never the provider's |
  | `eventId` | identity / idempotency claim |
  | `providerRef`, `customerRef?`, `subscriptionRef?`, `invoiceRef?` | tenant resolution needs more than one hook when a subscription row is missing |
  | `occurredAt` | ordering **hint** (see global constraints) |
  | `resourceStatus?`, `resourceVersion?` | the provider's own authoritative state where exposed — preferred over the timestamp |
  | `amountMinor`, `currency` | always together (`D7`) |
  | `environment: 'test' \| 'live'` | first-class, not inferred (A11) |
  | `providerEventType` | raw type, for forensics |
  The `idempotencyKey` sent *to* the provider is derived from `intentId`
  (Task 5.3), so it is not a separate free-form field on the intent.
- [ ] **2.2** `PaymentProvider` interface exactly as ADR-009/D1.
  `verifyAndParse` **throws** on bad signature — no `{ ok: false }` that a caller
  can forget to check.
- [ ] **2.3** Boundary test, modelled on the `message-ingress.ts` convention:
  read the port source and assert it imports nothing from `next`, `@supabase/*`,
  `razorpay`, or `stripe`.

**Verify:** `npx vitest run src/lib/ports/payment-provider.test.ts` and
`pnpm check:boundaries`.

## Task 3 — Pure state machine (`D10`)

**Files:** create `src/features/billing/lib/subscription-state.ts`, `…test.ts`

- [ ] **3.1** `transition(current: Status, event: EventKind): Status | 'illegal'`
  as a total, explicit table. Zero I/O, zero imports from the app.
- [ ] **3.2** Encode the ADR diagram: `incomplete→active`, `active→past_due`,
  `past_due→active`, `past_due→canceled` (grace expiry), `active→canceled`,
  `canceled→expired`, `incomplete→expired` (abandoned).
- [ ] **3.3** Exhaustive test: iterate **every** (status × event) pair and assert
  the result is either the documented target or `'illegal'`. This is the cheapest
  exhaustive test in the codebase — a switch that silently falls through here is
  how an `expired` subscription becomes `active` for free.
- [ ] **3.4** Explicit cases: `expired + activated = illegal` (A9),
  `canceled + charged = illegal`.
- [ ] **3.5** **Split the event vocabulary in two** and make the split visible in
  the type, so nobody has to remember it:
  - *Money events* — `charged`, `refunded`, `charged_back`. These write the
    ledger. `transition()` returns the **current status unchanged** for a refund:
    a refund is not a cancellation, and support issuing a goodwill refund must not
    silently delete a customer's access.
  - *Lifecycle events* — `activated`, `payment_failed`, `cancel_scheduled`,
    `canceled`, `expired`. **Only these move status**, and therefore only these
    change entitlement.
  - A dispute/chargeback therefore does two independent things: it always writes a
    negative ledger row, and it revokes access **only if** the provider also emits
    a lifecycle event (e.g. subscription halted). Assert both halves separately in
    the tests — do not encode "chargeback never affects access" as a rule.

**Verify:** `npx vitest run src/features/billing/lib/subscription-state.test.ts`

## Task 4 — `apply_subscription_state` RPC (`D12`, `D15`, `D16`)

**Files:** create `supabase/migrations/<ts>_apply_subscription_state.sql`,
`src/features/billing/lib/apply-state.ts`, `…test.ts`

One transaction, or nothing. This function is the only writer of billing state.

- [ ] **4.1** `CREATE OR REPLACE FUNCTION apply_subscription_state(...) RETURNS
  jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`.
  **`SECURITY DEFINER` must be written explicitly** — `CREATE OR REPLACE` does
  not inherit it and Postgres silently downgrades to INVOKER (`AGENTS.md`;
  `scripts/push-supabase-schema.mjs` enforces this).
- [ ] **4.1a** Harden it as the privileged function it is. `SET search_path` is
  necessary but **not sufficient** — a definer function is the one place where a
  resolution surprise executes with elevated rights:
  - **Schema-qualify every object it touches**: `public.subscriptions`,
    `public.accounts`, `public.plans`, `public.payment_events`,
    `public.payment_transactions`, `public.checkout_intents`,
    `public.audit_events`. No bare table names anywhere in the body.
  - **Control `EXECUTE` explicitly**, because Postgres grants it to `PUBLIC` by
    default: `REVOKE EXECUTE ON FUNCTION public.apply_subscription_state(...)
    FROM PUBLIC;` then `GRANT EXECUTE … TO service_role;` and **nothing else**.
    An `authenticated` role able to call this function can grant itself any plan
    — this single `REVOKE` is load-bearing.
  - Record both in the RLS/security checklist so a later `CREATE OR REPLACE`
    (which resets neither) is caught.
- [ ] **4.2** Order of operations inside the transaction:
  1. `SELECT … FOR UPDATE` the subscription row (serialises concurrent
     deliveries of the same subscription — kills the A6 race).
  2. **Environment gate:** if the event's `environment` does not match the
     deployment's configured mode, record `ignored_reason='wrong_environment'`
     and return. A test-mode event must never move a live tenant's plan (A11).
  3. **Monotonic guard (defensive, not authoritative):** if
     `event_at <= last_event_at`, record `ignored_reason='stale_event'` and return
     without touching state (`D12`). This is a **backstop**, not the ordering
     mechanism — where the adapter supplied `resourceStatus`/`resourceVersion`,
     prefer it, and let the adapter own any provider-specific ordering quirk. Do
     not add provider `if`-branches to this function.
  4. **Manual short-circuit:** if `accounts.billing_mode = 'manual'`, record
     `ignored_reason='manual_billing'` and return — do not apply (`D16`).
  5. Compute the transition; `'illegal'` ⇒ `ignored_reason='illegal_transition'`.
  6. Write the ledger row if the event carries money (this happens **whether or
     not** status moves — money and entitlement are separate consequences, see
     global constraints).
  7. If it is a *lifecycle* event: write `subscriptions` (status, period end,
     `last_event_at`), set `accounts.plan_id`, clear or set `grace_until`.
  8. Insert the audit event, and mark the `checkout_intents` row `completed` on
     first activation.
- [ ] **4.3** `plan_id` is resolved **from our `plans` table** by matching
  `provider_refs`, never from a plan id in the payload (`F3`).
- [ ] **4.4** Never touch `account_limit_overrides` (`F5`).
- [ ] **4.5** Thin TS wrapper in `apply-state.ts`; on any DB error it **throws**
  so the route can return `5xx` and the provider retries (`D11`).

**Verify:** integration test — two concurrent calls with the same `event_id`
produce exactly one ledger row; a call with an older `event_at` is recorded
`ignored`.

## Task 5 — Razorpay adapter (`D2`, `F2`)

**Files:** create `src/features/billing/lib/razorpay/{client,verify,adapter}.ts` + tests

- [ ] **5.1** `verify.ts` — exactly these steps, in this order:
  1. Read the **raw body string** (`await request.text()` **before** any parse; a
     re-serialised object has different bytes and will never match).
  2. HMAC-SHA256 over the raw body with the webhook secret.
  3. `crypto.timingSafeEqual` on equal-length buffers.
  4. Parse **only after** the signature verifies.
  5. Deduplicate on `(provider, environment, event_id)` (Task 1.4, Task 9.3).
  6. **No timestamp/replay window. Do not reject a validly signed event for being
     old.**

  Missing secret ⇒ **throw**, never "skip" (`F2`).

  **Why the replay window is removed (corrects the earlier draft and `F2`).**
  Razorpay's webhook signature is an HMAC-SHA256 over the raw request body with
  the webhook secret; there is no documented signed-timestamp header to anchor a
  freshness check on, and Razorpay retries failed deliveries with exponential
  backoff **for up to 24 hours**. An "older than N minutes ⇒ reject" rule
  therefore does not raise the bar for an attacker (who cannot forge a signature
  at any age) and *does* discard legitimate retries — i.e. it throws away money.
  The `UNIQUE (provider, environment, event_id)` claim is the replay defense, and
  it is a complete one. If a future provider ships a signed timestamp in the
  signature base string, that provider's **adapter** may enforce freshness;
  replay semantics are adapter-local, never a shared rule in `verify.ts`.
- [ ] **5.2** `client.ts` — `fetch`-based, no SDK. Basic auth from env. Explicit
  timeout via `AbortSignal.timeout` (Workers has no patience for a hung
  subrequest, ADR-INFRA-001).
- [ ] **5.3** `adapter.ts` — implements the port. **`checkout_intents.id` is the
  Auxelon idempotency identity for a payment journey.** It replaces the earlier
  `hash(account_id, plan_id, interval, day)` key, which collides across two
  *legitimate* attempts (customer abandons the page, retries an hour later) and
  would make the provider replay the first response instead of creating the new
  checkout. Because the id is ours, the uniqueness is enforceable in our own
  database.
- [ ] **5.3a** **Provider idempotency is capability-driven, not assumed.**
  - If the selected provider **documents** an idempotency mechanism for
    subscription creation, the adapter transmits `hash(provider, intent.id)`
    **using that documented mechanism**.
  - Otherwise the adapter **MUST NOT invent an unsupported header.** Razorpay's
    Create Subscription API does not document an `Idempotency-Key` header (they
    document explicit idempotency for other APIs, such as refunds and payouts —
    that does not extend to `POST /v1/subscriptions`). Do not send one to
    Razorpay on the strength of this plan; **verify against the provider's own
    current documentation before adding any idempotency header.**
  - Express this in the port as a declared capability
    (`supportsCreateIdempotency: boolean`) so the absence of a header is a stated
    fact about the provider, not an oversight in the adapter.
  - **Where the provider offers no idempotency guarantee, our reconciliation is
    the safety net:** an ambiguous or timed-out create response is resolved by
    looking the resource up by `provider_ref` and by the intent
    (`checkout_intents`), never by blindly retrying the create. `database +
    provider_ref` reconciliation is the source of truth for ambiguity.
- [ ] **5.3b** `verifyAndParse` sets `environment` from the credential set that
  verified the signature — **never** from a field in the payload. Provider-specific
  ordering signals (`resourceStatus`/`resourceVersion`) are also mapped here; this
  is the only layer allowed to know how Razorpay orders things.
- [ ] **5.3c** `verifyAndParse` maps provider event names to domain kinds and
  **throws on unknown types** rather than defaulting to something harmless.
- [ ] **5.3d** **Explicit provider → domain lifecycle mapping table, inside the
  adapter.** Task 3's status enum is *our* vocabulary; Razorpay's subscription
  lifecycle is a different, larger set (`created`, `authenticated`, `active`,
  `pending`, `halted`, `cancelled`, `completed`, `expired`, `paused`/`resumed`,
  plus events like `subscription.charged`). Provider lifecycle ≠ domain
  lifecycle, and the anti-corruption layer (`D1`) is where the translation
  belongs. Start from this table and **confirm each starred row against product
  semantics** before implementing — do not copy a provider state straight into an
  entitlement decision:

  | Razorpay state/event | Auxelon status | Note |
  | --- | --- | --- |
  | `created` | `incomplete` | mandate not yet authenticated |
  | `authenticated` | `incomplete` \* | mandate approved, first debit may not have settled — decide whether authentication alone grants access |
  | `active` | `active` | |
  | `subscription.charged` | *(no status move)* | money event → ledger only |
  | `pending` | `past_due` | debit failed, provider still retrying |
  | `halted` | `past_due` \* | provider gave up retrying; decide grace vs. immediate `canceled` |
  | `cancelled` | `canceled` | |
  | `completed` | `expired` \* | ran its full term — terminal, not a failure |
  | `expired` | `expired` | |
  | `paused` / `resumed` | out of scope for V1 | reject as unknown (5.3c) until deliberately supported |

  Encode this as a total lookup that **throws on an unmapped provider state**, and
  unit-test every row. A `default:` branch here silently invents entitlement.
- [ ] **5.4** Tests with fixture payloads: valid signature passes; single-byte
  mutation fails; absent secret fails; **a validly signed event with an old
  timestamp still passes verification** (the removed replay window, 5.1) and is
  stopped instead by the dedupe claim when it is a genuine duplicate.

**Verify:** `npx vitest run src/features/billing/lib/razorpay/`

## Task 6 — Factory + Null Object (`D3`, `F8`)

**Files:** create `provider-factory.ts`, `noop.ts`, `…test.ts`; edit `src/lib/env.ts`,
`.env.*.example`

- [ ] **6.1** Optional getters: `paymentsProvider()`, `razorpayKeyId()`,
  `razorpayKeySecret()`, `razorpayWebhookSecret()` — same optional-getter shape
  as the existing `cronAuthEnv()`.
- [ ] **6.2** `getPaymentProvider()` returns the Razorpay adapter **only** when
  provider id *and* all three credentials are present; otherwise
  `NoopPaymentProvider` (`createCheckout` throws `PaymentsUnavailableError`,
  `verifyAndParse` throws, `fetchSubscription` throws).
- [ ] **6.3** Add the new names to **both** `.env.*.example` manifests so
  `node scripts/check-env-completeness.mjs --contract` stays green.
- [ ] **6.4** Test the partial-config case explicitly: key present, webhook
  secret absent ⇒ **Noop**, not a half-live provider that creates orders it can
  never verify (attack A2).

## Task 7 — `POST /api/billing/checkout` (`D5`, `F1`, `F4`)

- [ ] **7.1** Auth: session + `requirePermission` **owner** re-checked
  server-side. Never infer authority from route placement.
- [ ] **7.2** `checkRateLimit` with a new `RATE_LIMITS.BILLING_CHECKOUT` entry,
  keyed on `account_id` (not IP).
- [ ] **7.3** **Strict body schema**: exactly `{ planId, interval }`. Any extra
  key — especially `amount`, `currency`, `quantity`, `discount`, `plan_price` —
  is a `400 unexpected_field`, logged as suspicious (`F1`). Reject, do not strip:
  stripping hides the attempt.
- [ ] **7.4** Load the plan server-side; reject if `is_active = false`, if the
  interval's price is `NULL` ("contact us"), or if `provider_refs` lacks the
  active provider.
- [ ] **7.5** Provider unavailable ⇒ `503 payments_unavailable`.
- [ ] **7.6** **Intent-first ordering** (`src/features/billing/lib/checkout-intent.ts`).
  This replaces the earlier "call the provider, then insert" sequence, which had a
  crash window that could orphan a real paid subscription:
  1. Insert `checkout_intents` with the **server-resolved** `amount_minor` and
     `currency`, `status='created'`. We now own the journey.
  2. Call the provider with `idempotencyKey = hash(provider, intent.id)`.
  3. On success, `UPDATE` the intent with `provider_ref` /
     `provider_customer_ref`, `status='provider_attached'`. Only now insert
     `subscriptions` as `incomplete`, linked by `checkout_intent_id`.
  4. On provider failure, mark the intent `failed` — a dead intent row is
     harmless; an unresolvable paying customer is not.
  - The failure this defends: provider creates the subscription → our process
    dies before step 3 → the webhook arrives with a `provider_ref` that matches
    no `subscriptions` row. With intent-first, the webhook falls back to
    `checkout_intents (provider, provider_ref)` and still resolves the tenant.
    Without it, a real customer has paid and we cannot tell who they are.
  - The step-3 write is idempotent (`UNIQUE (provider, provider_ref)`), so the
    provider retrying or the user double-submitting cannot fork the journey.
- [ ] **7.7** Response contains the provider handle and **no amount echoed from
  input** — only the server-resolved amount.
- [ ] **7.8** Abandoned intents (`created`/`provider_attached`, older than 24 h,
  never completed) are swept to `abandoned` by the Task 10 cron. They are
  evidence, not garbage — keep the rows.

## Task 8 — `GET/DELETE /api/billing/subscription` (`F10`)

- [ ] **8.1** `GET`: current subscription + ledger history for
  `context.accountId` only (`F9`). Poll target for the return page (`D9`).
- [ ] **8.2** `DELETE`: owner-only; sets `cancel_at_period_end` via the provider,
  then applies through the same RPC. Reversible until period end; **no immediate
  data loss**.
- [ ] **8.3** Cancelling someone else's subscription by passing an id is
  impossible: the handler ignores any client-supplied subscription id and
  resolves from the session's `accountId` (attack A5).

## Task 9 — `POST /api/webhooks/payments/[provider]` (`D9`, `D11`)

The only endpoint that can change entitlement. Treat every byte as hostile.

- [ ] **9.1** Read `await request.text()` first. Cap body size; reject oversized.
- [ ] **9.2** `verifyAndParse` → on throw, `401`, log `event_id`-less rejection,
  **record nothing** and alert on a burst.
- [ ] **9.3** Claim: `INSERT INTO payment_events … ON CONFLICT (provider,
  environment, event_id) DO NOTHING`. Zero rows ⇒ duplicate ⇒
  `200 already_processed`, no re-apply. This claim — not a timestamp window
  (5.1) — is what makes replay harmless, including a 20-hour-old provider retry.
  **Claim insert error ⇒ `5xx`** so the provider retries — fails *closed*, the
  deliberate inverse of `IngressDedupeStore.claim()` (`D11`). Say so in a comment
  at the call site; the next reader will otherwise "fix" it to match ingress.
- [ ] **9.4** Resolve tenant **from our own mapping only**, in this order:
  `subscriptions.provider_ref` → `checkout_intents.provider_ref` (the crash-window
  fallback from 7.6). If neither matches, record the event as `failed` with
  `ignored_reason='unresolved_tenant'` and **alert** — never guess. If the payload
  carries `metadata.account_id` and it disagrees with the mapping, apply nothing
  and alert: a payload field is evidence of intent, never authority (`F3`,
  attack A4).
- [ ] **9.5** Call `applySubscriptionState`; return `200` on applied/ignored,
  `5xx` only on genuine failure.
- [ ] **9.6** Unknown provider in `[provider]` ⇒ `404`. Provider not configured
  ⇒ `404` (not `503` — an unconfigured webhook endpoint should not confirm it
  exists). **But `404` externally must not mean invisible internally:** emit a
  metric/alert when *real provider traffic* reaches an unconfigured endpoint.
  Otherwise someone wires live Razorpay at an environment where
  `PAYMENTS_PROVIDER` is unset and we silently discard paid customers' events
  with a clean-looking `404` and no signal that money is being dropped.
- [ ] **9.7** Log `event_id`, `account_id`, `status`, `ignored_reason`. **Never**
  the payload (`F7`).

## Task 10 — `/api/cron/billing-reconcile` (`D13`, `D14`)

- [ ] **10.1** `authorizeCronRequest` + `cronAuthEnv()`, same as
  `/api/flows/cron`.
- [ ] **10.2** Page through non-terminal subscriptions with a **cursor and a hard
  per-run cap** (≤ 20 provider calls) — Workers allows 50 subrequests and 10 ms
  CPU per invocation. An unbounded reconcile loop reconciles nothing.
- [ ] **10.3** For each: `fetchSubscription`, then apply drift through the same
  RPC with a synthetic `event_id` (`reconcile:<ref>:<date>`) so reconciliation is
  itself idempotent.
- [ ] **10.4** Expire grace: `past_due` with `grace_until < now()` ⇒ move to the
  `is_default` plan. **Delete no data** (`D13`).
- [ ] **10.5** Skip `billing_mode = 'manual'` accounts entirely (`D16`).
- [ ] **10.6** **Surface orphans explicitly; never adopt them.** When the provider
  reports a subscription as active and *neither* a `subscriptions` row *nor* a
  `checkout_intents` row matches its `(provider, environment, provider_ref)`,
  record the outcome as `ORPHAN_PROVIDER_SUBSCRIPTION`, increment
  `billing_reconciliation_state.orphans_seen`, and **alert**. Do **not**
  auto-create a tenant mapping from an unknown provider resource — that is a
  tenant assignment invented from external data, exactly what `F3` forbids. An
  orphan is a human-resolved incident (a real customer we cannot identify), and
  it must be loud rather than quietly healed into the wrong account.

## Task 11 — Settings → Plan & usage UI

- [ ] **11.1** Server component reads plan + subscription + `getAccountUsageSummary`.
- [ ] **11.2** States: no subscription (upgrade), `incomplete` (awaiting
  confirmation, polls `GET`), `active`, `past_due` (grace warning with the date),
  `canceled` (access until period end).
- [ ] **11.3** Amounts rendered **only** via `formatCurrencyPrecise`.
- [ ] **11.4** Upgrade/cancel hidden for non-owners **and** rejected server-side.
- [ ] **11.5** Provider absent ⇒ "Contact us", no Upgrade button (`D3`).
- [ ] **11.6** Invoice/receipt list derived from the ledger.

---

## Task 12 — Red team: attack the payment service (`F1`–`F10`)

**Files:** create `src/features/billing/lib/__tests__/attacks.test.ts`

Adversarial, not confirmatory. Each attack below is a **named failing test that
must pass by defending**. Assume the attacker: has a valid session on their own
free workspace, can read all client-side code, can replay and craft HTTP
requests, knows the provider's public API and event shapes, and has a legitimate
paid account elsewhere. They do **not** have our webhook secret or DB access.

### Attack tree — entitlement escalation without paying

| # | Attack | Why it usually works | Defense | Test |
| --- | --- | --- | --- | --- |
| **A1** | POST checkout with `{planId:'enterprise', amount:100}` | Handler forwards a client amount to the provider | Strict schema rejects extra keys; price read from `plans` (`D5`,`F1`) | `rejects_client_supplied_amount` |
| **A2** | Configure key but not webhook secret, then forge events | "Verify only if secret is set" | Partial config ⇒ Noop; missing secret ⇒ throw (`D3`,`F2`) | `noop_when_partially_configured` |
| **A3** | Hit the return URL / call the success callback directly | Redirect grants entitlement | Redirect grants nothing; only webhook or cron applies (`D9`) | `forged_redirect_grants_nothing` |
| **A4** | Send a real event captured from their *own* paid account, with `metadata.account_id` swapped to their free workspace | Tenant taken from the payload | Tenant resolved from `subscriptions.provider_ref`; mismatch ⇒ alert, apply nothing (`F3`) | `payload_account_id_is_never_authority` |
| **A5** | `DELETE /api/billing/subscription` with another account's subscription id | Handler trusts the id | Id ignored; resolved from session `accountId` (`F9`) | `cannot_cancel_another_account` |
| **A6** | Replay the same `subscription.charged` 50× in parallel | Read-then-write race double-applies | `UNIQUE (provider, environment, event_id)` claim + `SELECT … FOR UPDATE` (`D11`) | `duplicate_event_applies_once` |
| **A7** | Two concurrent checkouts, two active subscriptions, one paid | Application-level uniqueness only | Partial unique index on `(account_id) WHERE status IN ('active','past_due')` | `one_live_subscription_per_account` |
| **A8** | Replay an old `activated` event after cancelling | Last-write-wins | Monotonic `last_event_at` guard (`D12`) | `stale_event_is_ignored` |
| **A9** | Force `expired → active` with a crafted sequence | Permissive switch/default branch | Total transition table; illegal ⇒ recorded, not applied (`D10`) | `illegal_transition_rejected` |
| **A10** | Valid signature, tampered body (amount raised) | HMAC computed over re-serialised JSON | HMAC over the **raw** body before parse (`F2`) | `mutated_body_fails_signature` |
| **A11** | Point our webhook at the provider's **test** environment and pay ₹1 | One secret, no environment tag | `provider` column + separate secrets per env; test-mode events rejected in prod | `test_mode_event_rejected_in_prod` |
| **A12** | Upgrade, then chargeback, keep access | Refund never revokes | Refund is a ledger row; entitlement follows the *subscription* event (`D8`) | `chargeback_recorded_not_ignored` |
| **A13** | Buy a plan that is `is_active = false` or price `NULL` (hidden/legacy tier) | Only the UI hides it | Server rejects inactive/unpriced plans (`D5`) | `inactive_plan_rejected` |
| **A14** | Downgrade an enterprise tenant with one forged/stale event | Payments own `plan_id` unconditionally | `billing_mode='manual'` short-circuit (`D16`) | `manual_account_never_auto_downgraded` |
| **A15** | Downgrade a tenant holding `unlimited_all` override | Plan overwrites overrides | Overrides always win; payments never write them (`F5`) | `override_survives_downgrade` |
| **A16** | Timing-attack the signature comparison | `===` on secrets | `timingSafeEqual` on equal-length buffers (`F2`) | `verify_uses_constant_time_comparison` |
| **A17** | Flood checkout to burn provider quota / spam the merchant account | No rate limit on money endpoints | `RATE_LIMITS.BILLING_CHECKOUT` per `account_id` (`F4`) | `checkout_is_rate_limited` |
| **A18** | Flood the webhook with garbage to exhaust the Workers CPU/request budget | Verification after parse | Verify before parse, body cap, `404` on unknown provider | `oversized_body_rejected` |
| **A19** | Read another tenant's amounts via the usage/billing API | Missing `account_id` filter | RLS `SELECT`-only + `accountId` scoping (`F9`) | `cross_tenant_ledger_read_blocked` |
| **A20** | Trigger a `5xx` mid-apply to leave `subscriptions.active` + `plan_id = free` (or the reverse) | Multi-statement write without a transaction | One RPC, one transaction, rollback on error (`D15`) | `partial_apply_rolls_back` |

- [ ] **12.1** Write A1–A20 as tests. A red-team test that has never failed is
  documentation, not a test: **make each one fail first** by temporarily
  reverting its defense, then restore.
- [ ] **12.1a** **A16 is an implementation assertion, not a statistical one.** Do
  not attempt to prove constant-time execution from Vitest timings — a JIT, a
  noisy CI runner, and GC make that test flaky at best and meaningless at worst.
  Assert instead that `verify.ts` compares via `crypto.timingSafeEqual` on
  equal-length buffers (source assertion, like the Task 2.3 boundary test) and
  that a length-mismatched or mutated signature is rejected. Timing behaviour is
  a property of the primitive we chose; the test's job is to prove we chose it.
- [ ] **12.2** Record which attacks are structurally impossible and why — A6
  (no seat quantity ⇒ no quantity tampering, `D6`), and A20's cross-service blast
  radius (messaging never reads billing tables, `D15`).

## Task 13 — Fail-open sweep + static analysis

- [ ] **13.1** Load `in-repo-insecure-defaults`. Grep the billing surface for
  every `catch`, `||`, `??`, and optional chain on a security decision. In
  billing, `catch → allow` is a vulnerability, even though the quota engine
  deliberately fails **open** (`src/lib/quotas/index.ts` header). Two modules,
  two opposite policies, both correct — comment the boundary at each site so a
  future reader does not "harmonise" them.
- [ ] **13.2** Confirm no `console.log` or logger call can receive a raw payload
  or an instrument identifier (`F7`).
- [ ] **13.3** Run `in-repo-semgrep` ("important only") over
  `src/features/billing`, `src/app/api/billing`, `src/app/api/webhooks`. Triage
  each finding with `in-repo-fp-check` and record a TRUE/FALSE POSITIVE verdict —
  do not silence anything without a written reason.
- [ ] **13.4** Verify the `SECURITY DEFINER` invariant holds after every
  migration re-run (`scripts/push-supabase-schema.mjs` should reject a downgrade).

## Task 14 — Go-live gate

- [ ] **14.1** `pnpm check` green (typecheck, lint, boundaries, docs, tests).
- [ ] **14.2** `pnpm build` green.
- [ ] **14.3** Provider **test** mode end-to-end: upgrade, renewal, failed
  payment → grace → recovery, cancel at period end, refund. Confirm each landed
  in `payment_events` with the expected `status`.
- [ ] **14.4** Kill switch rehearsed: unset `PAYMENTS_PROVIDER` in production and
  confirm the surface goes dormant, messaging is unaffected, and no paying
  tenant's `plan_id` changes.
- [ ] **14.5** Deliberately drop a webhook (block delivery), confirm the cron
  repairs the account within one run.
- [ ] **14.6** Live credentials set **last**, in production only, after 14.1–14.5.

## Task 15 — Docs

- [ ] **15.1** Fix ADR-009's cron-auth path reference to
  `src/features/flows/lib/cron-auth.ts` and note `/api/webhooks/` is already a
  public prefix (both discovered during this planning pass).
- [ ] **15.2** `.agents/context/security.md` — money-handling rules and the
  fail-closed-vs-fail-open boundary.
- [ ] **15.3** `.agents/context/lld.md` — billing module; `api-routes.md` — the
  four new routes with auth posture.
- [ ] **15.4** `pnpm db:doc`, `pnpm docs:sync`, `pnpm check:docs`.

---

## Definition of done

1. No path other than a verified webhook or the authenticated cron can change
   `accounts.plan_id`.
2. A1–A20 all pass, and each has been observed failing without its defense.
3. `src/lib/quotas/index.ts` has zero billing imports; deleting the billing
   feature would not break message delivery.
4. Every entitlement change is answerable from `payment_events` +
   `payment_transactions` + audit events, including the reason for every ignored
   event.
5. With `PAYMENTS_PROVIDER` unset, the app behaves exactly as it does today.

## Explicitly out of scope

India GST invoice-series compliance (legal dependency), multi-currency
localisation, usage-based overage billing (ADR-008/D4 keeps overage soft),
per-seat billing (never — ADR-008/D1), marketplace payouts, dunning beyond the
single grace warning (ADR-009/D17).

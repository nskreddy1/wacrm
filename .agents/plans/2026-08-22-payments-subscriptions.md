# Payments & Subscription Billing — Implementation Plan (ADR-009)

> **For agentic workers:** REQUIRED SUB-SKILL — use `in-repo-executing-plans`
> (inline) or `in-repo-subagent-driven-development` and implement task-by-task,
> committing per task. All schema work follows `in-repo-supabase` (imperative
> idempotent migrations, RLS checklist, explicit Data API posture). Before
> starting the red-team tasks (12–14) load `in-repo-fp-check` for verdicts and
> `in-repo-insecure-defaults` for the fail-open sweep.

**Goal:** implement ADR-009 — self-serve subscription payments where the **only
two paths that may change `accounts.plan_id` are (a) a signature-verified
provider webhook and (b) an authenticated reconciliation operation applying
provider-read state together with explicitly defined local billing-policy
transitions derived from that provider state**; money state is append-only; and a
total payment outage cannot touch message delivery.

**A browser redirect, a client request body, or any other client-influenced
input can never change entitlement — at any point, by any route.** State the rule
this way everywhere: "verified webhook only" is *wrong* as written, because the
`D14` reconciliation cron deliberately also applies provider-verified state. Both
paths share one property — the state originates from the provider and is verified
— and that property, not the transport, is the actual invariant.

**What "billing-policy transition" buys, and what it must not become.** The
reconciliation path needs a little more latitude than "copy the provider's
status", because some entitlement consequences are ours to define: the provider
says `past_due`, and *we* decide that a `grace_until` window then expires and the
account falls back to the default plan (Task 10.4). That transition is driven by
local time, not by a new provider read, so a strict "provider-read state only"
reading would make 10.4 illegal. The latitude is bounded on all sides:

```text
provider state (read back, authenticated)
        +
documented local billing policy (grace expiry, default-plan fallback)
        ↓
authenticated reconciliation operation
        ↓
accounts.plan_id
```

- There are still **exactly two execution paths**, and this is not a third one —
  it is what path (b) is permitted to compute.
- A policy transition must be **written down in this plan** (10.4 is the only one
  in scope) and must derive from a provider-read status the reconciliation run
  actually observed. "Local policy" is never a licence to move a plan for a
  reason the provider state does not support.
- Every such transition goes through the same `process_payment_event` RPC, the
  same audit row, and the same environment gate as a webhook. No side door.
- It may only ever move entitlement **down** to the default plan, never up: a
  local clock must not be able to grant a paid plan.

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
- **Two distinct trust boundaries — do not conflate them.** There are exactly two
  classes of billing table, and they have different writers:
  | Class | Tables | Writer | Trust |
  | --- | --- | --- | --- |
  | **Application-owned intent state** | `checkout_intents` (incl. its `status`), and any `cancel_request_*` columns | The authenticated owner's request path, directly | What the *user asked for* |
  | **Provider-derived billing state** | `payment_events`, `subscriptions`, `payment_transactions`, `accounts.plan_id` | `process_payment_event()` **only** | What the *provider confirmed* |
  So "the RPC is the only writer of billing state" means **provider-derived**
  state. An authenticated owner may freely record intent ("checkout started",
  "cancellation requested"); an authenticated owner may **never** move
  entitlement. Entitlement changes only on a signed webhook or a reconciliation
  read of the provider API. A request-path write that touches a
  provider-derived table is a review-blocking defect.
- **Event ordering has a strict hierarchy** — do not collapse it into "trust the
  timestamp":
  | Signal | Role |
  | --- | --- |
  | signed raw webhook body | **authenticated** event contents — the only cryptographically established data |
  | `(provider, environment, provider event id)` | provider-supplied event **identity** / duplicate-detection key — *not* authenticated |
  | `(provider, environment, provider_ref)` on `payment_transactions` | **effect** idempotency for money (key lives inside the signed body) |
  | `payload_digest` | **non-unique** forensic / replay-correlation signal |
  | provider resource state/version | **authoritative** where the provider exposes it |
  | provider event timestamp | ordering **hint** only |
  | `subscriptions.last_event_at` | defensive **monotonic guard** |
  Ordering semantics that vary by provider live **inside the adapter**, not in the
  RPC. Stripe (`D2`, second adapter) does not behave identically to Razorpay.
- **No replay window on a validly signed webhook** (Task 5.1). Razorpay retries
  failed deliveries for up to 24 hours, so "reject events older than N minutes"
  drops real payments while blocking nothing an attacker could send anyway. The
  event-id claim is the primary event-level dedupe. Freshness rules, where a
  provider signs a timestamp, belong to that provider's adapter.
- **Effect idempotency is separate from event identity, because the event id is
  not signed.** Razorpay's HMAC authenticates the raw request body;
  `x-razorpay-event-id` is a provider-supplied header outside the signature base.
  So `payment_events` deduplicates *deliveries* on
  `(provider, environment, event_id)`, while financial effects are additionally
  fenced by provider-resource identity —
  `UNIQUE (provider, environment, provider_ref)` on `payment_transactions`, whose
  key comes from **inside** the signed body. A fresh `event_id` on an otherwise
  identical signed body must never be sufficient to produce a second money row
  (`A35`). A conflict on an expected existing provider money identity is an
  `already_applied` outcome, **not** a retryable database failure (Task 4.2.7a).
- **Webhook completion budget is a design invariant, not operational trivia.**
  Razorpay resends an event when the endpoint does not respond within **5
  seconds**. Verification, normalization, the single `process_payment_event()`
  RPC, and the response path must therefore be bounded: **no provider API call,
  no reconciliation, and no unbounded query inside webhook processing** (Task 9).
  Exceeding the budget manufactures our own duplicate storm.
- **Every provider identifier is unique only within `(provider, environment)`.**
  Provider refs and provider event ids are never globally unique on their own —
  every uniqueness constraint on one is a three-column constraint, and internal
  foreign keys point at our own surrogate `UUID`s (`Task 1`).
- **Provider metadata may *locate* a local intent; it may never *be* tenant
  authority.** These are two different powers and the plan grants only the first:
  | Chain | Allowed? |
  | --- | --- |
  | `notes.auxelon_checkout_intent` → match an **existing** local `checkout_intents.id` → derive `account_id` **from that local row** | **yes** — the note is a correlation locator |
  | `notes.account_id` (or any payload/metadata field) → account | **never** — that is inventing a tenant from external data (`F3`) |
  The tenant is always derived from a row **we** wrote before the provider was
  called. A correlation locator can only ever point at one of our own intents; it
  can never create a mapping, never override one, and never name an account
  directly. This is what closes the last crash window (provider object exists,
  `provider_ref` never persisted) **without** weakening `F3` — see Task 5.3a-i,
  Task 4.1b step 2b, Task 9.4.
- **The RPC never learns the deployment's environment from the event.** Postgres
  cannot read `PAYMENTS_ENVIRONMENT` out of `src/lib/env.ts`, so
  "the RPC rejects on environment mismatch" is only implementable if the trusted
  server caller **passes the configured environment in as its own parameter**,
  separately from the environment observed on the event (Task 4.1c). A function
  that compares the event against itself checks nothing.
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
- **One RPC = one transaction, and that is the only way to get one.** Two
  `supabase-js` calls are **two** transactions: Supabase's own documentation is
  explicit that separate client queries are not grouped, and that multi-statement
  transactional logic belongs inside a database function. So the event claim and
  the state application are **not** two calls the route sequences — they are one
  `process_payment_event()` database function (Task 4) invoked as a single
  `supabase.rpc(...)`. Any design where the route does
  `from('payment_events').insert(...)` and then `rpc('apply_subscription_state')`
  violates the invariant in Task 9.3a while appearing to satisfy it.
- **`payment_events` is an *accepted-event ledger*, not an attempt log.** A row
  exists only for a transaction that committed:
  | Outcome | Row |
  | --- | --- |
  | `applied` / `ignored` / `failed_terminal` | committed, row persists |
  | transient failure (DB error, provider blip, unresolved tenant) | **rolled back — no row at all**, `5xx`, provider retries |
  Do not "complete" the table by adding `failed_retryable`: recording an attempt
  is precisely what burns the claim and makes the event permanently
  unrecoverable (Task 1.4, Task 9.3a).
- **HTTP response taxonomy for the webhook is fixed** (Task 9):
  | Situation | Response | Record |
  | --- | --- | --- |
  | bad/absent signature | `401` | nothing |
  | valid signature, unsupported event | `200` | `failed_terminal` |
  | valid signature, deliberate no-op (wrong env, stale, manual, illegal) | `200` | `ignored` + reason |
  | valid signature, transient failure | `5xx` | nothing (rolled back) |
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
supabase/migrations/2026MMDDHHMMSS_process_payment_event.sql       (T4)
src/lib/ports/payment-provider.ts                                 (T2)  zero vendor imports
src/lib/ports/payment-provider.test.ts                            (T2)  boundary test
src/features/billing/lib/subscription-state.ts + .test.ts          (T3)  pure, no I/O
src/features/billing/lib/checkout-intent.ts + .test.ts             (T7)  local intent, written first
src/features/billing/lib/process-payment-event.ts + .test.ts       (T4)  single-RPC wrapper (claim + apply)
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
  `cancel_request_status TEXT CHECK (cancel_request_status IN
  ('requested','provider_accepted','failed'))`,
  `cancel_requested_at TIMESTAMPTZ`, timestamps.
  - **The two cancellation column groups are on opposite sides of the trust
    boundary and must never be confused.** `cancel_request_status` /
    `cancel_requested_at` are application-owned: the owner's `DELETE` request
    writes them directly (Task 8.2). `cancel_at_period_end` and `status` are
    provider-derived: only `process_payment_event()` writes them, once the
    provider confirms. A handler that sets `cancel_at_period_end` from a user
    request is the defect this split exists to prevent.
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
  - **`CREATE UNIQUE INDEX … ON checkout_intents (account_id) WHERE status IN
    ('created','provider_attached')` — at most one *open* intent per account.**
    This is the real fix for A7. The partial unique index on `subscriptions`
    (1.1) only rejects the *second active row*, which is too late: by then the
    customer may already have two live Razorpay subscriptions and two charges.
    Duplicate provider-side subscriptions must be prevented **before** the
    provider is called, and the only place to do that is the intent row. Task 7
    reuses an existing open intent instead of creating a second one; the index is
    what makes that check race-proof rather than advisory.
- [ ] **1.3** `billing_reconciliation_state` — durable cursor for Task 10.
  `provider TEXT NOT NULL`, `environment TEXT NOT NULL CHECK (environment IN
  ('test','live'))`, `cursor TEXT`, `last_run_at`, `last_status TEXT`,
  `orphans_seen INTEGER DEFAULT 0`, **`PRIMARY KEY (provider, environment)`**.
  Workers isolates are ephemeral: a cursor held in a module-level variable resets
  on every cold start, so the cron would re-scan from the beginning forever and
  never reach the tail.
  - **`provider TEXT PRIMARY KEY` would be wrong for the same reason as 1.1:**
    Razorpay/test and Razorpay/live would share one cursor and one
    `orphans_seen` counter, so a test-mode reconcile run would drag the live
    cursor to a position in a different id space. The cursor is per
    `(provider, environment)`, exactly like every other provider-scoped row in
    this schema.
- [ ] **1.4** `payment_events`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
  `provider TEXT NOT NULL`, `environment TEXT NOT NULL`, `event_id TEXT NOT NULL`
  (the provider's id), `provider_event_type TEXT`, `subscription_id NULL`,
  `account_id NULL`, `kind`, `status TEXT NOT NULL CHECK (status IN
  ('applied','ignored','failed_terminal'))`, `ignored_reason TEXT`, `event_at`,
  `received_at DEFAULT now()`, `payload_digest TEXT`.
  - **This table is an *accepted-event ledger*, not a log of every request.** A
    row means "a transaction committed for this event". There is deliberately no
    persisted `failed_retryable` state, because a retryable failure must not
    leave a row at all. The claim and the apply are one transaction — one RPC
    (Task 4, Task 9.3a): if the apply fails transiently, the transaction rolls
    back, the claim disappears with it, and the provider's retry gets a fresh
    claim. A persisted "failed" row plus a `200` response is the trap — the
    provider stops retrying while `ON CONFLICT DO NOTHING` makes every future
    redelivery look `already_processed`, so the event is unrecoverable forever.
  - `failed_terminal` is reserved for outcomes where retrying provably cannot
    help (e.g. a malformed-but-signed event we will never be able to interpret).
    It is **not** for "we could not resolve the tenant yet" — see Task 9.4.
  - **`UNIQUE (provider, environment, event_id)` is the idempotency claim**, and
    the surrogate `id UUID` is the row identity every foreign key points at.
    `event_id TEXT PRIMARY KEY` would be wrong the moment a second provider or a
    second environment exists: provider event ids are namespaced *by* the
    provider, and Razorpay test-mode and live-mode ids come from different
    id spaces with no cross-guarantee. The uniqueness that matters is the triple.
  - **`event_id` is the provider's own event identifier, taken from where that
    provider actually publishes it.** For Razorpay it is the
    `x-razorpay-event-id` request header — documented as the unique per-event id
    for deduplication — **not** a payload field, and never synthesised locally
    (Task 5.1 step 5). The only other legitimate producer is the reconciliation
    cron's deterministic synthetic id (Task 10.3).
  - **The header is provider-supplied identity, not authenticated data — do not
    describe it as "verified".** Razorpay's documented scheme is HMAC-SHA256 over
    the **raw request body**; the header sits outside the signature base string.
    So the triple is the primary provider-level idempotency claim and must not be
    presented as cryptographic authentication of the event id. A redelivered
    event with the *same* id loses the claim and is never applied twice, at any
    age. An attacker holding a captured validly-signed body who substitutes a
    fresh id gets a new claim — and is stopped at the **effect** layer instead:
    `UNIQUE (provider, environment, provider_ref)` on `payment_transactions`
    (whose key is inside the signed body), plus the `last_event_at` monotonic
    guard for entitlement (`A35`, Task 4.2.7a). Signed body, provider resource
    identity, ledger uniqueness, and the monotonic guard **jointly** constrain
    replay effects.
  - **Digest only — never the raw payload** (`F7`).
  - **`payload_digest` stays deliberately non-unique.** It is an anomaly-detection
    and forensic-correlation signal — index it, alert on "same digest, new
    `event_id`" — and it is **never** an authoritative event identity. Do **not**
    add `UNIQUE (provider, environment, payload_digest)`: Razorpay documents
    uniqueness for the event-id *header*, and guarantees nothing about body
    uniqueness. The signed envelope carries a second-granularity `created_at` and
    a payload that is "a snapshot of the entity when the event occurred", so two
    genuinely distinct events with an unchanged snapshot inside the same second
    produce an identical digest. A hard `UNIQUE` there silently **drops a real
    billing event**, which in a revenue ledger is worse than an extra forensic
    row. It also does nothing about the documented out-of-order delivery that the
    effect-layer fences do handle.
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
  `payment_event_id UUID NOT NULL REFERENCES payment_events(id)`, `occurred_at`,
  `created_at`.
  - `UNIQUE (provider, environment, provider_ref)`, not `provider_ref UNIQUE` —
    same reasoning as 1.1.
  - **This constraint is the money-effect idempotency fence, and it is load
    bearing.** `provider_ref` is the provider's own payment/refund/chargeback id,
    which lives **inside the signed body** — unlike `event_id`, which does not
    (1.4). It is therefore what actually stops a replayed signed body carrying a
    substituted `x-razorpay-event-id` from producing a second money row (`A35`),
    and it equally covers the provider's own documented at-least-once
    redeliveries. Its conflict behaviour must be classified deliberately, not left
    to bubble as a generic DB error — Task 4.2.7a.
  - The ledger references `payment_events.id` (the surrogate), **never** the
    provider's `event_id` string. Internal foreign keys must not be provider
    identifiers.
  - **`payment_event_id` is `NOT NULL`, deliberately.** Every row in this ledger
    is created by `process_payment_event()` in the same transaction as the
    `payment_events` claim that caused it, so the causing event always exists. A
    nullable FK would be an escape hatch for an orphan money row with no
    provable provider origin — exactly the thing an auditable ledger exists to
    make impossible. If some future flow needs a manual adjustment, it gets its
    own synthetic `payment_events` row (with `provider = 'manual'`) rather than a
    `NULL`.
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
  | `environment: 'test' \| 'live'` | first-class, not inferred (A11); the environment **observed** on the event, compared against the configured one the caller passes separately (4.1c) |
  | `correlationIntentId?` | UUID-validated correlation **locator** from provider metadata (5.3a-i) — points at one of our own intents, never names an account |
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
- [ ] **3.1a** **The domain spelling is `canceled`, and the provider's spelling
  never leaves the adapter.** Razorpay says `cancelled`; a codebase that carries
  both spellings will eventually compare them.

  ```ts
  export type SubscriptionStatus =
    | "incomplete"
    | "active"
    | "past_due"
    | "canceled"
    | "expired";
  ```

  `cancelled` (and every other provider word) appears **only** in
  `razorpay/adapter.ts`'s mapping table (5.3d). Assert it: a test greps
  `src/features/billing` outside `razorpay/` for provider vocabulary and fails on
  a hit, in the same style as the Task 2.3 boundary test.
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

## Task 4 — `process_payment_event` RPC (`D12`, `D15`, `D16`)

**Files:** create `supabase/migrations/<ts>_process_payment_event.sql`,
`src/features/billing/lib/process-payment-event.ts`, `…test.ts`

One transaction, or nothing. This function is the only writer of billing state.

- [ ] **4.0** **One function owns the whole event, claim included.** The earlier
  draft split this into "route claims the event, then route calls
  `apply_subscription_state()`" — two `supabase-js` calls, therefore **two
  transactions**, therefore the Task 9.3a invariant was a requirement with no
  implementation. Supabase documents that separate client queries are not grouped
  into a transaction and that multi-step transactional logic must live in a
  database function. So:

  ```text
  POST webhook
      ↓ verify signature (raw body)
      ↓ normalize to a domain PaymentEvent
      ↓ supabase.rpc('process_payment_event', normalizedEvent)   ← ONE call
          BEGIN
            claim event            -- INSERT payment_events … ON CONFLICT DO NOTHING
            environment guard      -- BEFORE any billing-state write
            ensure subscription    -- reconstruct from checkout_intent if missing
            lock subscription      -- SELECT … FOR UPDATE
            ordering guard
            manual-billing guard
            state transition
            ledger row
            subscriptions write
            accounts.plan_id
            audit event
          COMMIT
      ↓ 200
  ```

  There is **no separate claim operation anywhere in the codebase.** Any future
  `from('payment_events').insert(...)` in a route is a regression; say so in a
  comment at the RPC call site. The internal steps may be factored into helper
  functions (`ensure_subscription_for_event`, `apply_subscription_state_internal`)
  **called from inside** `process_payment_event`, never from TypeScript.
- [ ] **4.1** `CREATE OR REPLACE FUNCTION process_payment_event(...) RETURNS
  jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp`.
  **`SECURITY DEFINER` must be written explicitly** — `CREATE OR REPLACE` does
  not inherit it and Postgres silently downgrades to INVOKER (`AGENTS.md`;
  `scripts/push-supabase-schema.mjs` enforces this). The same applies to every
  internal helper it calls.
- [ ] **4.1-i** On a committed path it returns a discriminated result the route
  maps straight onto the HTTP taxonomy: `{ outcome: 'applied' |
  'already_processed' | 'ignored' | 'failed_terminal', reason?, accountId?,
  eventRowId? }` — all `200`. Every non-terminal outcome, **including an
  unresolved tenant**, is a `RAISE EXCEPTION`: the transaction rolls back, no row
  survives, and the route answers `5xx` so the provider redelivers (9.4a). A
  return value can be ignored by a caller; an exception cannot.
- [ ] **4.1c** **The configured environment is an explicit trusted parameter.**
  The database has no access to `PAYMENTS_ENVIRONMENT`; an environment gate that
  reads the environment off the event and then compares it to the event is a
  no-op that reads like a control. So the signature carries **both** values, from
  two different trust levels:

  ```sql
  process_payment_event(
    p_environment       text,  -- TRUSTED: the caller's configured deployment mode
    p_event_environment text,  -- OBSERVED: the credential set that verified the event
    …                          -- the rest of the normalised event
  )
  ```

  | Caller | `p_environment` | `p_event_environment` |
  | --- | --- | --- |
  | webhook route (Task 9) | `paymentsEnvironment()` from `src/lib/env.ts` | the environment the adapter stamped from the verifying credential set (5.3b) |
  | reconciliation cron (Task 10) | `paymentsEnvironment()` | the environment of the credential set used to read the provider API |

  - `p_environment IS NULL` or not in `('test','live')` ⇒ `RAISE EXCEPTION`. A
    caller that cannot state its own mode is a misconfiguration, not a `200`.
  - `p_environment <> p_event_environment` ⇒ `ignored_reason='wrong_environment'`,
    committed, `200` (4.2 step 2). This is the A11 defense, and it only works
    because the trusted value arrived from outside the event.
  - `payment_events.environment` stores `p_event_environment` (what we saw), so
    forensics can still show a rejected test-mode delivery.
  - Because both callers pass it from the same `env.ts` getter, there is exactly
    one source for the trusted value and no place for a literal `'live'` to be
    typed into SQL.
- [ ] **4.1a** Harden it as the privileged function it is. `SET search_path` is
  necessary but **not sufficient** — a definer function is the one place where a
  resolution surprise executes with elevated rights:
  - **Schema-qualify every object it touches**: `public.subscriptions`,
    `public.accounts`, `public.plans`, `public.payment_events`,
    `public.payment_transactions`, `public.checkout_intents`,
    `public.audit_events`. No bare table names anywhere in the body.
  - **Control `EXECUTE` explicitly**, because Postgres grants it to `PUBLIC` by
    default:

    ```sql
    REVOKE EXECUTE ON FUNCTION public.process_payment_event(...) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.process_payment_event(...) FROM anon, authenticated;
    GRANT  EXECUTE ON FUNCTION public.process_payment_event(...) TO service_role;
    ```

    and **nothing else**, for the function and every internal helper. An
    `authenticated` role able to call this function can grant itself any plan —
    this `REVOKE` is load-bearing. Revoking from `PUBLIC` already removes the
    inherited privilege in normal role semantics; the explicit `anon,
    authenticated` revoke is written anyway so the *intent* is unmissable in the
    migration and in the security checklist.
  - Record both in the RLS/security checklist so a later `CREATE OR REPLACE`
    (which resets neither) is caught.
- [ ] **4.1b** **The function must be able to *reconstruct* a missing subscription
  from its `checkout_intents` row.** Without this, the intent-first design of Task
  1.2/7.6 is only half implemented: it resolves the tenant and then dies at the
  next line. The crash scenario it exists for is precisely the one where no
  `subscriptions` row exists —

  ```text
  checkout_intent exists
  provider subscription exists
  our process died before inserting `subscriptions`
  webhook arrives
    → tenant resolves via checkout_intent          ✅
    → process_payment_event()
    → SELECT subscription … FOR UPDATE
    → NO ROW                                        ❌ stuck
  ```

  So the RPC accepts **either** an existing subscription **or** a missing
  subscription plus a matching intent, via an internal
  `ensure_subscription_for_event(...)` step that runs **inside the same
  transaction** (never as a separate call the caller could skip or fail between):
  1. Look up `public.subscriptions` by `(provider, environment, provider_ref)`.
  2. If absent, `SELECT … FOR UPDATE` the `public.checkout_intents` row for the
     same triple.
  2b. **If that is also absent, fall back to the correlation locator** — the
     remaining crash window is "provider object exists, our process died before
     `provider_ref` was ever written", so *both* `provider_ref` lookups miss by
     construction. The event's verified correlation note
     (`notes.auxelon_checkout_intent`, Task 5.3a-i) supplies the local intent id;
     the adapter passes it as `p_correlation_intent_id UUID` after validating it
     is a UUID. Bind it **only** when every one of these holds:
     1. the signature already verified (guaranteed — the RPC is unreachable
        otherwise),
     2. `p_correlation_intent_id IS NOT NULL`,
     3. a `public.checkout_intents` row with that `id` exists (`SELECT … FOR
        UPDATE`),
     4. `intent.provider = p_provider`,
     5. `intent.environment = p_event_environment` (which already equals
        `p_environment`, 4.1c),
     6. `intent.status IN ('created','provider_attached')` — an open journey,
     7. `intent.provider_ref IS NULL` **or** `intent.provider_ref = p_provider_ref`
        — bind a missing ref or confirm the matching one; **never overwrite a
        different ref**.

     Then `UPDATE` the intent's `provider_ref` / `status='provider_attached'` and
     continue at step 3. Anything short of all seven ⇒ treat as absent and
     `RAISE EXCEPTION`.

     **What this does not do:** it never reads an account, plan, price, or
     interval out of provider metadata. The note is a *pointer to a row we wrote*;
     `account_id` still comes from that row. `notes.account_id` remains forbidden
     (`F3`, A4) and an intent id that matches nothing is worth nothing.
  2c. Still unresolvable ⇒ do not invent a tenant (`F3`) — `RAISE EXCEPTION` so
     the whole transaction (claim included) rolls back and the provider redelivers
     (Task 9.4a).
  3. Build the `subscriptions` row from the **intent** (`account_id`, `plan_id`,
     `interval`, `amount_minor`, `currency` — our server-resolved values, never
     the payload's) plus the provider event's lifecycle/period fields, inserted as
     `incomplete` with `checkout_intent_id` set.
  4. The insert is `ON CONFLICT (provider, environment, provider_ref) DO NOTHING`
     followed by a re-select, so two concurrent first-deliveries cannot fork the
     row.
  5. Then continue at 4.2 step 4 with a row that is guaranteed to exist and
     locked.

  This whole step runs **downstream of the environment gate** (4.2 step 2), so a
  wrong-environment event never reaches it and never reconstructs anything.
  Condition 5 below (`intent.environment = p_event_environment`) is therefore a
  redundant check kept deliberately: it must not be the only thing standing
  between a test-mode delivery and a live `subscriptions` insert.

  Reconstruction is a **repair path, not an adoption path**: it only ever fires
  when *our own* intent row already names the account — whether that row was found
  by `provider_ref` (step 2) or pointed at by a verified correlation note
  (step 2b). An event with no matching intent and no subscription is Task 10.6's
  orphan incident, never a new mapping.
- [ ] **4.2** Order of operations inside the transaction:
  0. **Claim the event**: `INSERT INTO public.payment_events … ON CONFLICT
     (provider, environment, event_id) DO NOTHING`. Zero rows ⇒ duplicate ⇒
     return `already_processed` immediately, applying nothing. This step is
     *inside* the function precisely so it shares the fate of everything below it.
  1. **Validate the trusted environment:** `p_environment IS NULL` or not in
     `('test','live')` ⇒ `RAISE EXCEPTION` (4.1c). A caller that cannot state its
     own mode is a misconfiguration, not a `200`.
  2. **Environment gate — before any billing-state write.** If
     `p_event_environment <> p_environment` — the observed environment versus the
     **trusted parameter the caller supplied** (4.1c), never a value read back out
     of the event — record `ignored_reason='wrong_environment'` and return
     `ignored`. A test-mode event must never move a live tenant's plan (A11).

     **This gate sits ahead of subscription resolution deliberately.** With the
     gate downstream of 4.1b, a test-mode delivery to a live deployment would
     claim the event, find a `checkout_intent`, **insert a `subscriptions` row**,
     and only then be ignored — committing a billing-state mutation it was
     supposed to have no authority to make. The order above makes the rejection
     total:

     ```text
     wrong environment
         ↓
     ignored (committed, 200)
         ↓
     NO subscription reconstruction
     NO plan lookup
     NO ledger row
     NO entitlement mutation
     ```

     Only the `payment_events` claim row survives, which is the forensic record
     (4.1c) and not billing state.
  3. Resolve the subscription: `SELECT … FOR UPDATE` the subscription row —
     reconstructing it from the intent first if it is missing (4.1b). Locking
     serialises concurrent deliveries of the same subscription (kills the A6
     race).
  4. **Monotonic guard (defensive, not authoritative):** if
     `event_at <= last_event_at`, record `ignored_reason='stale_event'` and return
     without touching state (`D12`). This is a **backstop**, not the ordering
     mechanism — where the adapter supplied `resourceStatus`/`resourceVersion`,
     prefer it, and let the adapter own any provider-specific ordering quirk. Do
     not add provider `if`-branches to this function.
  5. **Manual short-circuit:** if `accounts.billing_mode = 'manual'`, record
     `ignored_reason='manual_billing'` and return — do not apply (`D16`).
  6. Compute the transition; `'illegal'` ⇒ `ignored_reason='illegal_transition'`.
  7. Write the ledger row if the event carries money (this happens **whether or
     not** status moves — money and entitlement are separate consequences, see
     global constraints).
- [ ] **4.2.7a** **A duplicate money-effect conflict is a deliberate outcome, not
  a transient failure.** A unique violation on
  `payment_transactions (provider, environment, provider_ref)` means *this
  provider money resource has already been ledgered*. The RPC must distinguish:

  ```text
  UNIQUE violation on the expected provider money identity
      → already_applied
      → commit the payment_events row (status 'ignored',
        ignored_reason='already_applied')
      → 200

  any other database failure
      → RAISE
      → roll back the whole transaction (claim included)
      → 5xx, provider retries
  ```

  Catch it narrowly — `unique_violation` **on that specific constraint** — never
  a bare exception handler that would also swallow a real fault. Without this
  rule, a legitimate redelivery or an `A35` replay produces:

  ```text
  ledger UNIQUE conflict → generic exception → rollback → 5xx
      → provider retries → same conflict → …
  ```

  which burns Razorpay's 24-hour backoff on an event that can never succeed, and
  leaves no deterministic way to tell **already applied** from **actually
  failed**. `already_applied` is a terminal, committed, `200` outcome; add it to
  the 9.3b response taxonomy alongside the other `ignored` reasons.
  8. If it is a *lifecycle* event: write `subscriptions` (status, period end,
     `last_event_at`), set `accounts.plan_id`, clear or set `grace_until`.
  9. Insert the audit event, and mark the `checkout_intents` row `completed` on
     first activation.
- [ ] **4.3** `plan_id` is resolved **from our `plans` table** by matching
  `provider_refs`, never from a plan id in the payload (`F3`).
- [ ] **4.4** Never touch `account_limit_overrides` (`F5`).
- [ ] **4.5** Thin TS wrapper in `process-payment-event.ts` — **exactly one
  `supabase.rpc('process_payment_event', …)` call and no other write**; on any DB
  error it **throws** so the route can return `5xx` and the provider retries
  (`D11`). The wrapper is the only module allowed to name the RPC.

**Verify:** integration test — two concurrent calls with the same `event_id`
produce exactly one ledger row; a call with an older `event_at` is recorded
`ignored`; **a call whose apply raises leaves zero `payment_events` rows** (the
claim rolled back with it).

## Task 5 — Razorpay adapter (`D2`, `F2`)

**Files:** create `src/features/billing/lib/razorpay/{client,verify,adapter}.ts` + tests

- [ ] **5.1** `verify.ts` — exactly these steps, in this order:
  1. Read the **raw body string** (`await request.text()` **before** any parse; a
     re-serialised object has different bytes and will never match).
  2. HMAC-SHA256 over the raw body with the webhook secret.
  3. `crypto.timingSafeEqual` on equal-length buffers.
  4. Parse **only after** the signature verifies.
  5. **`event_id` comes from the `x-razorpay-event-id` request header, not from a
     payload field — and the header is provider-supplied, not authenticated.**
     Razorpay documents it as the unique per-event identifier intended for
     deduplication, and it is the value that stays stable across the retries of
     one delivery. But it is **outside the HMAC base string**, which is the raw
     body: read it only after step 3 (so we know the *body* is genuine), and treat
     it as event identity, never as verified data. Require it: **absent or empty ⇒
     throw** (`401`, nothing recorded). Never synthesise a fallback id from the
     payload or from `now()`; a fabricated id defeats the claim in Task 1.4. The
     claim key is `(provider, environment, x-razorpay-event-id)`; because that key
     is not signed, duplicate *effects* are fenced separately at the ledger
     (Task 1.5, Task 4.2.7a, `A35`).
  6. Deduplicate on `(provider, environment, event_id)` (Task 1.4, Task 9.3).
  7. **No timestamp/replay window. Do not reject a validly signed event for being
     old.**

  Missing secret ⇒ **throw**, never "skip" (`F2`).

  **Why the replay window is removed (corrects the earlier draft and `F2`).**
  Razorpay's webhook signature is an HMAC-SHA256 over the raw request body with
  the webhook secret; there is no documented signed-timestamp header to anchor a
  freshness check on, and Razorpay retries failed deliveries with exponential
  backoff **for up to 24 hours**. An "older than N minutes ⇒ reject" rule
  therefore does not raise the bar for an attacker (who cannot forge a signature
  at any age) and *does* discard legitimate retries — i.e. it throws away money.
  The `UNIQUE (provider, environment, event_id)` claim is the event-level replay
  defense; because the event id itself is not signed, it is **not** a complete one
  on its own, and the ledger's provider-resource uniqueness completes it
  (Task 1.5, `A35`). If a future provider ships a signed timestamp in the
  signature base string, that provider's **adapter** may enforce freshness;
  replay semantics are adapter-local, never a shared rule in `verify.ts`.
- [ ] **5.1a** **Webhook secret rotation is an operational procedure, and it has
  to exist before go-live.** Razorpay's own webhook FAQ notes that deliveries
  already in flight when the secret changes still validate against the **old**
  secret, while later events use the new one — and the provider's retry window is
  up to 24 hours. A single-secret deployment that rotates therefore silently
  `401`s a day's worth of real retries.
  - `verify.ts` accepts an **ordered list** of candidate secrets and tries each
    with `timingSafeEqual`, current first. Success records *which* secret matched
    (for the metric below); failure means none matched.
  - Env shape (both are optional; only the primary is required to run):

    ```text
    RAZORPAY_LIVE_WEBHOOK_SECRET            # current
    RAZORPAY_LIVE_WEBHOOK_SECRET_PREVIOUS   # accepted during rotation only
    ```

  - Runbook (`docs/` + Task 15):
    1. Generate the new secret and set it as `…_WEBHOOK_SECRET_PREVIOUS = old`,
       `…_WEBHOOK_SECRET = new` **before** changing it at the provider.
    2. Update the secret in the provider dashboard.
    3. Monitor previous-secret validations until no recent retries still rely on
       the old secret. Log a structured line on every previous-secret hit and
       read those logs — do **not** make the runbook depend on a provider-side
       metric that may not exist.
    4. Wait out the full provider retry/replay window (24 h for Razorpay) from
       the last previous-secret hit. Razorpay's own FAQ states that retries in
       flight when the secret changed must still validate against the old
       secret, which is the entire reason this step exists.
    5. Remove `…_WEBHOOK_SECRET_PREVIOUS`.
  - If the provider's configuration model permits only one active secret per
    endpoint, document that limitation explicitly and rotate by adding a second
    endpoint rather than mutating the live one. **Never** rotate by accepting an
    unsigned request during the transition.
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
  - Express this as a **provider capability, not a domain concept.** "Does this
    vendor accept an HTTP idempotency mechanism on subscription creation?" is a
    fact about a vendor's API, so it does not belong as a bare boolean on the
    business-facing `PaymentProvider` port:

    ```ts
    export interface PaymentProviderCapabilities {
      createSubscriptionIdempotency: "supported" | "unsupported";
    }
    ```

    Expose it as `readonly capabilities: PaymentProviderCapabilities` (or keep it
    entirely adapter-local if no caller needs to branch on it). Either way the
    absence of a header is a **stated fact** about the provider rather than an
    oversight in the adapter — and the port keeps talking about payments instead
    of about HTTP headers.
  - **Where the provider offers no idempotency guarantee, our reconciliation is
    the safety net:** an ambiguous or timed-out create response is resolved by
    looking the resource up by `provider_ref` and by the intent
    (`checkout_intents`), never by blindly retrying the create. `database +
    provider_ref` reconciliation is the source of truth for ambiguity.
- [ ] **5.3b-p** **The outbound Create Subscription body is a closed, exact
  contract — validated against the provider's documented schema, not assembled by
  guess.** `POST /v1/subscriptions` documents **9** request parameters, and the
  API is **strict in both directions**: a missing required field *and* an
  unrecognised extra field are both `400`. The documented error
  `{any extra field} is/are not required and should not be sent` means we cannot
  smuggle anything into the body — every local identifier has to travel in `notes`
  (5.3a-i). The exact body the adapter sends:

  ```ts
  // razorpay/adapter.ts — createSubscription. Closed set. Nothing else.
  {
    plan_id,                 // REQUIRED. From plans.provider_refs (4.3), 19 chars
    total_count,             // REQUIRED (see 5.3b-t). Never together with end_at
    quantity: 1,             // pinned (5.3b-q)
    customer_notify: false,  // explicit product decision (5.3b-n)
    notes: { auxelon_checkout_intent: intent.id },  // locator (5.3a-i), max 15 pairs
  }
  ```

  Documented `400`s the adapter must not be able to trigger, each of which would
  otherwise surface as a failed checkout for a real customer:

  | Provider error | Rule the adapter enforces |
  | --- | --- |
  | `The plan id field is required.` | `plan_id` resolved from our `plans` table before the call; absent ⇒ fail locally, never call |
  | `The plan id must be 19 characters.` | validate the `plan_<14 alnum>` shape when a `provider_refs` value is read (a typo'd seed row must fail loudly, not at the customer) |
  | `The total count field is required when end at is not present.` | always send `total_count` (5.3b-t) |
  | `Please provide either an end date or a total count, but not both.` | **never** send `end_at` alongside it — mutually exclusive, not merely redundant |
  | `The total count must be at least 1.` / `must be an integer.` | `total_count` is a server-computed positive integer |
  | `The quantity must be at least 1.` | pinned to `1` (5.3b-q) |
  | `start_at cannot be lesser than the current time.` | **do not send `start_at` at all** for immediate-start V1 checkout; omitting it starts the subscription after authorisation. A computed "now" is a clock-skew `400` waiting to happen |
  | `{any extra field} … should not be sent` | the body is built from the closed literal above — no spreading of caller input, no passthrough object |

  **Verify:** an adapter unit test asserts the serialised request body's key set is
  **exactly** `{plan_id, total_count, quantity, customer_notify, notes}` — a set
  equality, not a subset check, so a future field addition has to be deliberate.
- [ ] **5.3b-t** **`total_count` is required by the provider, and its exhaustion is
  a silent-access-loss cliff that V1 must decide about explicitly.** Razorpay
  requires the subscription to be bounded — by `total_count` or `end_at`, never
  both — so an "indefinite" SaaS subscription does not exist at the provider. What
  happens at the boundary is the part that matters:

  ```text
  total_count cycles elapse
    → provider moves subscription to `completed`
    → subscription.completed webhook
    → our mapping: completed → expired  (5.3d)
    → entitlement revoked
  … for a customer who never cancelled and would have kept paying.
  ```

  So `total_count` is not a throwaway constant; it sets the date the paying
  customer silently loses access. Decide, record the decision, and test it:
  - Compute it from the plan interval against a **documented horizon** (the API
    states a 100-year maximum, so a monthly plan admits up to `1200`). A long
    horizon — e.g. monthly ⇒ `120` (10 years) — turns the cliff into a
    non-event for V1 while staying well inside provider limits.
  - **`subscription.completed` must be treated as an operational alert, not a
    routine terminal state.** It means either a genuine full-term completion or
    that we under-set `total_count` on a live payer. Surface it (Task 13
    observability), do not let it revoke access quietly.
  - A renewal/re-subscribe path is explicitly **out of V1 scope** — which is only
    acceptable *because* the horizon is long. Write that dependency down so the
    two decisions cannot drift apart.
- [ ] **5.3b-n** **`customer_notify` is a product decision, and the default is not
  ours.** It defaults to `true`, which means **Razorpay** emails the customer about
  subscription and charge events. For a product that owns its own transactional
  email, that produces duplicate and off-brand mail. Send it **explicitly** —
  `false` if we own the messaging, `true` only as a deliberate choice — and never
  leave it to the provider default by omission.
- [ ] **5.3b-q** **`quantity` is server-controlled and pinned to `1`.** Razorpay's
  Create Subscription API takes a `quantity` parameter (it multiplies the plan
  amount, for per-seat billing). This product has **no per-seat billing** (`D6`,
  ADR-008/D1), so do not merely leave it out conceptually — **send the literal
  `1`** from the adapter:

  ```ts
  // razorpay/adapter.ts — createSubscription
  quantity: 1, // pinned: no per-seat billing. NEVER from the request body.
  ```

  The reason to be explicit rather than silent is the next person who reads the
  Razorpay docs, sees a `quantity` field, and plumbs it through to be "complete":

  ```json
  { "planId": "enterprise", "interval": "monthly", "quantity": 100 }
  ```

  The strict `zod` body schema of Task 7 already rejects that (unknown keys, `F1`),
  so this is defense in depth — the adapter is the second place the value is
  decided, and it decides it without consulting the caller. `quantity` never
  appears in a domain type, in `CreateCheckoutInput`, or in `checkout_intents`;
  the only correct amount is the one resolved server-side from our `plans` table.
  If per-seat billing is ever added, it arrives as a deliberate schema + ADR
  change, never as a passthrough field.
- [ ] **5.3a-i** **Correlation locator (required, not merely diagnostic).** Where
  a provider supports merchant-defined metadata — Razorpay's Create Subscription
  API documents a `notes` object — the adapter **must** include the local intent
  id:

  ```json
  { "notes": { "auxelon_checkout_intent": "<intent UUID>" } }
  ```

  This is upgraded from the earlier "diagnostic only" wording because
  diagnostic-only left one crash genuinely unrecoverable:

  ```text
  checkout_intent created            ✅
  provider subscription created      ✅
  our process dies                   ❌  provider_ref never persisted anywhere
  webhook arrives
    → subscriptions.provider_ref     ✗ no row
    → checkout_intents.provider_ref  ✗ NULL
    → and we must never adopt an unknown provider subscription
  ```

  Both `provider_ref` lookups miss *by construction*, so without the note the
  paying customer is unrecoverable. The note closes it.

  - **Read the locator only off the provider resource documented to carry it.**
    Razorpay documents `notes` on the **subscription** object at Create
    Subscription; a payment entity's `notes` is a different field and the
    published `payment.captured` sample shows it as `[]`. When an event contains
    both entities, inspect `payload.subscription.entity.notes` — never
    `payload.payment.entity.notes` — and note the documented cap of **15**
    key-value pairs. Missing correlation metadata is *unresolved* (9.4a), not an
    invitation to fall back to some other arbitrary metadata field.
  - `verifyAndParse` extracts the note into the domain `PaymentEvent` as
    `correlationIntentId?: string`, **only if it parses as a UUID**; anything else
    is dropped silently (it is untrusted input, so it gets no error path of its
    own). The adapter passes it to the RPC as `p_correlation_intent_id`, where the
    seven-condition bind in Task 4.1b step 2b applies.
  - **Locator, never authority.** The distinction is exact:

    ```text
    ALLOWED:   note → an existing local checkout_intents row → that row's account_id
    FORBIDDEN: note → an account, plan, price, or interval
    ```

    The tenant is still derived exclusively from the matched local intent — a row
    written by an authenticated owner before the provider was ever called. A note
    that matches nothing, matches a closed intent, matches another provider or
    environment, or points at an intent already bound to a different
    `provider_ref` is worth exactly nothing.
  - `metadata.account_id` (and every other direct tenant claim in a payload) stays
    forbidden outright (9.4, `F3`, A4). Naming an account is a different power from
    pointing at one of our own rows, and only the second is granted.
  - Guessing at unguessable ids is not a bypass: the note only has effect on a
    request that already passed HMAC verification, and it can only ever attach a
    provider ref to an intent that is still open and unbound.
- [ ] **5.3b-r** **The authorisation handoff comes from the create response, and
  it is read back — never constructed.** The plan specifies what we create but not
  how the customer reaches the mandate page. The Create Subscription response
  documents `short_url` ("URL that can be used to make the authorisation
  payment"), alongside `id`, `status: "created"`, and — importantly — a `notes`
  object echoed back.

  ```text
  createSubscription returns
    providerRef  ← response.id          (persist to checkout_intents.provider_ref)
    authorizeUrl ← response.short_url   (returned to the browser)
  ```

  Rules:
  - **Never hand-build a provider URL** from an id or a template. If `short_url`
    is absent from a `2xx`, that is an ambiguous create ⇒ reconcile by
    `provider_ref` (5.3a), do not improvise a redirect.
  - **Persist `provider_ref` before returning the URL to the browser.** The
    ordering is what makes 5.3a-i's crash window small rather than the primary
    recovery path.
  - **Echo-verify the locator.** The response returns `notes`; assert our
    `auxelon_checkout_intent` survived the round trip. If it did not, the
    correlation guarantee of 5.3a-i is void for that subscription and it must be
    flagged immediately, while we still hold the intent in hand.
  - The returned URL grants **nothing**. `A3` already holds: entitlement comes
    only from a webhook or the cron, never from the customer arriving back.
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
  | `halted` | `past_due` | provider gave up retrying — **recoverable**, see the recovery path below |
  | `cancelled` | `canceled` | |
  | `completed` | `expired` \* | ran its full term — terminal, not a failure |
  | `expired` | `expired` | |
  | `paused` / `resumed` | out of scope for V1 | reject as unknown (5.3c) until deliberately supported |

  Encode this as a total lookup that **throws on an unmapped provider state**, and
  unit-test every row. A `default:` branch here silently invents entitlement.

  **`halted` is recoverable, and must not collapse to `canceled`.** Razorpay's
  documented lifecycle lets a halted subscription persist across more than one
  billing cycle and later return to `active` once a debit succeeds. Mapping it to
  a terminal state throws away a paying customer. The full path:

  ```text
  halted → past_due

  past_due + grace_until not expired      → access remains
  provider later reports active           → past_due → active
  provider still halted/past_due
    + local grace expired                 → Task 10.4 reconciliation policy
                                          → default plan
  ```

  So `halted` **does not mean canceled in V1**. Entitlement loss comes from our
  own grace expiry under an explicit local policy, not from the provider state
  name — and the `active` recovery transition must exist in Task 3's transition
  table (`A9` requires it be legal, not invented at apply time).
- [ ] **5.3e** **Signed provider-account consistency check.** Razorpay's webhook
  envelope carries a top-level `account_id` **inside the signed body**, so it is
  authenticated data — unlike the event-id header. The adapter may expose it as
  `providerAccountRef` and compare it against the configured Razorpay merchant
  account for the active environment:

  ```text
  mismatch → terminal verification failure → reject
           → no payment_events row
  ```

  This anchors the A11/A32 environment gate to signed data rather than to
  configuration alone. The hard boundary:

  ```text
  ALLOWED:   Razorpay account_id → "does this webhook belong to our account?"
  FORBIDDEN: Razorpay account_id → Auxelon account_id
  ```

  It is a provider-identity assertion, never tenant resolution — `F3` and 9.4 are
  untouched, and the Auxelon tenant still comes only from a row we wrote.
- [ ] **5.4** Tests with fixture payloads: valid signature passes; single-byte
  mutation fails; absent secret fails; **a validly signed event with an old
  timestamp still passes verification** (the removed replay window, 5.1) and is
  stopped instead by the dedupe claim when it is a genuine duplicate; a signed
  request with **no `x-razorpay-event-id` header throws** rather than inventing an
  id (A31); `notes.auxelon_checkout_intent` surfaces as `correlationIntentId` when
it is a UUID and is dropped when it is not (A28); `notes.account_id` is never
read into the domain event at all (A29); **the same signed body with a
substituted `x-razorpay-event-id` still verifies** (the HMAC covers the body
only) and is stopped downstream rather than at verification (A35); the locator is
read from the subscription entity and **not** from a payment entity's `notes`
(5.3a-i); a body whose signed top-level `account_id` is not our configured
merchant account is rejected with nothing recorded (5.3e).

**Verify:** `npx vitest run src/features/billing/lib/razorpay/`

## Task 6 — Factory + Null Object (`D3`, `F8`)

**Files:** create `provider-factory.ts`, `noop.ts`, `…test.ts`; edit `src/lib/env.ts`,
`.env.*.example`

- [ ] **6.1** Optional getters: `paymentsProvider()`, `paymentsEnvironment()`,
  and the per-environment credential getters below — same optional-getter shape as
  the existing `cronAuthEnv()`.
- [ ] **6.1a** **`environment` is configured, never inferred.** Every table in
  Task 1 stores `environment`, and the RPC rejects on it (A11), so the deployment
  must be able to state which mode it is in without consulting a payload:

  ```text
  PAYMENTS_PROVIDER=razorpay
  PAYMENTS_ENVIRONMENT=live          # 'test' | 'live', required when a provider is set

  RAZORPAY_TEST_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET
  RAZORPAY_LIVE_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET
  ```

  Resolution is one-directional and total:

  ```text
  PAYMENTS_ENVIRONMENT=live
        → live credential set
        → signature verified with the live webhook secret
        → event.environment = 'live'
  ```

  - An **unrecognised or absent** `PAYMENTS_ENVIRONMENT` while
    `PAYMENTS_PROVIDER` is set ⇒ `NoopPaymentProvider`, not a default of `test`
    and not a default of `live`. Guessing either way is a fail-open.
  - The environment stamped on an event is **the credential set that verified its
    signature** (5.3b) — which, because only one set is loaded, is the configured
    one. Never a payload field, never a header.
  - Keeping both credential sets nameable in one manifest is what makes the
    test-mode rehearsal in Task 14.3 possible without editing code.
- [ ] **6.2** `getPaymentProvider()` returns the Razorpay adapter **only** when
  the provider id, a valid `PAYMENTS_ENVIRONMENT`, *and* all three credentials
  **for that environment** are present; otherwise `NoopPaymentProvider`
  (`createCheckout` throws `PaymentsUnavailableError`, `verifyAndParse` throws,
  `fetchSubscription` throws).
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
  0. **Reuse before create (A7).** Attempt the insert of the new intent and let
     the partial unique index on `(account_id) WHERE status IN
     ('created','provider_attached')` (Task 1.2) arbitrate. On unique violation,
     re-read the existing open intent: if it already has a `provider_ref`, return
     **that** provider handle so the user resumes the same journey; if it is
     `created` with no `provider_ref`, respond `409 checkout_in_progress`. Never
     "check then insert" in two statements — that is the exact race this index
     exists to close, and losing it means the customer gets two real Razorpay
     subscriptions and two charges, which no local constraint can undo.
  1. Insert `checkout_intents` with the **server-resolved** `amount_minor` and
     `currency`, `status='created'`. We now own the journey. This is an
     application-owned intent write, which the trust-boundary table explicitly
     permits — it moves no entitlement.
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
- [ ] **8.2** `DELETE`: owner-only. **The request path must not call
  `process_payment_event()` and must not touch entitlement.** A user pressing
  "Cancel" is a *request*, not provider-verified state, and the RPC is allowed to
  move `accounts.plan_id`. Earlier drafts of this step had the handler apply
  through the RPC, which directly contradicts the Definition of Done. The correct
  sequence:
  1. Authenticate; require `owner`; resolve the subscription from
     `context.accountId` (never a client-supplied id).
  2. Ask the provider to cancel at period end.
  3. Record **intent only** on the local row — add
     `cancel_request_status TEXT CHECK (cancel_request_status IN
     ('requested','provider_accepted','failed'))` and
     `cancel_requested_at TIMESTAMPTZ` to `subscriptions` in Task 1.1. These are
     application-owned intent columns, deliberately **not** `status`, not
     `cancel_at_period_end`, and not `plan_id`.
  4. Return `200` with the pending state. The UI renders "Cancellation
     requested — active until <period end>", which is the honest description of
     what we actually know.
  - `cancel_at_period_end`, `status`, and any `plan_id` change land **later**,
    when the provider's cancellation webhook arrives (or Task 10 reconciliation
    reads the cancelled state from the provider API) and that signed/verified
    event flows through `process_payment_event()` like every other entitlement
    change. If the provider silently fails to honour the request, reconciliation
    catches the divergence instead of us having already lied locally.
  - Reversible until period end; **no immediate data loss**.
- [ ] **8.3** Cancelling someone else's subscription by passing an id is
  impossible: the handler ignores any client-supplied subscription id and
  resolves from the session's `accountId` (attack A5).

## Task 9 — `POST /api/webhooks/payments/[provider]` (`D9`, `D11`)

The only endpoint that can change entitlement. Treat every byte as hostile.

- [ ] **9.1** Read `await request.text()` first. Cap body size; reject oversized.
- [ ] **9.2** `verifyAndParse` → on throw, `401`, log `event_id`-less rejection,
  **record nothing** and alert on a burst.
- [ ] **9.3** **The route performs no claim of its own.** It makes exactly one
  write call — `processPaymentEvent(normalizedEvent)` → one
  `supabase.rpc('process_payment_event', …)` — and the claim happens inside it
  (Task 4.0, 4.2 step 0). A duplicate returns `already_processed` ⇒
  `200`, no re-apply. This claim — not a timestamp window (5.1) — is what makes
  replay harmless, including a 20-hour-old provider retry. **Any RPC error ⇒
  `5xx`** so the provider retries — fails *closed*, the deliberate inverse of
  `IngressDedupeStore.claim()` (`D11`). Say so in a comment at the call site; the
  next reader will otherwise "fix" it to match ingress.
  - **Do not write `from('payment_events').insert(...)` in this route, ever.**
    Two `supabase-js` calls are two transactions (see global constraints), which
    breaks 9.3a while looking like it satisfies it.
- [ ] **9.3a** **The claim and the apply are one transaction, so a retryable
  failure never consumes the claim.** This is the rule that keeps the provider's
  24-hour retry window usable — and the *reason* it is one database function:

  ```text
  supabase.rpc('process_payment_event', …)
  └─ BEGIN
       claim event            -- INSERT … ON CONFLICT DO NOTHING
       apply event            -- guards, ledger, subscription, plan_id, audit
     COMMIT                   -- 200
  ```

  On a transient failure: `ROLLBACK` ⇒ the claim row vanishes ⇒ return `5xx` ⇒ the
  provider redelivers and the next attempt claims cleanly. **Never `COMMIT` a
  claim whose apply did not succeed and then answer `200`** — that combination is
  permanent data loss dressed as success:

  ```text
  claim committed + 200 returned
      → provider never retries
      → redelivery (if any) hits ON CONFLICT DO NOTHING
      → treated as already_processed
      → the event can never be applied
  ```

  Only a provably terminal outcome may be committed with a `200`: `ignored`
  (environment mismatch, stale, manual billing, illegal transition — all decided
  deliberately by the RPC) or `failed_terminal` (uninterpretable signed event).
  Everything else is a `5xx` with nothing left behind.
- [ ] **9.3b** **Response taxonomy — write it as a single `switch`, not scattered
  returns.** The distinction between "we decided not to act" and "we failed to
  act" is the whole operational contract:
  | Situation | HTTP | Persisted |
  | --- | --- | --- |
  | signature invalid / secret absent | `401` | nothing (9.2) |
  | route provider ≠ configured provider, or provider unset | `404` + internal alert (9.6) | nothing |
  | valid signature, unsupported/uninterpretable event type | `200` | `failed_terminal` |
  | valid signature, deliberate no-op (wrong env, stale, manual billing, illegal transition) | `200` | `ignored` + reason |
  | duplicate delivery (same `event_id`) | `200 already_processed` | pre-existing row only |
  | duplicate money effect (new `event_id`, already-ledgered `provider_ref`) | `200` | `ignored` + `already_applied` (4.2.7a) |
  | applied | `200` | `applied` |
  | transient DB/provider failure, or unresolved tenant | `5xx` | nothing (rolled back) |

  `failed_terminal` + `200` for an unsupported-but-signed event is deliberate:
  the provider must stop retrying something we can never interpret. It is **not**
  a bucket for "we could not do it right now" — that is always the `5xx` row.
- [ ] **9.4** Resolve tenant **from our own rows only**, in this order:
  `subscriptions.provider_ref` → `checkout_intents.provider_ref` (the crash-window
  fallback from 7.6) → the verified correlation locator
  `notes.auxelon_checkout_intent` matched against `checkout_intents.id` under the
  seven conditions of 4.1b step 2b. All three resolve through a row **we** wrote;
  the third differs only in how the row is found, not in where authority comes
  from. If the payload carries `metadata.account_id` — or any other direct tenant
  claim — and it disagrees with the resolved mapping, apply nothing and alert: a
  payload field naming an account is evidence of intent, never authority (`F3`,
  attack A4).
- [ ] **9.4a** **An unresolved tenant is a retryable failure, not a terminal
  one.** If neither mapping matches, `ROLLBACK` (releasing the claim), **alert**,
  and return `5xx`. Do **not** persist `failed` + `200`: the mapping may become
  available moments later (a concurrent checkout still committing, a replica
  catching up), and a `200` permanently forfeits the provider's redelivery — the
  only mechanism that would have recovered a real paying customer. Never guess a
  tenant to make the `200` possible. If redelivery is still unresolved when the
  provider's retry budget expires, Task 10.6's orphan incident is the human path.
- [ ] **9.5** Call `processPaymentEvent` (the single RPC wrapper), passing the
  **configured** environment from `paymentsEnvironment()` as `p_environment`
  alongside the event's observed environment (4.1c) — the database cannot read
  `PAYMENTS_ENVIRONMENT`, so this route is one of the two trusted places that
  value comes from. Map its outcome
  through the 9.3b table — `200` on applied/already_processed/ignored/
  failed_terminal, `5xx` on any throw.
- [ ] **9.6** Unknown provider in `[provider]` ⇒ `404`. Provider not configured
  ⇒ `404` (not `503` — an unconfigured webhook endpoint should not confirm it
  exists). **But `404` externally must not mean invisible internally:** emit a
  metric/alert when *real provider traffic* reaches an unconfigured endpoint.
  Otherwise someone wires live Razorpay at an environment where
  `PAYMENTS_PROVIDER` is unset and we silently discard paid customers' events
  with a clean-looking `404` and no signal that money is being dropped.
- [ ] **9.7** Log `event_id`, `account_id`, `status`, `ignored_reason`, and — on a
  previous-secret match (5.1a) — the matched secret slot (`"current" | "previous"`)
  as a structured line, e.g. `billing.webhook.signature_verified
  secret_slot=previous provider=razorpay environment=live`. **Never** the payload,
  the secret itself, or payment-instrument data (`F7`).
- [ ] **9.8** **Stay inside Razorpay's 5-second response budget** (see global
  constraints). Razorpay resends an event when the endpoint does not answer in
  time, so a slow handler manufactures duplicates that then have to be absorbed by
  4.2.7a. The whole handler is: read body → verify → normalize → **one** RPC →
  respond.

  ```text
  No provider API call inside webhook processing.
  No reconciliation inside webhook processing.
  No unbounded query.
  One RPC.
  ```

  Repairs that need a provider round-trip belong to the Task 10 cron, never here.

## Task 10 — `/api/cron/billing-reconcile` (`D13`, `D14`)

- [ ] **10.1** `authorizeCronRequest` + `cronAuthEnv()`, same as
  `/api/flows/cron`.
- [ ] **10.2** Page through non-terminal subscriptions with a **cursor and a hard
  per-run cap** (≤ 20 provider calls) — Workers allows 50 subrequests and 10 ms
  CPU per invocation. An unbounded reconcile loop reconciles nothing.
- [ ] **10.3** For each: `fetchSubscription`, then apply drift through the same
  RPC with a synthetic `event_id` so reconciliation is itself idempotent. It is
  the **second** trusted caller of 4.1c, so it passes `p_environment` from
  `paymentsEnvironment()` and `p_event_environment` as the environment of the
  credential set it used to read the provider API — the two are equal in a
  correctly configured deployment, and the gate exists to catch the case where
  they are not. **The
  synthetic id must key on the observed provider state, not on the calendar day:**

  ```text
  reconcile:<provider>:<environment>:<provider_ref>:<provider_state_version>
  ```

  falling back, where the provider exposes no version, to a digest of the
  materially relevant observed fields:

  ```text
  reconcile:<provider>:<environment>:<provider_ref>:<state_digest>
  ```

  `reconcile:<ref>:<date>` is wrong because two real transitions can happen to one
  subscription on one day —

  ```text
  10:00  provider reports active     → applied
  15:00  provider reports past_due   → same synthetic id
                                      → ON CONFLICT DO NOTHING
                                      → silently "already processed"
  ```

  — so the second, entitlement-relevant observation is discarded. Keying on
  `provider_state_version`/`state_digest` makes **each materially different
  observed state** its own idempotent event, which is exactly the provider-resource
  -state hierarchy declared in the global constraints. Re-observing an *unchanged*
  state still collapses to one row, which is the deduplication we actually wanted.
- [ ] **10.4** Expire grace: `past_due` with `grace_until < now()` ⇒ move to the
  `is_default` plan. **Delete no data** (`D13`). This is the one **local
  billing-policy transition** the reconciliation path is permitted to compute (see
  the goal statement): it is driven by our clock, not by a fresh provider read, so
  it is legal only under the bounds stated there — the provider-read status must be
  `past_due`, the move is **downward to the default plan only**, and it is applied
  through the same RPC, audit row, and environment gate as a webhook.
- [ ] **10.5** Skip `billing_mode = 'manual'` accounts entirely (`D16`).
- [ ] **10.6** **Surface orphans explicitly; never adopt them — but only after
  every local resolution path has failed.** A provider subscription is an orphan
  only when **all three** authoritative local lookups miss:

  1. `public.subscriptions` on `(provider, environment, provider_ref)`;
  2. `public.checkout_intents` on `(provider, environment, provider_ref)`;
  3. the **verified correlation locator** — `notes.auxelon_checkout_intent`
     (Task 5.3a-i) resolving to an existing `public.checkout_intents` row that
     satisfies all of the 4.1b step 2b conditions.

  Path 3 is not optional politeness: it is precisely the crash window where the
  provider object exists but `provider_ref` was never written locally, so paths 1
  and 2 **miss by construction**. Declaring an orphan without checking it would
  alert on a subscription we can legitimately recover:

  ```text
  provider_ref not found locally
        ↓
  notes.auxelon_checkout_intent → existing intent → account_id
        ↓
  valid repair, NOT an orphan
  ```

  Only when all three miss: record `ORPHAN_PROVIDER_SUBSCRIPTION`, increment
  `billing_reconciliation_state.orphans_seen`, and **alert**. Do **not**
  auto-create a tenant mapping from an unknown provider resource — that is a
  tenant assignment invented from external data, exactly what `F3` forbids. Note
  the asymmetry that keeps this safe: path 3 resolves to an account **only through
  a row we wrote ourselves**, so a forged note points at nothing. An orphan is a
  human-resolved incident (a real customer we cannot identify), and it must be
  loud rather than quietly healed into the wrong account.

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
| **A6** | Replay the same `subscription.charged` 50× in parallel | Read-then-write race double-applies | **Event-level** idempotency: `UNIQUE (provider, environment, event_id)` claim + `SELECT … FOR UPDATE` (`D11`). Effect-level idempotency for a *different* event id on the same money resource is A35's job | `duplicate_event_applies_once` |
| **A7** | Two concurrent checkouts ⇒ **two real provider subscriptions**, two charges | "Check for an existing subscription, then create" in two statements; and a `subscriptions`-only constraint that fires *after* the provider already charged twice | **Primary:** partial unique index on `checkout_intents (account_id) WHERE status IN ('created','provider_attached')` — the loser reuses/409s **before** the provider is called (Task 1.2, Task 7.6 step 0). **Backstop:** partial unique index on `subscriptions (account_id) WHERE status IN ('active','past_due')` | `concurrent_checkouts_create_one_provider_subscription`, `one_live_subscription_per_account` |
| **A8** | Replay an old `activated` event after cancelling | Last-write-wins | Monotonic `last_event_at` guard (`D12`) | `stale_event_is_ignored` |
| **A9** | Force `expired → active` with a crafted sequence | Permissive switch/default branch | Total transition table; illegal ⇒ recorded, not applied (`D10`) | `illegal_transition_rejected` |
| **A10** | Valid signature, tampered body (amount raised) | HMAC computed over re-serialised JSON | HMAC over the **raw** body before parse (`F2`) | `mutated_body_fails_signature` |
| **A11** | Point our webhook at the provider's **test** environment and pay ₹1 | One secret, no environment tag | `provider` column + separate secrets per env; test-mode events rejected in prod | `test_mode_event_rejected_in_prod` |
| **A12** | Upgrade, then chargeback, and assume the dispute alone silently settles entitlement either way | Money event conflated with lifecycle event | Chargeback always writes a negative ledger row; status/entitlement is untouched unless the provider emits a lifecycle event (`D8`) | `chargeback_is_recorded_without_implicit_entitlement_change` |
| **A13** | Buy a plan that is `is_active = false` or price `NULL` (hidden/legacy tier) | Only the UI hides it | Server rejects inactive/unpriced plans (`D5`) | `inactive_plan_rejected` |
| **A14** | Downgrade an enterprise tenant with one forged/stale event | Payments own `plan_id` unconditionally | `billing_mode='manual'` short-circuit (`D16`) | `manual_account_never_auto_downgraded` |
| **A15** | Downgrade a tenant holding `unlimited_all` override | Plan overwrites overrides | Overrides always win; payments never write them (`F5`) | `override_survives_downgrade` |
| **A16** | Timing-attack the signature comparison | `===` on secrets | `timingSafeEqual` on equal-length buffers (`F2`) | `verify_uses_constant_time_comparison` |
| **A17** | Flood checkout to burn provider quota / spam the merchant account | No rate limit on money endpoints | `RATE_LIMITS.BILLING_CHECKOUT` per `account_id` (`F4`) | `checkout_is_rate_limited` |
| **A18** | Flood the webhook with garbage to exhaust the Workers CPU/request budget | Verification after parse | Verify before parse, body cap, `404` on unknown provider | `oversized_body_rejected` |
| **A19** | Read another tenant's amounts via the usage/billing API | Missing `account_id` filter | RLS `SELECT`-only + `accountId` scoping (`F9`) | `cross_tenant_ledger_read_blocked` |
| **A20** | Trigger a `5xx` mid-apply to leave `subscriptions.active` + `plan_id = free` (or the reverse) | Multi-statement write without a transaction | One RPC, one transaction, rollback on error (`D15`) | `partial_apply_rolls_back` |
| **A21** | Make the first apply fail transiently, then let the provider retry — a paying customer never gets access | Claim committed + `200` burns the retry, and every redelivery reads as `already_processed` | Claim and apply share one transaction; rollback releases the claim; `5xx` on anything not provably terminal (Task 9.3a) | `retryable_failure_releases_claim` |
| **A22** | Kill the checkout request after the provider created the subscription, then pay | Webhook's `provider_ref` matches no `subscriptions` row, so the RPC has nothing to lock | Intent-first write + `ensure_subscription_for_event` reconstructs from `checkout_intents` in the same transaction (Task 4.1b) | `subscription_reconstructed_from_intent` |
| **A23** | Present an active provider subscription we have no intent for, hoping reconstruction adopts it | Repair path used as an adoption path | Reconstruction requires *our* intent row; otherwise orphan alert, no mapping created (Task 10.6, `F3`) | `orphan_is_never_adopted` |
| **A24** | Run test-mode reconciliation to drag the live cursor / mix live and test cursors | One cursor row per provider | `billing_reconciliation_state` PK is `(provider, environment)` (Task 1.3) | `reconcile_cursor_is_per_environment` |
| **A25** | Deploy with `PAYMENTS_PROVIDER` set and `PAYMENTS_ENVIRONMENT` absent/garbage, hoping it defaults to `live` (or to `test` against live credentials) | Environment inferred or defaulted | Invalid/absent environment ⇒ Noop, never a default (Task 6.1a) | `invalid_environment_yields_noop` |
| **A26** | Chargeback, then keep using the product after the provider halts the subscription | Only the money half of a dispute is handled | The provider's halt/cancel lifecycle event revokes entitlement through the same RPC — the other half of A12's rule | `provider_halted_after_chargeback_revokes_entitlement` |
| **A27** | Force the apply to fail *after* the claim by racing a DB error, then check whether the event was recorded | Claim and apply in two `supabase-js` calls = two transactions | Claim lives inside `process_payment_event`; rollback leaves **zero** `payment_events` rows (Task 4.0/4.2) | `claim_and_apply_share_one_transaction` |
| **A28** | Put a *guessed or stolen* intent UUID in `notes.auxelon_checkout_intent` to attach a provider subscription to a victim's intent | Correlation metadata treated as authority, or bound without checks | Bind requires all seven conditions of 4.1b step 2b: verified signature, existing intent, matching provider **and** environment, open status, and `provider_ref` NULL-or-equal (never overwritten); `account_id` still comes from the intent row | `correlation_note_cannot_rebind_a_bound_intent`, `correlation_note_for_unknown_intent_is_rejected` |
| **A29** | Send `notes.account_id` (or any account-naming field) hoping the locator relaxation also relaxed this | "Metadata is allowed now" read too broadly | A note may only *locate* one of our own intents; naming an account is still forbidden outright (`F3`, 5.3a-i) | `note_cannot_name_an_account` |
| **A30** | Deliver a test-mode event to a live deployment whose RPC decides the environment from the event itself | Environment gate compares the event against the event | `p_environment` is a trusted parameter from `paymentsEnvironment()`, distinct from `p_event_environment` (4.1c); mismatch ⇒ `ignored`, absent/invalid trusted value ⇒ exception | `rpc_rejects_event_environment_mismatch`, `rpc_refuses_missing_configured_environment` |
| **A31** | Strip `x-razorpay-event-id` so a fabricated id is synthesised and every delivery applies again | `event_id` synthesised from the payload or `now()` when the header is missing | `event_id` is the **provider-supplied** `x-razorpay-event-id` header — not authenticated by the HMAC, which covers the raw body, so it is event identity/dedupe only; absent/empty ⇒ `401`, never a fabricated fallback (5.1 step 5), and effect-level fences cover the rest (A35) | `missing_event_id_header_is_rejected` |
| **A32** | Deliver a test-mode event to a live deployment purely to make it **reconstruct a `subscriptions` row** before it is ignored — a billing-state write from an event with no authority | Environment gate placed *after* subscription resolution/reconstruction | Gate is 4.2 step **2**, ahead of resolution: a wrong-environment event commits only the `payment_events` forensic row — no reconstruction, no plan lookup, no ledger | `wrong_environment_event_creates_no_subscription_row` |
| **A33** | Send `quantity: 100` (or a per-seat field) in the checkout body, or get it plumbed through a "completeness" refactor, to multiply the plan amount | Provider field passed through from the request | Strict `zod` schema rejects unknown keys (`F1`) **and** the adapter pins `quantity: 1` server-side (5.3b-q); amount always resolved from our `plans` table | `checkout_body_rejects_quantity`, `adapter_always_sends_quantity_one` |
| **A34** | Sit on a valid provider subscription whose `provider_ref` we never persisted, so reconciliation alerts it as an orphan and a human "resolves" it into the wrong account | Orphan declared before the correlation locator is consulted | 10.6 requires **all three** lookups to miss — `subscriptions.provider_ref`, `checkout_intents.provider_ref`, and the verified correlation locator — before `ORPHAN_PROVIDER_SUBSCRIPTION` | `recoverable_subscription_is_not_reported_orphan` |
| **A35** | Replay a captured, validly signed body with a substituted `x-razorpay-event-id`, so the delivery claims a fresh identity | The HMAC covers the **body**, not the event-id header, so the event-level claim is bypassable by anyone holding a signed body (leaked log, TLS interception, insider) | Effect-level idempotency: `UNIQUE (provider, environment, provider_ref)` on `payment_transactions` — a key from inside the signed body — plus the `last_event_at` monotonic guard for entitlement; the conflict is classified `already_applied` + `200`, never a `5xx` (Task 4.2.7a). Defence in depth: source-IP allowlist against Razorpay's published webhook IPs, and a non-unique `payload_digest` anomaly alert on "same digest, new event id" | `replayed_body_with_new_event_id_has_no_duplicate_money_effect`, `ledger_conflict_is_already_applied_not_5xx` |

**A35's expected outcome, stated exactly** — the point is that verification is
*not* where this is stopped:

```text
same signed body + same event id        → already_processed (event claim)
same signed body + different event id   → NOT a signature failure; verifies fine
  → money effect blocked by payment_transactions provider-resource uniqueness
  → entitlement re-application is a no-op (identical values + monotonic guard)
  → outcome: ignored / already_applied, HTTP 200
  → payload_digest correlation emits an anomaly signal
never: UNIQUE (provider, environment, payload_digest)
```

Blast radius today is therefore a spurious `payment_events` row, **not** double
revenue — provided 4.2.7a classifies the ledger conflict correctly. The attack
also presupposes the attacker already holds a validly-signed body, which is why
the IP allowlist is cheap and worth having.

- [ ] **12.1** Write A1–A35 as tests. A red-team test that has never failed is
  documentation, not a test: **make each one fail first** by temporarily
  reverting its defense, then restore.
- [ ] **12.1a** **A16 is an implementation assertion, not a statistical one.** Do
  not attempt to prove constant-time execution from Vitest timings — a JIT, a
  noisy CI runner, and GC make that test flaky at best and meaningless at worst.
  Assert instead that `verify.ts` compares via `crypto.timingSafeEqual` on
  equal-length buffers (source assertion, like the Task 2.3 boundary test) and
  that a length-mismatched or mutated signature is rejected. Timing behaviour is
  a property of the primitive we chose; the test's job is to prove we chose it.
- [ ] **12.2** Record which attacks are **structurally** contained and why, using
  the right reason for each — the earlier draft mislabelled A6:
  - **A6** (parallel replay of the same event) is contained by the
    `UNIQUE (provider, environment, event_id)` claim plus `SELECT … FOR UPDATE`,
    **not** by the absence of seat quantities. It is a concurrency/idempotency
    defense and it is tested, not asserted away. A6 covers **event-level**
    idempotency only.
  - **A35** (same signed body, substituted event id) is the **effect-level**
    counterpart, and it is not contained by the event claim at all — the event id
    is outside the HMAC. It is contained by `payment_transactions`'
    provider-resource uniqueness plus the monotonic guard, with the conflict
    classified `already_applied` (Task 4.2.7a). Keep the two rows distinct: if
    A6's defense were the only one, A35 would pass.
  - **Quantity tampering** is the one that is structurally impossible: V1 has no
    seat quantity to tamper with (`D6`, ADR-008/D1). If seats are ever
    introduced, this line stops being true and needs its own attack row.
  - **A20 / A27** are contained by the single database transaction: claim and
    apply commit together or not at all, so no interleaving can produce a
    half-applied event (Task 4).
  - **A20's cross-service blast radius** is contained by `D15`: messaging never
    reads billing tables, so a billing outage cannot become a WhatsApp outage.
  - **A23** is contained because entitlement is only ever a projection onto the
    pre-existing `accounts.plan_id` mechanism; billing adds no second source of
    truth for access.

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

1. **Exactly two paths can change `accounts.plan_id`:** a signature-verified
   provider webhook, and the authenticated reconciliation cron applying
   provider-read state plus the explicitly defined local billing-policy
   transitions derived from it (grace expiry ⇒ default plan, Task 10.4 — downward
   only). Both go through the same RPC. **No client-influenced input — redirect,
   request body, header, or provider payload field — can change entitlement by any
   route.**
1a. **No signed event is ever silently acknowledged as processed when it was not
   applied.** A retryable failure leaves no claim behind (Task 9.3a), so every
   event either applies, is deliberately `ignored`, is `failed_terminal`, or
   stays redeliverable. An unresolved tenant is redeliverable and alerted, never
   a silent `200`.
   - This is deliberately **not** phrased as "no signed event is ever lost",
     which would be a guarantee we cannot make. Razorpay retries for only ~24 h
     and can disable a persistently failing webhook, so an event *can* stop being
     redeliverable through no action of ours. What we do guarantee is that such an
     event never disappears quietly: it surfaces as an explicit orphan incident
     for reconciliation (Task 10) or manual recovery once the provider's retry
     window closes. Detection and recovery are the guarantee; delivery is the
     provider's.
1b. **A crash between "provider created it" and "we recorded it" is recoverable,
   including when `provider_ref` was never persisted at all.** The webhook
   resolves through `checkout_intents.provider_ref`, or — when that column is
   still `NULL` because the process died first — through the verified correlation
   locator matched against `checkout_intents.id` (4.1b step 2b, 5.3a-i), and the
   RPC then reconstructs the missing `subscriptions` row. Provider metadata locates
   one of our rows; it never names a tenant, so refusing to invent a mapping for a
   provider resource we have no intent for still holds (Task 10.6).
1c. **The environment gate is decided by a value the event cannot influence, and it
   runs before any billing-state write.** The trusted configured environment is
   passed into `process_payment_event()` by the webhook route and the
   reconciliation cron (4.1c); a missing or invalid trusted value is an exception,
   not a default. The gate is 4.2 step 2 — ahead of subscription
   resolution/reconstruction — so a wrong-environment delivery commits the
   `payment_events` forensic row and **nothing else**: no `subscriptions` insert,
   no plan lookup, no ledger row (A32).
1d. **Amounts and quantities are server-decided.** `quantity` is pinned to `1` in
   the adapter and never accepted from a caller (5.3b-q); the charged amount is
   always resolved from our `plans` table (A33).
1e. **Duplicate money effects are impossible on data the provider actually
   signs.** No claim of replay safety rests on the unsigned
   `x-razorpay-event-id` header alone: the ledger's
   `UNIQUE (provider, environment, provider_ref)` — a key from inside the signed
   body — is what makes a second money row impossible, and its conflict is a
   deliberate `already_applied` + `200`, never a retry-burning `5xx`
   (Task 4.2.7a, A35). `payload_digest` remains non-unique and advisory.
2. A1–A35 all pass, and each has been observed failing without its defense.
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

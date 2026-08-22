-- ADR-009 / Task 1 — Payments & subscription billing: schema.
--
-- Additive only. No existing column is changed; `accounts` and `plans`
-- gain columns with defaults so a deployment with PAYMENTS_PROVIDER
-- unset behaves exactly as it does today (Definition of Done #5).
--
-- THE ONE INVARIANT THIS SCHEMA EXISTS TO ENFORCE
-- Entitlement (`accounts.plan_id`) may only move on state that
-- ORIGINATED WITH THE PROVIDER AND WAS VERIFIED — a signature-verified
-- webhook, or the reconciliation cron reading the provider API. The
-- transport is not the invariant; the provenance is. Both paths funnel
-- through `process_payment_event()` (next migration), which is the ONLY
-- writer of provider-derived billing state.
--
-- TWO TRUST BOUNDARIES, TWO CLASSES OF TABLE (do not conflate them):
--
--   Application-owned intent state ..... checkout_intents (incl. status),
--                                        subscriptions.cancel_request_*
--     Writer: the authenticated owner's request path, directly.
--     Meaning: "what the user ASKED FOR". Moves no entitlement.
--
--   Provider-derived billing state ..... payment_events, subscriptions
--                                        (status, cancel_at_period_end,
--                                        period fields), payment_transactions,
--                                        accounts.plan_id
--     Writer: process_payment_event() ONLY.
--     Meaning: "what the provider CONFIRMED".
--
-- A request-path write that touches a provider-derived column is a
-- review-blocking defect, which is why RLS below grants SELECT and
-- nothing else on every table here.
--
-- MONEY REPRESENTATION: integer minor units (paise) + an adjacent
-- `currency` column, always. No floats, no amount without its currency.
-- This matches the existing `plans.price_monthly` convention.
--
-- PROVIDER IDENTIFIER SCOPING: a provider reference is unique only
-- WITHIN one provider's one environment. Razorpay test-mode and
-- live-mode ids come from different id spaces with no cross-guarantee.
-- So every uniqueness constraint on a provider identifier here is a
-- THREE-column constraint `(provider, environment, <ref>)`, and every
-- internal foreign key points at our own surrogate UUID instead.

-- ---------------------------------------------------------------------
-- 1.2 checkout_intents — the LOCAL IDENTITY of a payment journey.
--
-- Created BEFORE the provider is ever called. This ordering closes the
-- plan's most serious failure mode:
--
--   provider creates a real subscription
--     → our process crashes before we INSERT anything
--     → the webhook arrives with a provider_ref matching no local row
--     → a PAYING CUSTOMER IS UNRESOLVABLE.
--
-- Declared first because `subscriptions.checkout_intent_id` references it.
-- ---------------------------------------------------------------------

create table if not exists public.checkout_intents (
  id uuid primary key default gen_random_uuid(),

  account_id uuid not null references public.accounts (id) on delete cascade,
  plan_id text not null references public.plans (id),
  interval text not null check (interval in ('monthly', 'yearly')),

  provider text not null,
  -- Explicit STORED column, never inferred by an adapter after the
  -- fact. The environment gate in process_payment_event() rejects on
  -- this value (attack A11: point our webhook at the provider's test
  -- mode and pay ₹1), and a gate can only reject on a first-class field.
  environment text not null check (environment in ('test', 'live')),

  -- The SERVER-RESOLVED price, frozen at intent time. This is the audit
  -- trail proving the charged amount came from our `plans` table and not
  -- from a client request body (F1 / attack A1).
  amount_minor integer not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  status text not null default 'created'
    check (status in ('created', 'provider_attached', 'completed', 'abandoned', 'failed')),

  provider_ref text,
  provider_customer_ref text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.checkout_intents is
  'ADR-009: the local identity of a payment journey, written BEFORE the provider is called. Application-owned intent state — the authenticated owner''s request path writes this directly, and it moves no entitlement. Resolves the tenant for a webhook whose provider_ref matches no subscriptions row, and `id` is the correlation locator echoed through provider `notes`.';

comment on column public.checkout_intents.amount_minor is
  'Server-resolved price in minor units, frozen at intent time. Never an amount supplied by a client (F1).';

comment on column public.checkout_intents.id is
  'Doubles as the provider idempotency-key input and as the correlation locator sent in provider metadata (notes.auxelon_checkout_intent). Uniqueness is ours and explicit, never a coarse hash of attributes.';

-- Second half of the tenant-resolution mapping (F3). A webhook that
-- cannot match subscriptions.provider_ref MUST still resolve here.
create unique index if not exists checkout_intents_provider_ref_key
  on public.checkout_intents (provider, environment, provider_ref)
  where provider_ref is not null;

-- THE REAL FIX FOR ATTACK A7 (two concurrent checkouts → two real
-- provider subscriptions → two charges).
--
-- The partial unique index on `subscriptions` below only rejects the
-- second ACTIVE row, which is far too late: by then the customer may
-- already hold two live Razorpay subscriptions and have been charged
-- twice, and no local constraint can undo a provider-side charge.
-- Duplicate provider-side subscriptions must be prevented BEFORE the
-- provider is called, and the only place to do that is here. Task 7
-- attempts the insert and lets THIS INDEX arbitrate — never
-- "check-then-insert", which is the exact race it exists to close.
create unique index if not exists checkout_intents_one_open_per_account
  on public.checkout_intents (account_id)
  where status in ('created', 'provider_attached');

comment on index public.checkout_intents_one_open_per_account is
  'At most one OPEN intent per account. Primary defense for attack A7: the losing concurrent checkout reuses or 409s BEFORE the provider is called, so a customer cannot end up with two live provider subscriptions and two charges.';

create index if not exists checkout_intents_account_status_idx
  on public.checkout_intents (account_id, status);

-- Sweep support for Task 10's abandoned-intent pass (7.8).
create index if not exists checkout_intents_open_created_idx
  on public.checkout_intents (created_at)
  where status in ('created', 'provider_attached');

-- ---------------------------------------------------------------------
-- 1.1 subscriptions
-- ---------------------------------------------------------------------

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),

  account_id uuid not null references public.accounts (id) on delete cascade,
  plan_id text not null references public.plans (id),

  provider text not null,
  environment text not null check (environment in ('test', 'live')),
  provider_ref text not null,

  -- OUR vocabulary, not the provider's. Razorpay says `cancelled`; the
  -- domain spelling is `canceled` and the provider's spelling never
  -- leaves the adapter's mapping table (Task 3.1a / 5.3d). A codebase
  -- carrying both spellings will eventually compare them.
  status text not null
    check (status in ('incomplete', 'active', 'past_due', 'canceled', 'expired')),

  interval text not null check (interval in ('monthly', 'yearly')),
  amount_minor integer not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  current_period_end timestamptz,

  -- PROVIDER-DERIVED. Only process_payment_event() writes this, once
  -- the provider confirms the cancellation. A handler that sets it from
  -- a user request is the defect the column split below exists to
  -- prevent.
  cancel_at_period_end boolean not null default false,

  -- Defensive monotonic guard for out-of-order delivery (D12, attack
  -- A8). Razorpay documents that events may arrive out of order.
  last_event_at timestamptz,

  -- APPLICATION-OWNED INTENT. The owner's DELETE request writes these
  -- directly (Task 8.2). Deliberately NOT `status`, NOT
  -- `cancel_at_period_end`, and NOT `plan_id`: pressing "Cancel" is a
  -- REQUEST, not provider-verified state. If the provider silently
  -- fails to honour it, reconciliation catches the divergence instead
  -- of us having already lied locally.
  cancel_request_status text
    check (cancel_request_status in ('requested', 'provider_accepted', 'failed')),
  cancel_requested_at timestamptz,

  -- Every subscription traces back to a local intent.
  checkout_intent_id uuid unique references public.checkout_intents (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The mapping that resolves tenant from event (F3). Three columns,
  -- not two: `(provider, provider_ref)` alone collides across a
  -- test/live or two-provider deployment.
  constraint subscriptions_provider_ref_key
    unique (provider, environment, provider_ref)
);

comment on table public.subscriptions is
  'ADR-009: provider-derived subscription state. status / cancel_at_period_end / period fields / plan_id are written ONLY by process_payment_event(); cancel_request_* are application-owned intent columns written by the owner''s cancel request. RLS grants SELECT only.';

comment on column public.subscriptions.status is
  'Domain vocabulary (canceled, not the provider''s cancelled). Provider lifecycle states are translated by the adapter''s total mapping table, which throws on anything unmapped.';

comment on column public.subscriptions.cancel_request_status is
  'APPLICATION-OWNED: what the user asked for. Written directly by the owner''s DELETE request. Never entitlement.';

comment on column public.subscriptions.cancel_at_period_end is
  'PROVIDER-DERIVED: what the provider confirmed. Written only by process_payment_event().';

comment on column public.subscriptions.last_event_at is
  'Defensive monotonic guard against out-of-order provider delivery (D12). A BACKSTOP, not the ordering mechanism — where the provider exposes an authoritative resource version the adapter prefers that.';

-- One live self-serve subscription per account, enforced by the
-- DATABASE rather than by application care (backstop for attack A7).
--
-- BUSINESS RULE, NOT A BILLING LAW: this is a V1 invariant (ADR-008/D1,
-- no seats). Provider migration or scheduled plan changes would need it
-- relaxed. Do not read it as universally true.
create unique index if not exists subscriptions_one_live_per_account
  on public.subscriptions (account_id)
  where status in ('active', 'past_due');

comment on index public.subscriptions_one_live_per_account is
  'One live self-serve subscription per account — a V1 business rule (ADR-008/D1, no seats), not a universal billing law. Backstop for A7; the primary defense is checkout_intents_one_open_per_account, which fires before the provider is called.';

create index if not exists subscriptions_account_idx
  on public.subscriptions (account_id);

-- Task 10 reconciliation pages through non-terminal subscriptions.
create index if not exists subscriptions_reconcile_idx
  on public.subscriptions (provider, environment, id)
  where status in ('incomplete', 'active', 'past_due');

-- ---------------------------------------------------------------------
-- 1.3 billing_reconciliation_state — durable cursor for Task 10.
--
-- Worker isolates are ephemeral: a cursor in a module-level variable
-- resets on every cold start, so the cron would re-scan from the
-- beginning forever and never reach the tail.
-- ---------------------------------------------------------------------

create table if not exists public.billing_reconciliation_state (
  provider text not null,
  environment text not null check (environment in ('test', 'live')),
  cursor text,
  last_run_at timestamptz,
  last_status text,
  orphans_seen integer not null default 0,
  updated_at timestamptz not null default now(),

  -- `provider` alone as the PK would be wrong for the same reason as
  -- the constraints above: Razorpay/test and Razorpay/live would share
  -- one cursor and one orphan counter, so a test-mode reconcile run
  -- would drag the live cursor into a different id space (attack A24).
  primary key (provider, environment)
);

comment on table public.billing_reconciliation_state is
  'ADR-009 Task 10: durable reconciliation cursor, keyed per (provider, environment) so a test-mode run can never drag the live cursor (A24). Operational state with no account_id — deliberately has NO member-readable RLS policy.';

-- ---------------------------------------------------------------------
-- 1.4 payment_events — an ACCEPTED-EVENT LEDGER, not an attempt log.
--
-- A row exists ONLY for a transaction that committed:
--
--   applied / ignored / failed_terminal .... committed, row persists
--   transient failure (DB error, provider
--   blip, unresolved tenant) .............. ROLLED BACK — no row at
--                                           all, 5xx, provider retries
--
-- There is deliberately NO `failed_retryable` status. Recording an
-- attempt is precisely what burns the idempotency claim and makes the
-- event permanently unrecoverable:
--
--   claim committed + 200 returned
--     → provider never retries
--     → any redelivery hits ON CONFLICT DO NOTHING
--     → reads as already_processed
--     → THE EVENT CAN NEVER BE APPLIED (attack A21)
--
-- Do not "complete" this table by adding that status.
-- ---------------------------------------------------------------------

create table if not exists public.payment_events (
  -- Surrogate row identity. Every internal FK points HERE, never at the
  -- provider's event_id string.
  id uuid primary key default gen_random_uuid(),

  provider text not null,
  environment text not null check (environment in ('test', 'live')),

  -- The PROVIDER's own event identifier. For Razorpay this is the
  -- `x-razorpay-event-id` request header, documented as unique per
  -- event and intended for deduplication — never a payload field, and
  -- never synthesised locally.
  --
  -- IT IS PROVIDER-SUPPLIED IDENTITY, NOT AUTHENTICATED DATA. Razorpay's
  -- HMAC covers the RAW REQUEST BODY; this header sits outside the
  -- signature base string. So the triple below deduplicates DELIVERIES,
  -- while duplicate money EFFECTS are fenced separately by
  -- payment_transactions' provider-resource uniqueness, whose key comes
  -- from INSIDE the signed body (attack A35).
  event_id text not null,

  -- The raw provider type alongside the normalised `kind`, so forensics
  -- can distinguish "we mapped it wrong" from "they sent something new".
  provider_event_type text,

  subscription_id uuid references public.subscriptions (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  kind text,

  status text not null check (status in ('applied', 'ignored', 'failed_terminal')),
  ignored_reason text,

  event_at timestamptz,
  received_at timestamptz not null default now(),

  -- DIGEST ONLY — never the raw payload (F7).
  --
  -- Deliberately NON-UNIQUE. This is an anomaly-detection and forensic
  -- correlation signal ("same digest, new event_id" ⇒ replay), not an
  -- authoritative identity. A UNIQUE constraint here would SILENTLY DROP
  -- A REAL BILLING EVENT: Razorpay's envelope carries a
  -- second-granularity created_at and a payload that is a snapshot of
  -- the entity, so two genuinely distinct events with an unchanged
  -- snapshot inside the same second produce an identical digest. In a
  -- revenue ledger, a dropped event is worse than an extra forensic row.
  payload_digest text,

  -- THE IDEMPOTENCY CLAIM. `event_id text primary key` would be wrong
  -- the moment a second provider or environment exists.
  constraint payment_events_provider_event_key
    unique (provider, environment, event_id)
);

comment on table public.payment_events is
  'ADR-009: accepted-event ledger. A row means "a transaction committed for this event" — applied, ignored, or failed_terminal. A transient failure leaves NO row (rolled back with the claim) so the provider redelivers. There is deliberately no failed_retryable status: persisting an attempt burns the claim and makes the event unrecoverable (A21).';

comment on column public.payment_events.event_id is
  'The provider''s own event id (Razorpay: the x-razorpay-event-id header). Provider-supplied identity, NOT authenticated — the HMAC covers the raw body only, so this dedupes deliveries while payment_transactions fences money effects (A35).';

comment on column public.payment_events.payload_digest is
  'Non-unique by design. Forensic/replay-correlation signal only. Never add UNIQUE here: two distinct events can share a digest, and dropping a real billing event is worse than an extra forensic row.';

comment on column public.payment_events.status is
  'failed_terminal is reserved for outcomes where retrying provably cannot help (a malformed-but-signed event we can never interpret). It is NOT for "we could not resolve the tenant yet" — that is a rollback and a 5xx.';

create index if not exists payment_events_account_idx
  on public.payment_events (account_id, received_at desc);

create index if not exists payment_events_subscription_idx
  on public.payment_events (subscription_id, received_at desc);

-- Supports the "same digest, new event_id" replay anomaly alert (A35).
create index if not exists payment_events_digest_idx
  on public.payment_events (provider, environment, payload_digest);

-- ---------------------------------------------------------------------
-- 1.5 payment_transactions — append-only money ledger (D8).
-- ---------------------------------------------------------------------

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),

  account_id uuid not null references public.accounts (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,

  provider text not null,
  environment text not null check (environment in ('test', 'live')),

  kind text not null check (kind in ('charge', 'refund', 'chargeback')),

  -- SIGNED minor units: a charge is positive, a refund/chargeback
  -- negative, so the ledger sums to the net position.
  amount_minor integer not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),

  provider_ref text not null,

  -- NOT NULL, deliberately. Every row here is created by
  -- process_payment_event() in the same transaction as the
  -- payment_events claim that caused it, so the causing event always
  -- exists. A nullable FK would be an escape hatch for an orphan money
  -- row with no provable provider origin — exactly what an auditable
  -- ledger exists to make impossible. A future manual adjustment gets
  -- its own synthetic payment_events row (provider = 'manual'), never a
  -- NULL here.
  payment_event_id uuid not null references public.payment_events (id),

  occurred_at timestamptz,
  created_at timestamptz not null default now(),

  -- THE MONEY-EFFECT IDEMPOTENCY FENCE, and it is load-bearing.
  --
  -- `provider_ref` is the provider's own payment/refund/chargeback id,
  -- which lives INSIDE THE SIGNED BODY — unlike event_id, which does
  -- not. It is therefore what actually stops a replayed signed body
  -- carrying a substituted x-razorpay-event-id from producing a second
  -- money row (attack A35), and it equally covers the provider's own
  -- documented at-least-once redeliveries.
  --
  -- Its conflict is classified DELIBERATELY as `already_applied` + 200
  -- by the RPC — never left to bubble as a generic DB error, which
  -- would burn Razorpay's 24-hour retry budget on an event that can
  -- never succeed.
  constraint payment_transactions_provider_ref_key
    unique (provider, environment, provider_ref),

  -- Sign discipline at the schema level, not by convention.
  constraint payment_transactions_amount_sign
    check (
      (kind = 'charge' and amount_minor >= 0)
      or (kind <> 'charge' and amount_minor <= 0)
    )
);

comment on table public.payment_transactions is
  'ADR-009 D8: append-only money ledger. UPDATE and DELETE raise via trigger. UNIQUE (provider, environment, provider_ref) is the money-effect idempotency fence — its key comes from inside the signed body, which is what makes it effective against a replayed body with a substituted event id (A35).';

comment on column public.payment_transactions.amount_minor is
  'Signed minor units: charge >= 0, refund/chargeback <= 0, enforced by check constraint.';

comment on column public.payment_transactions.payment_event_id is
  'NOT NULL deliberately: every money row is provably caused by a committed provider event. A manual adjustment gets a synthetic payment_events row rather than a NULL.';

create index if not exists payment_transactions_account_idx
  on public.payment_transactions (account_id, occurred_at desc);

create index if not exists payment_transactions_subscription_idx
  on public.payment_transactions (subscription_id, occurred_at desc);

-- Append-only is worthless if it is only a comment in a doc.
create or replace function public.payment_transactions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'payment_transactions is append-only (ADR-009 D8): % is not permitted. Corrections are new compensating rows (refund/chargeback), never edits.',
    tg_op;
end;
$$;

comment on function public.payment_transactions_append_only() is
  'Guard trigger enforcing the append-only money ledger (ADR-009 D8). Deliberately SECURITY INVOKER: it only ever raises, so it needs no elevated privilege.';

drop trigger if exists payment_transactions_append_only on public.payment_transactions;
create trigger payment_transactions_append_only
  before update or delete on public.payment_transactions
  for each row execute function public.payment_transactions_append_only();

-- ---------------------------------------------------------------------
-- 1.6 accounts: billing mode (D16) + grace window (D13)
-- ---------------------------------------------------------------------

alter table public.accounts
  add column if not exists billing_mode text not null default 'self_serve';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'accounts_billing_mode_check'
  ) then
    alter table public.accounts
      add constraint accounts_billing_mode_check
      check (billing_mode in ('self_serve', 'manual'));
  end if;
end;
$$;

alter table public.accounts
  add column if not exists grace_until timestamptz;

comment on column public.accounts.billing_mode is
  'ADR-009 D16. `manual` accounts are short-circuited by process_payment_event() and skipped by reconciliation: an enterprise tenant billed by invoice must never be downgraded by a forged or stale provider event (attack A14).';

comment on column public.accounts.grace_until is
  'ADR-009 D13. While set and in the future, a past_due account keeps access. Expiry is the ONE local billing-policy transition reconciliation may compute (Task 10.4) — downward to the default plan only, never upward.';

-- ---------------------------------------------------------------------
-- 1.7 plans: our tier id → provider plan id, per provider.
-- ---------------------------------------------------------------------

alter table public.plans
  add column if not exists provider_refs jsonb not null default '{}'::jsonb;

comment on column public.plans.provider_refs is
  'Our tier id → provider plan id, keyed by provider then environment, e.g. {"razorpay":{"live":"plan_ABC...","test":"plan_XYZ..."}}. process_payment_event() resolves plan_id by matching THIS column — never from a plan id in an event payload (F3).';

-- ---------------------------------------------------------------------
-- 1.8 RLS — SELECT only, for every table above.
--
-- Every write is service-role through process_payment_event() (or, for
-- application-owned intent columns, a server route using the admin
-- client). There are deliberately NO INSERT/UPDATE/DELETE policies at
-- all, matching the `plans` model: a tenant can READ its billing
-- history and can never write a byte of it.
--
-- `payment_events` and `billing_reconciliation_state` get NO
-- member-readable policy — internal forensics and operational state,
-- and the latter has no account_id to scope by.
-- ---------------------------------------------------------------------

alter table public.checkout_intents enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_reconciliation_state enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_transactions enable row level security;

drop policy if exists checkout_intents_select on public.checkout_intents;
create policy checkout_intents_select on public.checkout_intents
  for select to authenticated
  using (public.is_account_member(account_id));

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (public.is_account_member(account_id));

drop policy if exists payment_transactions_select on public.payment_transactions;
create policy payment_transactions_select on public.payment_transactions
  for select to authenticated
  using (public.is_account_member(account_id));

-- payment_events: RLS enabled, NO policies. Service-role only.
-- billing_reconciliation_state: RLS enabled, NO policies. Service-role only.

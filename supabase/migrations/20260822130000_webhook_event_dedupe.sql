-- Task 3 Step 1 (production-infrastructure plan) — webhook idempotency
-- (NFR-008: every externally retryable operation is idempotent).
--
-- Meta redelivers webhook events (slow acks, their retries, network
-- flaps). Without a dedupe ledger a redelivered inbound message is
-- re-processed end-to-end: duplicate message rows, duplicate flow
-- runs, duplicate AI auto-replies (double-texting the customer, twice
-- the provider spend).
--
-- The webhook flow becomes:
--   verify signature → INSERT ... ON CONFLICT DO NOTHING on event_id
--   → conflict = already processed → ack 200 and skip
--   → otherwise process exactly once.
--
-- event_id is the provider-unique message id (WhatsApp: wamid), which
-- Meta guarantees stable across redeliveries of the same event.
--
-- COST NOTE (free-tier): rows are tiny (id + uuid + timestamptz) and
-- TTL-cleaned opportunistically from the webhook route (no cron, no
-- extra infrastructure). The processed_at index below is what makes
-- that cleanup a cheap range delete.

create table if not exists public.webhook_events (
  -- Provider-unique event id. Primary key IS the idempotency guarantee:
  -- the second delivery's insert conflicts and is skipped.
  event_id text primary key,
  -- Owning tenant (resolved from whatsapp_config by phone_number_id
  -- before the claim). Kept for observability + scoped cleanup; not an
  -- FK so a deleted account can never make the hot ingest path fail.
  account_id uuid not null,
  processed_at timestamptz not null default now()
);

comment on table public.webhook_events is
  'Idempotency ledger for inbound webhook events (NFR-008). One row per processed provider event id; INSERT ... ON CONFLICT DO NOTHING is the dedupe claim. TTL-cleaned opportunistically by the webhook route.';

-- Range-delete support for the opportunistic TTL cleanup.
create index if not exists idx_webhook_events_processed_at
  on public.webhook_events (processed_at);

-- Service-role-only table: RLS on, deliberately NO policies. The only
-- writer/reader is the webhook route's admin client (bypasses RLS).
-- Tenants never query this ledger.
alter table public.webhook_events enable row level security;

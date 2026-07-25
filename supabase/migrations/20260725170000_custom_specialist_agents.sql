-- ============================================================
-- Custom specialist agents (2026 triage/router architecture)
--
-- The account keeps ONE default agent (kind='default') that owns the
-- master switch and both capability columns. Accounts can now ALSO
-- create custom specialist agents (kind='custom'): each has a name,
-- a routing description ("what this specialist handles"), its own
-- persona, and optionally its own provider/key/model (otherwise it
-- inherits the default agent's connection at runtime).
--
-- Incoming auto-reply traffic is triaged: a lightweight router step
-- classifies the customer message against the enabled specialists'
-- routing descriptions and hands off to the best one; the default
-- agent answers when nothing matches confidently (per 2026 best
-- practice: router stays routing-only, specialists stay narrow,
-- every routing decision is logged).
-- ============================================================

-- 1) Allow custom rows alongside the single default row.
alter table ai_agents drop constraint if exists ai_agents_kind_check;
alter table ai_agents
  add constraint ai_agents_kind_check check (kind in ('default', 'custom'));

-- Exactly one default agent per account; unlimited custom specialists.
-- The old UNIQUE(account_id, kind) would cap custom agents at one, and
-- the rebuild-era ai_agents_account_idx (UNIQUE on account_id alone)
-- would block ANY second row — both must go.
alter table ai_agents drop constraint if exists ai_agents_account_id_kind_key;
drop index if exists ai_agents_account_idx;
create unique index if not exists ai_agents_account_default_uniq
  on ai_agents (account_id) where (kind = 'default');

-- 2) Routing description — the router matches customer messages
--    against this ("Handles pricing, invoices and refund questions").
alter table ai_agents add column if not exists route_description text;

-- 3) Track which agent actually answered (router handoff target).
--    ai_usage_log.agent_id already exists from the rebuild migration.
create index if not exists idx_ai_agents_account_custom
  on ai_agents (account_id) where (kind = 'custom');

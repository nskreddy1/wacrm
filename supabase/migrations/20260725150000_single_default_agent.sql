-- ============================================================
-- Single default agent per account.
--
-- Product decision (2026-07-25): instead of two separate agents
-- (Support Copilot + Auto-Reply Agent), each account has ONE
-- default agent — one provider, API key, model, and persona —
-- with two independently toggleable capabilities, each in its
-- own column:
--   • suggestions_enabled — AI draft suggestions in the inbox
--   • autoreply_enabled   — automatic customer replies
--
-- Auto-reply behavior (cap, hours, handoff) stays in `settings`
-- jsonb; capability switches are first-class columns.
-- ============================================================

-- 1) Separate capability columns.
alter table ai_agents
  add column if not exists suggestions_enabled boolean not null default false,
  add column if not exists autoreply_enabled  boolean not null default false;

-- 2) Collapse any existing per-kind rows into one default row.
--    (Start-empty rebuild: nothing meaningful to merge — keep the
--    newest row per account, carrying its enablement into the
--    matching capability column.)
update ai_agents a
set suggestions_enabled = case when a.kind = 'copilot'  then a.is_enabled else a.suggestions_enabled end,
    autoreply_enabled   = case when a.kind = 'autoreply' then a.is_enabled else a.autoreply_enabled end;

delete from ai_agents a
using ai_agents b
where a.account_id = b.account_id
  and a.created_at < b.created_at;

-- 3) One row per account; `kind` no longer distinguishes rows.
--    Drop the old per-kind CHECK BEFORE rewriting values, otherwise
--    the update itself violates it.
alter table ai_agents drop constraint if exists ai_agents_kind_check;

update ai_agents set kind = 'default';

alter table ai_agents
  add constraint ai_agents_kind_check check (kind = 'default');

drop index if exists ai_agents_account_kind_idx;
create unique index if not exists ai_agents_account_idx
  on ai_agents (account_id);

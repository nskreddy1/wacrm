-- Auto-reply controls: limit basis + reply schedule.
--
-- auto_reply_limit_mode:
--   'per_conversation' — cap total bot replies per conversation (existing behaviour)
--   'per_day'          — cap bot replies per conversation per calendar day
--   'never'            — no cap; the bot always replies
--
-- auto_reply_schedule_start/end (local time in auto_reply_timezone):
--   both null  → reply at any time (default)
--   both set   → only auto-reply inside the window; overnight windows
--                (start > end, e.g. 20:00–06:00) are supported.
alter table public.ai_configs
  add column if not exists auto_reply_limit_mode text not null default 'per_conversation',
  add column if not exists auto_reply_schedule_start time null,
  add column if not exists auto_reply_schedule_end time null,
  add column if not exists auto_reply_timezone text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ai_configs_auto_reply_limit_mode_check'
  ) then
    alter table public.ai_configs
      add constraint ai_configs_auto_reply_limit_mode_check
      check (auto_reply_limit_mode in ('per_conversation', 'per_day', 'never'));
  end if;
end $$;

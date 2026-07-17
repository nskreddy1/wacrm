-- ============================================================
-- Platform-wide settings (key/value), service-role only.
--
-- First consumer: the `ai_engine` flag that switches the AI stack
-- between the direct fetch adapters and LangChain. Absence of a key
-- means "use the default" (for ai_engine: 'direct'), so this table
-- ships empty — no seed row.
-- ============================================================

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- RLS on with NO policies: regular users can never read or write
-- platform settings. Only the service-role client (which bypasses
-- RLS) touches this table, via the super-admin API route.
alter table public.platform_settings enable row level security;

comment on table public.platform_settings is
  'Platform-wide key/value settings (service-role only). Known keys: ai_engine ("direct" | "langchain").';

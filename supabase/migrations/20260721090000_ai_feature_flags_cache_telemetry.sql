-- ============================================================
-- AI feature flags + provider prompt-cache telemetry.
--
-- 1. ai_configs.feature_flags — per-account opt-in switches for AI
--    optimizations (first flag: "prompt_caching"). JSONB so later
--    flags (doc parsing, summaries, …) need no new migration.
--    Default '{}' = every optimization OFF (safe rollout).
--    Governed by the same RLS policies as the rest of ai_configs —
--    tenant-scoped, never readable across accounts.
--
-- 2. ai_usage_log.cached_tokens / cache_write_tokens — provider-
--    reported prompt-cache telemetry (OpenAI prompt_tokens_details.
--    cached_tokens, Anthropic cache_read_input_tokens /
--    cache_creation_input_tokens, Gemini cachedContentTokenCount).
--    Token COUNTS only — never prompt content (compliance: the log
--    stays free of message/PII data).
-- ============================================================

alter table public.ai_configs
  add column if not exists feature_flags jsonb not null default '{}'::jsonb;

comment on column public.ai_configs.feature_flags is
  'Per-account AI optimization opt-ins, e.g. {"prompt_caching": true}. Defaults empty = all off.';

alter table public.ai_usage_log
  add column if not exists cached_tokens integer,
  add column if not exists cache_write_tokens integer;

comment on column public.ai_usage_log.cached_tokens is
  'Provider-reported cached (discounted) prompt tokens for this call; null when the provider did not report.';
comment on column public.ai_usage_log.cache_write_tokens is
  'Provider-reported cache-write tokens (Anthropic cache_creation_input_tokens); null elsewhere.';

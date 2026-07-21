-- ============================================================
-- Provider prompt-cache telemetry.
--
-- ai_usage_log.cached_tokens / cache_write_tokens — provider-
-- reported prompt-cache telemetry (OpenAI prompt_tokens_details.
-- cached_tokens, Anthropic cache_read_input_tokens /
-- cache_creation_input_tokens, Gemini cachedContentTokenCount).
-- Token COUNTS only — never prompt content (compliance: the log
-- stays free of message/PII data).
--
-- Note: an earlier revision of this migration also added
-- ai_configs.feature_flags for a per-account "prompt_caching"
-- opt-in. The cache-aligned prompt was benchmarked, won, and was
-- promoted to the ONLY code path, so the flag (and its column)
-- were removed again — see the drop below, which also cleans up
-- databases that ran the earlier revision.
-- ============================================================

alter table public.ai_usage_log
  add column if not exists cached_tokens integer,
  add column if not exists cache_write_tokens integer;

comment on column public.ai_usage_log.cached_tokens is
  'Provider-reported cached (discounted) prompt tokens for this call; null when the provider did not report.';
comment on column public.ai_usage_log.cache_write_tokens is
  'Provider-reported cache-write tokens (Anthropic cache_creation_input_tokens); null elsewhere.';

-- Remove the retired per-account flag column (no-op on fresh DBs).
alter table public.ai_configs
  drop column if exists feature_flags;

-- Remove the retired platform kill-switch row, if one was ever set.
delete from public.platform_settings where key = 'ai_disabled_features';

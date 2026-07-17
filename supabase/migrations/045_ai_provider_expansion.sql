-- ============================================================
-- 045: expand AI providers (OpenAI-compatible presets, Ollama,
--      custom endpoints) and add ai_configs.base_url.
--
-- The application code (src/lib/ai/types.ts) supports twelve
-- providers and a per-account OpenAI-compatible base URL, but the
-- schema stopped at 042's openai/anthropic/gemini and never gained
-- the base_url column — so GET /api/ai/config 500s selecting it.
--
--   1. ai_configs.base_url — OpenAI-compatible endpoint override.
--      Required for 'custom', optional for 'ollama' (falls back to
--      OLLAMA_BASE_URL / the local daemon), unused by presets.
--   2. Provider CHECKs widened on ai_configs and ai_usage_log to
--      match AI_PROVIDERS in src/lib/ai/types.ts.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS base_url text;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN (
    'openai', 'anthropic', 'gemini',
    'nvidia', 'groq', 'openrouter', 'together',
    'mistral', 'deepseek', 'xai',
    'ollama', 'custom'
  ));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN (
    'openai', 'anthropic', 'gemini',
    'nvidia', 'groq', 'openrouter', 'together',
    'mistral', 'deepseek', 'xai',
    'ollama', 'custom'
  ));

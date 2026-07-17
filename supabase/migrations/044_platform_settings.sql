-- ============================================================
-- 044_platform_settings.sql — platform-wide settings key/value
-- store (service-role only).
--
-- First use: the `ai_engine` flag that switches the AI stack
-- between the LangChain engine and the direct fetch adapters
-- (see src/lib/ai/engine-flag.ts). Absence of a key means "use
-- the code default" — no seed rows.
--
-- RLS is enabled with NO policies on purpose: regular users never
-- read or write platform settings; all access goes through the
-- service-role client (which bypasses RLS).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

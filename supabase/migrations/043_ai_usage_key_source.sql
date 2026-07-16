-- 043: audit which key each AI call ran on.
--
-- Phase 1 of the enterprise auto-reply work (docs/ai-auto-reply.md):
-- accounts without a BYO key now fall back to the platform-wide
-- GEMINI_API_KEY. `key_source` distinguishes tenant spend on their own
-- key ('account') from spend on the shared env key ('env') so the
-- platform owner can audit / bill it.

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS key_source text NOT NULL DEFAULT 'account'
  CHECK (key_source IN ('account', 'env'));

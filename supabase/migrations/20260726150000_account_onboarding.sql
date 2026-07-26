-- ============================================================
-- 20260726150000 — ACCOUNT ONBOARDING STATE
--
-- One timestamp on the account, not a separate table: onboarding
-- is a one-way, once-per-workspace event, so a nullable column is
-- the whole state machine (NULL = show wizard, set = done).
--
-- Existing accounts are backfilled as onboarded — the wizard is
-- for NEW signups only; showing it to long-time workspaces after
-- a deploy would be a regression, not a feature.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

UPDATE accounts
SET onboarding_completed_at = NOW()
WHERE onboarding_completed_at IS NULL;

COMMENT ON COLUMN accounts.onboarding_completed_at IS
  'When the owner finished (or skipped) the first-run wizard. NULL = wizard still pending. Backfilled to NOW() for accounts predating the feature.';

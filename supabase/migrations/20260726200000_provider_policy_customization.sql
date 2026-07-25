-- ============================================================
-- Provider policy customization: operators can rename a provider
-- as tenants see it and pick a catalog icon. Pure presentation —
-- no security surface (no credentials, no tenant data).
-- ============================================================

ALTER TABLE platform_provider_policies
  ADD COLUMN IF NOT EXISTS display_label TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT;

-- Phase 0.2b: Platform-admin customizable plans.
--
-- Extends the seeded `plans` reference table so a super admin can
-- rename tiers, reprice them, toggle availability, reorder the public
-- pricing display, attach a marketing feature list, and create brand
-- new tiers — all without a deploy. Quota columns are unchanged; the
-- quota engine keeps reading the same limit columns.
--
-- Security model (unchanged from 20260726120000):
--  * Members can READ plans (to render their own usage page/pricing).
--  * All WRITES go through /api/admin/plans behind requireSuperAdmin()
--    using the service-role client. No RLS write policies exist.

-- ---------------------------------------------------------------------------
-- 1. Customization columns
-- ---------------------------------------------------------------------------
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS description TEXT,
  -- Prices are stored in minor units (paise for INR) to avoid float
  -- drift; NULL price = "contact us" tier. 0 = free.
  ADD COLUMN IF NOT EXISTS price_monthly INTEGER,
  ADD COLUMN IF NOT EXISTS price_yearly INTEGER,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR',
  -- Marketing bullet list rendered on pricing surfaces, e.g.
  -- ["Unlimited contacts", "Priority support"].
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Optional ribbon label, e.g. 'Most popular'.
  ADD COLUMN IF NOT EXISTS badge TEXT,
  -- Inactive plans are hidden from signup/pricing but keep serving
  -- accounts already on them (never strand a tenant).
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- The tier new accounts land on. Exactly one plan may be default.
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Enforce "at most one default plan" at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS plans_single_default
  ON plans ((TRUE)) WHERE is_default;

-- ---------------------------------------------------------------------------
-- 2. Seed customization for the three launch tiers (idempotent: only
--    fills values that are still at their column defaults).
-- ---------------------------------------------------------------------------
UPDATE plans SET
  description = 'For trying things out',
  price_monthly = 0,
  price_yearly = 0,
  features = '["500 contacts","1 channel","3 active flows","1,000 messages/month","50 AI replies/month"]'::jsonb,
  is_default = TRUE,
  sort_order = 0
WHERE id = 'free' AND price_monthly IS NULL;

UPDATE plans SET
  description = 'For growing businesses',
  price_monthly = 149900,
  price_yearly = 1499000,
  features = '["10,000 contacts","3 channels","25 active flows","20,000 messages/month","1,000 AI replies/month","Broadcasts up to 10,000 recipients"]'::jsonb,
  badge = 'Most popular',
  sort_order = 1
WHERE id = 'pro' AND price_monthly IS NULL;

UPDATE plans SET
  description = 'For teams at scale',
  price_monthly = 499900,
  price_yearly = 4999000,
  features = '["Unlimited contacts","10 channels","Unlimited flows","100,000 messages/month","10,000 AI replies/month","Priority support"]'::jsonb,
  sort_order = 2
WHERE id = 'ultra' AND price_monthly IS NULL;

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger (plans is now mutable from the admin console)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_plans_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS plans_updated_at ON plans;
CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION set_plans_updated_at();

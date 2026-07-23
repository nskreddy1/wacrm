-- ============================================================
-- 060 — Module field settings (Bigin-style "Customize Fields"
-- for the Appointments and Catalog modules).
--
--   - `module_field_settings` — per-account layout for a module's
--     record form: hidden standard fields + up to 10 custom fields
--     ({ hidden: [...], custom: [{id,label,type}] }), mirroring
--     deal_field_settings (which stays per-pipeline).
--   - `appointments.custom_values` / `catalog_items.custom_values`
--     — per-record values for those custom fields, keyed by the
--     custom field id (same model as deals.custom_values).
--
-- Account-sharing model from 017: account_id ownership +
-- is_account_member() RLS.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS module_field_settings (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  module      text NOT NULL CHECK (module IN ('appointments', 'catalog')),

  -- { hidden: ["location", ...], custom: [{id,label,type}] }
  layout      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (account_id, module)
);

ALTER TABLE module_field_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS module_field_settings_select ON module_field_settings;
CREATE POLICY module_field_settings_select ON module_field_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS module_field_settings_insert ON module_field_settings;
CREATE POLICY module_field_settings_insert ON module_field_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS module_field_settings_update ON module_field_settings;
CREATE POLICY module_field_settings_update ON module_field_settings FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS module_field_settings_delete ON module_field_settings;
CREATE POLICY module_field_settings_delete ON module_field_settings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Per-record values for the module custom fields.
ALTER TABLE appointments  ADD COLUMN IF NOT EXISTS custom_values jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS custom_values jsonb NOT NULL DEFAULT '{}'::jsonb;

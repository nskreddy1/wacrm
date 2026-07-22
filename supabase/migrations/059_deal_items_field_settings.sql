-- ============================================================
-- 059_deal_items_field_settings.sql — Deal line items + form layout
--
-- Backs the Bigin-style "Create Deal" sheet:
--
--   - `deal_items` — the "Associated Products" table on a deal. Each
--     row snapshots a catalog item (our Products = Catalog module)
--     with list price, quantity and discount so historical totals
--     survive later catalog price changes. catalog_item_id is
--     SET NULL on delete for the same reason.
--   - `deal_field_settings` — per-account, per-pipeline layout for
--     the deal form ("Customize Fields"): which fields show, their
--     order, and up to 10 custom fields (definition + per-deal values
--     live in the jsonb layout / deal custom values map).
--
-- Both follow the account-sharing model from 017: account_id
-- ownership + is_account_member() RLS.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- deal_items
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id          uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  catalog_item_id  uuid REFERENCES catalog_items(id) ON DELETE SET NULL,

  -- Snapshot of the catalog item at attach time.
  name             text NOT NULL,
  list_price       numeric(12,2) NOT NULL DEFAULT 0 CHECK (list_price >= 0),
  quantity         numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  discount_pct     numeric(5,2)  NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  position         integer NOT NULL DEFAULT 0,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_items_deal
  ON deal_items (deal_id, position);
CREATE INDEX IF NOT EXISTS idx_deal_items_account
  ON deal_items (account_id);

ALTER TABLE deal_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_items_select ON deal_items;
CREATE POLICY deal_items_select ON deal_items FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS deal_items_insert ON deal_items;
CREATE POLICY deal_items_insert ON deal_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_items_update ON deal_items;
CREATE POLICY deal_items_update ON deal_items FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_items_delete ON deal_items;
CREATE POLICY deal_items_delete ON deal_items FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- deal_field_settings (Customize Fields layout per pipeline)
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_field_settings (
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pipeline_id  uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,

  -- { used: ["title","company",...], unused: [...], custom: [{id,label,type}] }
  layout       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (account_id, pipeline_id)
);

ALTER TABLE deal_field_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_field_settings_select ON deal_field_settings;
CREATE POLICY deal_field_settings_select ON deal_field_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS deal_field_settings_upsert ON deal_field_settings;
CREATE POLICY deal_field_settings_upsert ON deal_field_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_field_settings_update ON deal_field_settings;
CREATE POLICY deal_field_settings_update ON deal_field_settings FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS deal_field_settings_delete ON deal_field_settings;
CREATE POLICY deal_field_settings_delete ON deal_field_settings FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Per-deal values for custom fields defined in deal_field_settings.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS custom_values jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Account-scoped pipeline workspace persistence. Intentionally unapplied.

ALTER TABLE pipelines
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS probability INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_source TEXT,
  ADD COLUMN IF NOT EXISTS last_activity TEXT,
  ADD COLUMN IF NOT EXISTS next_step TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_priority_check') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_priority_check CHECK (priority IN ('low', 'normal', 'high', 'hot'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_probability_check') THEN
    ALTER TABLE deals ADD CONSTRAINT deals_probability_check CHECK (probability BETWEEN 0 AND 100);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pipeline_saved_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort JSONB NOT NULL DEFAULT '{}'::jsonb,
  visible_fields TEXT[] NOT NULL DEFAULT '{}',
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, pipeline_id, name)
);

CREATE TABLE IF NOT EXISTS sub_pipelines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, pipeline_id, name)
);

CREATE TABLE IF NOT EXISTS sub_pipeline_deals (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sub_pipeline_id UUID NOT NULL REFERENCES sub_pipelines(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sub_pipeline_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_pipelines_account_position ON pipelines(account_id, position);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage_position ON deals(account_id, pipeline_id, stage_id, position);
CREATE INDEX IF NOT EXISTS idx_pipeline_saved_views_scope ON pipeline_saved_views(account_id, pipeline_id, position);
CREATE INDEX IF NOT EXISTS idx_sub_pipelines_scope ON sub_pipelines(account_id, pipeline_id, position);
CREATE INDEX IF NOT EXISTS idx_sub_pipeline_deals_scope ON sub_pipeline_deals(account_id, sub_pipeline_id, position);

ALTER TABLE pipeline_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_pipeline_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipeline_saved_views_select ON pipeline_saved_views;
DROP POLICY IF EXISTS pipeline_saved_views_insert ON pipeline_saved_views;
DROP POLICY IF EXISTS pipeline_saved_views_update ON pipeline_saved_views;
DROP POLICY IF EXISTS pipeline_saved_views_delete ON pipeline_saved_views;
CREATE POLICY pipeline_saved_views_select ON pipeline_saved_views FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pipeline_saved_views_insert ON pipeline_saved_views FOR INSERT WITH CHECK (is_account_member(account_id, 'agent') AND created_by = auth.uid());
CREATE POLICY pipeline_saved_views_update ON pipeline_saved_views FOR UPDATE USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY pipeline_saved_views_delete ON pipeline_saved_views FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS sub_pipelines_select ON sub_pipelines;
DROP POLICY IF EXISTS sub_pipelines_insert ON sub_pipelines;
DROP POLICY IF EXISTS sub_pipelines_update ON sub_pipelines;
DROP POLICY IF EXISTS sub_pipelines_delete ON sub_pipelines;
CREATE POLICY sub_pipelines_select ON sub_pipelines FOR SELECT USING (is_account_member(account_id));
CREATE POLICY sub_pipelines_insert ON sub_pipelines FOR INSERT WITH CHECK (is_account_member(account_id, 'agent') AND created_by = auth.uid());
CREATE POLICY sub_pipelines_update ON sub_pipelines FOR UPDATE USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY sub_pipelines_delete ON sub_pipelines FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS sub_pipeline_deals_select ON sub_pipeline_deals;
DROP POLICY IF EXISTS sub_pipeline_deals_insert ON sub_pipeline_deals;
DROP POLICY IF EXISTS sub_pipeline_deals_update ON sub_pipeline_deals;
DROP POLICY IF EXISTS sub_pipeline_deals_delete ON sub_pipeline_deals;
CREATE POLICY sub_pipeline_deals_select ON sub_pipeline_deals FOR SELECT USING (is_account_member(account_id));
CREATE POLICY sub_pipeline_deals_insert ON sub_pipeline_deals FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY sub_pipeline_deals_update ON sub_pipeline_deals FOR UPDATE USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY sub_pipeline_deals_delete ON sub_pipeline_deals FOR DELETE USING (is_account_member(account_id, 'agent'));

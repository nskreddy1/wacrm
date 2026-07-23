-- Per-user customizable dashboards (Zoho-style).
-- Each user can create multiple named dashboards; widgets are stored
-- as a jsonb array of { id, type, size, config } entries. The built-in
-- "Overview" dashboard is not stored here — it is the code default.

CREATE TABLE IF NOT EXISTS user_dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_dashboards_user
  ON user_dashboards (user_id, account_id, position);

ALTER TABLE user_dashboards ENABLE ROW LEVEL SECURITY;

-- Owner-only access: dashboards are personal to each user.
DROP POLICY IF EXISTS user_dashboards_select ON user_dashboards;
CREATE POLICY user_dashboards_select ON user_dashboards
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_dashboards_insert ON user_dashboards;
CREATE POLICY user_dashboards_insert ON user_dashboards
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_dashboards_update ON user_dashboards;
CREATE POLICY user_dashboards_update ON user_dashboards
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_dashboards_delete ON user_dashboards;
CREATE POLICY user_dashboards_delete ON user_dashboards
  FOR DELETE USING (user_id = auth.uid());

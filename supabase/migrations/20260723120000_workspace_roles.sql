-- ============================================================================
-- Workspace roles (custom RBAC layer)
-- ----------------------------------------------------------------------------
-- Two-layer role model (research: tenant-scoped roles, atomic permission
-- strings, assign roles not permissions):
--   Layer 1 — system roles: the existing `account_role_enum` on profiles
--     (owner/admin/agent/viewer). Still the source of truth for RLS and
--     baseline capability checks. Unchanged.
--   Layer 2 — workspace roles: named, account-scoped role definitions with
--     a permission list (e.g. 'contacts:edit', 'deals:delete'). A profile
--     may reference one via `workspace_role_id` for finer-grained,
--     admin-managed control. At 100+ members you edit the role once and
--     everyone holding it updates instantly.
-- System-seeded roles are flagged `is_system` and cannot be deleted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workspace_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description text NOT NULL DEFAULT '',
  -- Atomic "resource:action" permission keys. Checked by the backend /
  -- RLS helpers; the UI only reflects them.
  permissions text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workspace_roles_account
  ON workspace_roles (account_id);

-- Optional finer-grained role on top of the system role.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS workspace_role_id uuid
    REFERENCES workspace_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_workspace_role
  ON profiles (workspace_role_id)
  WHERE workspace_role_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS: members can read their workspace's roles; only admin+ can manage.
-- ---------------------------------------------------------------------------
ALTER TABLE workspace_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_roles_select ON workspace_roles;
CREATE POLICY workspace_roles_select ON workspace_roles
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS workspace_roles_insert ON workspace_roles;
CREATE POLICY workspace_roles_insert ON workspace_roles
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS workspace_roles_update ON workspace_roles;
CREATE POLICY workspace_roles_update ON workspace_roles
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- System roles are undeletable even by admins.
DROP POLICY IF EXISTS workspace_roles_delete ON workspace_roles;
CREATE POLICY workspace_roles_delete ON workspace_roles
  FOR DELETE USING (is_account_member(account_id, 'admin') AND NOT is_system);

-- ---------------------------------------------------------------------------
-- Seed system roles for every existing account (idempotent).
-- ---------------------------------------------------------------------------
INSERT INTO workspace_roles (account_id, name, description, permissions, is_system)
SELECT a.id, r.name, r.description, r.permissions, true
FROM accounts a
CROSS JOIN (
  VALUES
    ('Administrator', 'Full access to all records and settings.',
     ARRAY['contacts:*','deals:*','activities:*','broadcasts:*','settings:*','users:*']),
    ('Standard', 'Work with records; no workspace administration.',
     ARRAY['contacts:read','contacts:edit','deals:read','deals:edit','activities:read','activities:edit','broadcasts:read']),
    ('Read Only', 'View records without making changes.',
     ARRAY['contacts:read','deals:read','activities:read','broadcasts:read'])
) AS r(name, description, permissions)
ON CONFLICT (account_id, name) DO NOTHING;

-- Keep updated_at honest on edits.
CREATE OR REPLACE FUNCTION touch_workspace_roles_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspace_roles_touch ON workspace_roles;
CREATE TRIGGER trg_workspace_roles_touch
  BEFORE UPDATE ON workspace_roles
  FOR EACH ROW EXECUTE FUNCTION touch_workspace_roles_updated_at();

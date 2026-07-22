-- ============================================================
-- WORKSPACE ROLES (Bigin-style "Users and Controls > Roles")
--
-- Named, DB-backed roles that admins create/delete per workspace.
-- Design follows the standard SaaS RBAC pattern for scale (100+
-- users): users point at a role row (role_id FK) instead of
-- carrying per-user permission blobs — edit the role once and
-- everyone holding it updates.
--
--   * name + description        — what admins see in the Roles tab
--   * parent_role_id            — Bigin's "Reports to" hierarchy
--   * peer_visibility           — Bigin's "Peer Data Visibility"
--   * is_system                 — seeded roles that cannot be deleted
--
-- The base account_role_enum (owner/admin/agent/viewer) stays as
-- the coarse permission gate used by RLS; workspace roles refine
-- record VISIBILITY on top (who reports to whom), mirroring Bigin
-- where Profiles = permissions and Roles = visibility hierarchy.
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description TEXT CHECK (char_length(description) <= 500),
  parent_role_id UUID REFERENCES workspace_roles(id) ON DELETE SET NULL,
  peer_visibility BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workspace_roles_account
  ON workspace_roles(account_id);

ALTER TABLE workspace_roles ENABLE ROW LEVEL SECURITY;

-- Members can read their workspace's roles (needed to render the
-- Role column + pickers); only admin+ may write.
DROP POLICY IF EXISTS workspace_roles_select ON workspace_roles;
CREATE POLICY workspace_roles_select ON workspace_roles
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS workspace_roles_insert ON workspace_roles;
CREATE POLICY workspace_roles_insert ON workspace_roles
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.account_id = workspace_roles.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS workspace_roles_update ON workspace_roles;
CREATE POLICY workspace_roles_update ON workspace_roles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.account_id = workspace_roles.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

-- System roles are undeletable at the database level — the UI check
-- alone would leave the API open to direct-request deletes.
DROP POLICY IF EXISTS workspace_roles_delete ON workspace_roles;
CREATE POLICY workspace_roles_delete ON workspace_roles
  FOR DELETE USING (
    NOT is_system
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.account_id = workspace_roles.account_id
        AND p.account_role IN ('owner', 'admin')
    )
  );

-- Users hold at most one workspace role. ON DELETE SET NULL means
-- deleting a role never strands users — they fall back to their
-- base account_role permissions.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS workspace_role_id UUID
    REFERENCES workspace_roles(id) ON DELETE SET NULL;

-- Seed Bigin's default hierarchy (Level 1 → Level 2) for every
-- existing account, idempotently.
INSERT INTO workspace_roles (account_id, name, description, is_system)
SELECT a.id, 'Level 1', 'Top of the reporting hierarchy.', TRUE
FROM accounts a
ON CONFLICT (account_id, name) DO NOTHING;

INSERT INTO workspace_roles (account_id, name, description, parent_role_id, is_system)
SELECT a.id, 'Level 2', 'Reports to Level 1.', r1.id, TRUE
FROM accounts a
JOIN workspace_roles r1 ON r1.account_id = a.id AND r1.name = 'Level 1'
ON CONFLICT (account_id, name) DO NOTHING;

-- ============================================================
-- EMAIL-ADDRESSED INVITATIONS
--
-- The invite flow becomes person-addressed (Bigin's "Invite User"
-- sheet: first name, last name, email, role). The email is sent
-- via Supabase Auth's admin invite (free, same infra as our auth);
-- these columns record who the invite was for so the pending list
-- can show a real person instead of an anonymous link label.
-- ============================================================

ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS invited_email TEXT
    CHECK (invited_email IS NULL OR char_length(invited_email) <= 320),
  ADD COLUMN IF NOT EXISTS invited_first_name TEXT
    CHECK (invited_first_name IS NULL OR char_length(invited_first_name) <= 80),
  ADD COLUMN IF NOT EXISTS invited_last_name TEXT
    CHECK (invited_last_name IS NULL OR char_length(invited_last_name) <= 80),
  ADD COLUMN IF NOT EXISTS workspace_role_id UUID
    REFERENCES workspace_roles(id) ON DELETE SET NULL;

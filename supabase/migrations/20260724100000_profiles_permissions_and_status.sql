-- ============================================================
-- PERMISSION-BASED PROFILES + MEMBER STATUS (Zoho/Bigin model)
--
-- Replaces the coarse owner/admin/agent/viewer enum with
-- workspace_profiles: named permission sets ("Administrator",
-- "Standard", custom) holding permission slugs. Record
-- VISIBILITY stays on workspace_roles (the hierarchy tree);
-- feature PERMISSIONS now live here — the two Zoho axes.
--
-- Compatibility strategy: is_account_member(account_id, min_role)
-- keeps its exact signature but is redefined to read profile
-- permissions + status, so all ~200 existing RLS policy call
-- sites keep working without being touched.
--
-- PLATFORM TIER UNTOUCHED: profiles.is_super_admin,
-- is_platform_super_admin() and every /admin policy are NOT
-- modified by this migration. Platform-admin access is orthogonal
-- to workspace membership by design.
-- ============================================================

-- ------------------------------------------------------------
-- 1. workspace_profiles — named permission sets per account
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description TEXT CHECK (char_length(description) <= 500),
  -- Permission slugs, e.g. 'contacts:write', 'broadcasts:send',
  -- 'settings:manage'. See src/lib/auth/permissions.ts for the
  -- canonical catalog (kept in sync by the seed below).
  permissions TEXT[] NOT NULL DEFAULT '{}',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workspace_profiles_account
  ON workspace_profiles(account_id);

ALTER TABLE workspace_profiles ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. Member linkage + status on profiles
-- ------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS workspace_profile_id UUID
    REFERENCES workspace_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'deleted')),
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_account_status
  ON profiles(account_id, status);

-- Invitations carry the profile the new member will receive.
ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS workspace_profile_id UUID
    REFERENCES workspace_profiles(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3. Seed system profiles for every account (idempotent)
--
-- The slug list mirrors src/lib/auth/permissions.ts. Administrator
-- gets everything; Standard gets everything except Administration.
-- ------------------------------------------------------------
INSERT INTO workspace_profiles (account_id, name, description, permissions, is_system)
SELECT
  a.id,
  'Administrator',
  'This profile will have all the permissions. Users with Administrator profile will be able to view and manage all the data within the organization account by default.',
  ARRAY[
    'contacts:read','contacts:write','contacts:delete',
    'companies:read','companies:write','companies:delete',
    'deals:read','deals:write','deals:delete',
    'products:read','products:write','products:delete',
    'activities:read','activities:write','activities:delete',
    'messages:send','broadcasts:send','sms:send',
    'templates:manage','quick-replies:manage',
    'automations:manage','flows:manage','ai:manage',
    'data:import','data:export',
    'members:manage','settings:manage','channels:manage',
    'api-keys:manage','webhooks:manage'
  ],
  TRUE
FROM accounts a
ON CONFLICT (account_id, name) DO NOTHING;

INSERT INTO workspace_profiles (account_id, name, description, permissions, is_system)
SELECT
  a.id,
  'Standard',
  'This profile will have all the permissions except administrative privileges.',
  ARRAY[
    'contacts:read','contacts:write','contacts:delete',
    'companies:read','companies:write','companies:delete',
    'deals:read','deals:write','deals:delete',
    'products:read','products:write','products:delete',
    'activities:read','activities:write','activities:delete',
    'messages:send','broadcasts:send','sms:send',
    'templates:manage','quick-replies:manage',
    'automations:manage','flows:manage',
    'data:import','data:export'
  ],
  TRUE
FROM accounts a
ON CONFLICT (account_id, name) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Backfill: map old enum roles onto system profiles
--    owner/admin -> Administrator, agent/viewer -> Standard
-- ------------------------------------------------------------
UPDATE profiles p
SET workspace_profile_id = wp.id
FROM workspace_profiles wp
WHERE p.workspace_profile_id IS NULL
  AND p.account_id IS NOT NULL
  AND wp.account_id = p.account_id
  AND wp.name = CASE
    WHEN p.account_role IN ('owner', 'admin') THEN 'Administrator'
    ELSE 'Standard'
  END;

-- ------------------------------------------------------------
-- 5. Permission helper — the new primitive for policies
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_permission(
  target_account_id UUID,
  permission_slug TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    LEFT JOIN workspace_profiles wp ON wp.id = p.workspace_profile_id
    LEFT JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND p.status = 'active'
      AND (
        a.owner_user_id = auth.uid()            -- Super Admin bypasses
        OR permission_slug = ANY (wp.permissions)
      )
  );
$$;

ALTER FUNCTION has_permission(UUID, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION has_permission(UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. THE SHIM — redefine is_account_member with the same
--    signature so every existing policy keeps working.
--
--    viewer -> any ACTIVE member
--    agent  -> profile has any record-write permission
--    admin  -> profile has settings:manage
--    owner  -> accounts.owner_user_id (Super Admin)
--
--    Status gate: non-active members fail ALL tiers instantly.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    LEFT JOIN workspace_profiles wp ON wp.id = p.workspace_profile_id
    LEFT JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND p.status = 'active'
      AND CASE min_role
        WHEN 'viewer' THEN TRUE
        WHEN 'agent' THEN (
          a.owner_user_id = auth.uid()
          OR wp.permissions && ARRAY[
            'contacts:write','companies:write','deals:write',
            'products:write','activities:write','messages:send'
          ]
        )
        WHEN 'admin' THEN (
          a.owner_user_id = auth.uid()
          OR 'settings:manage' = ANY (wp.permissions)
        )
        WHEN 'owner' THEN a.owner_user_id = auth.uid()
      END
  );
$$;

-- ------------------------------------------------------------
-- 7. RLS for workspace_profiles (uses the shim it coexists with)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS workspace_profiles_select ON workspace_profiles;
CREATE POLICY workspace_profiles_select ON workspace_profiles
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS workspace_profiles_insert ON workspace_profiles;
CREATE POLICY workspace_profiles_insert ON workspace_profiles
  FOR INSERT WITH CHECK (
    NOT is_system AND is_account_member(account_id, 'admin')
  );

DROP POLICY IF EXISTS workspace_profiles_update ON workspace_profiles;
CREATE POLICY workspace_profiles_update ON workspace_profiles
  FOR UPDATE USING (
    NOT is_system AND is_account_member(account_id, 'admin')
  );

-- Deletable only when custom AND no member still points at it.
DROP POLICY IF EXISTS workspace_profiles_delete ON workspace_profiles;
CREATE POLICY workspace_profiles_delete ON workspace_profiles
  FOR DELETE USING (
    NOT is_system
    AND is_account_member(account_id, 'admin')
    AND NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_profile_id = workspace_profiles.id
    )
  );

-- ------------------------------------------------------------
-- 8. Fix workspace_roles policies to go through the shim too
--    (they previously open-coded p.id = auth.uid(), which was
--    wrong — profiles PK is not the auth uid — and read the
--    deprecated enum directly).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS workspace_roles_insert ON workspace_roles;
CREATE POLICY workspace_roles_insert ON workspace_roles
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS workspace_roles_update ON workspace_roles;
CREATE POLICY workspace_roles_update ON workspace_roles
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS workspace_roles_delete ON workspace_roles;
CREATE POLICY workspace_roles_delete ON workspace_roles
  FOR DELETE USING (
    NOT is_system AND is_account_member(account_id, 'admin')
  );

-- NOTE: profiles.account_role is now unread (shim + app use
-- workspace_profiles). Kept one release for rollback safety; a
-- follow-up migration will drop the column and enum type.

-- ============================================================
-- 055_super_admin.sql — Platform super-admin foundation
--
-- Introduces the *platform* role layer, orthogonal to workspace
-- roles (owner/admin/agent/viewer on profiles.account_role):
--
--   1. `profiles.is_super_admin` — DB-backed flag replacing the
--      env-only SUPER_ADMIN_EMAILS allowlist (env stays as an
--      OR-fallback during transition). Partial index keeps the
--      "is this user a super admin" probe O(1).
--   2. `is_platform_super_admin()` — SECURITY DEFINER helper for
--      RLS policies on cross-tenant tables (tickets, audit log).
--   3. `platform_audit_log` — immutable, insert-only record of
--      every super-admin mutation (actor, affected account,
--      action, before/after JSON). No UPDATE/DELETE policies
--      exist, so rows cannot be tampered with via PostgREST.
--   4. Bootstrap: flags admin@gmail.com as the initial super admin.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- 1. Platform role flag ---------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index: only super-admin rows are indexed (a handful of
-- rows at most), so lookups don't scan the whole profiles table.
CREATE INDEX IF NOT EXISTS idx_profiles_super_admin
  ON profiles(user_id)
  WHERE is_super_admin;

-- 2. RLS helper ------------------------------------------------
-- SECURITY DEFINER so policies can read profiles without recursive
-- RLS evaluation (same pattern as is_account_member from 017).
CREATE OR REPLACE FUNCTION is_platform_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid()
      AND is_super_admin
  );
$$;

ALTER FUNCTION is_platform_super_admin() OWNER TO postgres;

-- 3. Immutable platform audit log ------------------------------
CREATE TABLE IF NOT EXISTS platform_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Affected tenant; NULL for platform-wide actions (e.g. flags).
  account_id  UUID REFERENCES accounts(id) ON DELETE SET NULL,
  -- Machine-readable action key, e.g. 'member.role_changed',
  -- 'channel.credentials_updated', 'ticket.status_changed'.
  action      TEXT NOT NULL,
  -- Entity descriptor, e.g. 'profiles:<uuid>' or 'channel:whatsapp'.
  entity      TEXT NOT NULL,
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_log_recency
  ON platform_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_log_account
  ON platform_audit_log(account_id, created_at DESC);

ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;

-- Insert-only for super admins; SELECT for super admins.
-- Deliberately NO update/delete policies — the log is immutable.
DROP POLICY IF EXISTS "Super admins can insert audit entries" ON platform_audit_log;
CREATE POLICY "Super admins can insert audit entries" ON platform_audit_log
  FOR INSERT WITH CHECK (is_platform_super_admin() AND actor_id = auth.uid());

DROP POLICY IF EXISTS "Super admins can read audit entries" ON platform_audit_log;
CREATE POLICY "Super admins can read audit entries" ON platform_audit_log
  FOR SELECT USING (is_platform_super_admin());

-- 4. Bootstrap the initial super admin -------------------------
UPDATE profiles
SET is_super_admin = TRUE
WHERE email = 'admin@gmail.com'
  AND NOT is_super_admin;

-- ADR-004 D1: workspace membership join table.
--
-- Today membership is a single `profiles.account_id` pointer, so a user can
-- belong to exactly one workspace and accepting an invite MOVES them. This
-- table makes membership a set. `profiles.account_id` is NOT dropped: it
-- becomes the "active workspace" pointer (ADR-004 D3), so this migration is
-- purely additive and non-destructive.
--
-- Writes to this table go exclusively through SECURITY DEFINER RPCs
-- (ADR-004 D2/D3) — no INSERT/UPDATE/DELETE policies are created here.

CREATE TABLE IF NOT EXISTS account_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role account_role_enum NOT NULL DEFAULT 'viewer',
  -- Status vocabulary deliberately MATCHES profiles.status
  -- ('active','inactive','deleted') so the backfill below can carry the
  -- existing value across verbatim. Using a different vocabulary here (e.g.
  -- 'suspended') would force a lossy mapping and risk silently reactivating
  -- a deactivated user.
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'deleted')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, user_id)
);

-- "Which workspaces does this user belong to?" — the switcher's hot path.
CREATE INDEX IF NOT EXISTS idx_account_members_user
  ON account_members(user_id);

-- "Who is in this workspace?" — the members roster.
CREATE INDEX IF NOT EXISTS idx_account_members_account_status
  ON account_members(account_id, status);

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

-- Members may read the roster of workspaces they actively belong to.
-- Self-referential by design: membership in the row's account is what grants
-- visibility of that account's rows.
DROP POLICY IF EXISTS account_members_select ON account_members;
CREATE POLICY account_members_select ON account_members
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM account_members me
      WHERE me.account_id = account_members.account_id
        AND me.user_id = auth.uid()
        AND me.status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- Backfill (idempotent). Two sources, in this order:
-- ---------------------------------------------------------------------------

-- 1. Existing profile pointers. Carries status ACROSS rather than forcing
--    'active' — an inactive/deleted member must not be reactivated by this
--    migration. account_role is nullable on profiles, so COALESCE to the
--    least-privilege role rather than letting the NOT NULL constraint fail.
INSERT INTO account_members (account_id, user_id, role, status)
SELECT
  p.account_id,
  p.user_id,
  COALESCE(p.account_role, 'viewer'::account_role_enum),
  COALESCE(p.status, 'active')
FROM profiles p
WHERE p.account_id IS NOT NULL
ON CONFLICT (account_id, user_id) DO NOTHING;

-- 2. Account owners, from the authoritative denormalised column. The current
--    is_account_member() treats accounts.owner_user_id as always-owner
--    regardless of the profile row, so an owner whose profile has a NULL
--    account_id (or a lesser account_role) would otherwise be LOCKED OUT of
--    their own workspace once the membership table becomes authoritative.
INSERT INTO account_members (account_id, user_id, role, status)
SELECT a.id, a.owner_user_id, 'owner'::account_role_enum, 'active'
FROM accounts a
WHERE a.owner_user_id IS NOT NULL
ON CONFLICT (account_id, user_id) DO NOTHING;

-- Owners recorded with a lesser role by source 1 are promoted; the
-- authoritative accounts.owner_user_id wins. Also reactivates an owner whose
-- profile row was inactive, since locking an owner out of their own workspace
-- would leave it unadministrable.
UPDATE account_members m
SET role = 'owner'::account_role_enum, status = 'active'
FROM accounts a
WHERE m.account_id = a.id
  AND m.user_id = a.owner_user_id
  AND (m.role <> 'owner' OR m.status <> 'active');

-- ---------------------------------------------------------------------------
-- ADR-004 F6: an account must always retain at least one active owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_last_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner' AND OLD.status = 'active')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND OLD.status = 'active'
         AND (NEW.role <> 'owner' OR NEW.status <> 'active')) THEN
    IF NOT EXISTS (
      SELECT 1 FROM account_members
      WHERE account_id = OLD.account_id
        AND role = 'owner'
        AND status = 'active'
        AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'cannot remove or demote the last owner of account %',
        OLD.account_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_guard_last_owner ON account_members;
CREATE TRIGGER trg_guard_last_owner
  BEFORE UPDATE OR DELETE ON account_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_owner();

-- ---------------------------------------------------------------------------
-- ADR-004 F1 (Critical): invitations with a NULL invited_email are bearer
-- tokens — anyone holding the link can redeem them. Expire the outstanding
-- ones now; the redeem RPC (ADR-004 D3) additionally requires the session's
-- verified email to match invited_email, and invite creation makes the field
-- mandatory.
-- ---------------------------------------------------------------------------
UPDATE account_invitations
SET expires_at = NOW()
WHERE invited_email IS NULL
  AND accepted_at IS NULL
  AND expires_at > NOW();

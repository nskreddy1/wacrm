-- ============================================================================
-- ADR-004 Task 4 — switch_active_account (D4, F4) + working revocation (F5)
--
-- Part 1 implements the planned switcher. Parts 2-4 repair three defects that
-- reading the live schema exposed; all three are consequences of Task 3 making
-- `account_members` the authoritative grant while every membership WRITE path
-- still operated on the single `profiles` pointer.
--
--   1. `remove_account_member` was BROKEN OUTRIGHT. It unconditionally did
--      INSERT INTO accounts to give the removed user a fresh home. Before
--      Task 3, redeeming an invite DELETED the joiner's own account, so they
--      owned none and the insert succeeded. Task 3 correctly stopped deleting
--      accounts, so the user still owns one and the insert now violates
--      `idx_accounts_one_per_owner` -> SQLSTATE 23505. Confirmed live:
--      removing a member failed with a duplicate-key error. Removal now
--      re-points the user at the account they ALREADY own instead of minting
--      a duplicate.
--
--   2. `remove_account_member` never touched `account_members` at all, so
--      even had the insert succeeded the removed user KEPT their active
--      membership row -- and `is_account_member` grants access from that row.
--      Removal did not revoke access.
--
--   3. `set_member_status` wrote `profiles.status`, never
--      `account_members.status`. Confirmed live: after
--      set_member_status(user,'inactive'), account_members.status was still
--      'active' and is_account_member still returned TRUE. Deactivating a
--      member did not revoke their access. Worse, `profiles.status` is a
--      GLOBAL, per-user flag referenced by 2 RLS policies, so writing it
--      would have degraded the user's access to their OWN workspace too.
--      Member status is per-membership and now lives on `account_members`.
--
-- The plan proposed an AFTER DELETE trigger for F5. That would have been dead
-- code: nothing in this codebase DELETEs from `account_members`. The schema is
-- built for soft-delete -- `account_members.status` is CHECKed against
-- ('active','inactive','deleted') and the existing `guard_last_owner` trigger
-- already reasons about status transitions away from 'active'. The trigger here
-- therefore fires on UPDATE *and* DELETE, so no write path can strand a user.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part 1 (D4, F4): switch_active_account
--
-- The membership check and the pointer write are ONE statement, so there is no
-- TOCTOU window in which a membership could be revoked between the check and
-- the write. Returns TRUE when a row was updated, FALSE when the caller is not
-- an active member -- the route maps FALSE to 404 (not 403) so the endpoint
-- cannot be used to probe which account ids exist.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.switch_active_account(p_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_switched uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE profiles p
  SET account_id   = m.account_id,
      account_role = m.role,
      -- Drop workspace-scoped grants that belong to the account being left.
      -- `is_account_member` joins `workspace_profiles` by id ONLY (it does not
      -- compare wp.account_id), so a pointer left behind from another account
      -- would confer that foreign profile's permissions -- including
      -- 'settings:manage', i.e. admin -- in the account just switched into.
      -- Preserved only when the profile genuinely belongs to the target.
      workspace_profile_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM workspace_profiles wp
          WHERE wp.id = p.workspace_profile_id
            AND wp.account_id = m.account_id
        ) THEN p.workspace_profile_id
        ELSE NULL
      END,
      workspace_role_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM workspace_roles wr
          WHERE wr.id = p.workspace_role_id
            AND wr.account_id = m.account_id
        ) THEN p.workspace_role_id
        ELSE NULL
      END,
      updated_at = now()
  FROM account_members m
  WHERE p.user_id = auth.uid()
    AND m.user_id = auth.uid()
    AND m.account_id = p_account_id
    AND m.status = 'active'
  RETURNING p.account_id INTO v_switched;

  RETURN v_switched IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.switch_active_account(uuid) IS
  'ADR-004 D4/F4: atomically verify active membership and move the caller''s '
  'active-workspace pointer. Returns false (route: 404) when not a member. '
  'Clears workspace role/profile pointers that belong to another account.';

-- ----------------------------------------------------------------------------
-- Part 2 (F5): never strand a user on an account they no longer belong to
--
-- Fires for ANY loss of an active membership -- hard DELETE or a status change
-- away from 'active' -- so future write paths and manual SQL are covered too.
-- AFTER, so it cannot interfere with the existing BEFORE `guard_last_owner`.
--
-- `profiles.account_id` is NOT NULL, so the pointer cannot simply be parked;
-- a destination is resolved in order of least surprise:
--   1. the account the user already OWNS (the normal case),
--   2. any other account where they still hold active membership,
--   3. a freshly created personal account (only if they own none).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.repoint_profile_on_membership_loss()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target uuid;
  v_role   account_role_enum;
  v_name   text;
BEGIN
  -- Only relevant when an ACTIVE grant was lost.
  IF OLD.status <> 'active' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'active' AND NEW.account_id = OLD.account_id THEN
    RETURN NEW;
  END IF;

  -- Only relevant if the user is actually sitting in that account right now.
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = OLD.user_id AND account_id = OLD.account_id
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- 1. their own account
  SELECT a.id INTO v_target
  FROM accounts a
  WHERE a.owner_user_id = OLD.user_id
  LIMIT 1;

  -- 2. any other account where they remain active
  IF v_target IS NULL THEN
    SELECT m.account_id, m.role INTO v_target, v_role
    FROM account_members m
    WHERE m.user_id = OLD.user_id
      AND m.status = 'active'
      AND m.account_id <> OLD.account_id
    ORDER BY m.created_at
    LIMIT 1;
  END IF;

  -- 3. nothing left: mint a personal account so the NOT NULL pointer holds
  IF v_target IS NULL THEN
    SELECT COALESCE(NULLIF(full_name, ''), email, 'My account')
    INTO v_name
    FROM profiles WHERE user_id = OLD.user_id;

    INSERT INTO accounts (name, owner_user_id)
    VALUES (COALESCE(v_name, 'My account'), OLD.user_id)
    ON CONFLICT (owner_user_id) DO NOTHING
    RETURNING id INTO v_target;

    IF v_target IS NULL THEN
      SELECT a.id INTO v_target FROM accounts a WHERE a.owner_user_id = OLD.user_id LIMIT 1;
    END IF;
  END IF;

  IF v_target IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Resolve the role for the destination: owner of their own account,
  -- otherwise whatever their surviving membership says.
  IF v_role IS NULL THEN
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM accounts WHERE id = v_target AND owner_user_id = OLD.user_id
           ) THEN 'owner'::account_role_enum
           ELSE COALESCE(
             (SELECT m.role FROM account_members m
               WHERE m.user_id = OLD.user_id AND m.account_id = v_target
                 AND m.status = 'active' LIMIT 1),
             'viewer'::account_role_enum)
           END
      INTO v_role;
  END IF;

  UPDATE profiles
  SET account_id   = v_target,
      account_role = v_role,
      -- Same escalation guard as the switcher: never carry another
      -- account's workspace grants across the move.
      workspace_profile_id = NULL,
      workspace_role_id    = NULL,
      updated_at = now()
  WHERE user_id = OLD.user_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_repoint_profile_on_membership_loss ON public.account_members;
CREATE TRIGGER trg_repoint_profile_on_membership_loss
  AFTER UPDATE OR DELETE ON public.account_members
  FOR EACH ROW EXECUTE FUNCTION public.repoint_profile_on_membership_loss();

-- ----------------------------------------------------------------------------
-- Part 3: remove_account_member -- revoke the membership, reuse the user's
-- existing account instead of minting a duplicate.
--
-- Soft-delete (status='deleted') rather than DELETE: it preserves the audit
-- trail, matches the status CHECK the schema already carries, and lets Task 3's
-- ON CONFLICT reactivate the same row if the person is re-invited later.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account uuid;
  v_target_role    account_role_enum;
  v_new_account    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_caller_account
  FROM profiles WHERE user_id = auth.uid() AND status = 'active';

  IF v_caller_account IS NULL THEN
    RAISE EXCEPTION 'Caller has no active account' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_account, 'members:manage') THEN
    RAISE EXCEPTION 'You need the members:manage permission to remove a member'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  -- Authoritative membership row, locked so two concurrent removals cannot
  -- both proceed.
  SELECT role INTO v_target_role
  FROM account_members
  WHERE account_id = v_caller_account
    AND user_id = p_user_id
    AND status = 'active'
  FOR UPDATE;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not an active member of your account'
      USING ERRCODE = '22023';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Revoke the grant. trg_repoint_profile_on_membership_loss moves their
  -- active-workspace pointer somewhere valid.
  -- NB: account_members has no updated_at column (verified against the live
  -- schema); created_at is the only timestamp it carries.
  UPDATE account_members
  SET status = 'deleted'
  WHERE account_id = v_caller_account
    AND user_id = p_user_id;

  SELECT account_id INTO v_new_account FROM profiles WHERE user_id = p_user_id;
  RETURN v_new_account;
END;
$$;

COMMENT ON FUNCTION public.remove_account_member(uuid) IS
  'ADR-004 F5: revoke a member''s account_members grant (soft-delete) and '
  'return the account their pointer now rests on. Reuses the account the user '
  'already owns rather than creating a duplicate.';

-- ----------------------------------------------------------------------------
-- Part 4: set_member_status writes the MEMBERSHIP status, not the global
-- per-user `profiles.status` (which gates the user everywhere, including in
-- their own workspace, and is referenced by 2 RLS policies).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_member_status(p_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account uuid;
  v_target_role    account_role_enum;
BEGIN
  IF p_status NOT IN ('active', 'inactive', 'deleted') THEN
    RAISE EXCEPTION 'Status must be active, inactive, or deleted'
      USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_caller_account
  FROM profiles WHERE user_id = auth.uid() AND status = 'active';

  IF v_caller_account IS NULL THEN
    RAISE EXCEPTION 'Caller has no active account membership' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_account, 'members:manage') THEN
    RAISE EXCEPTION 'You need the members:manage permission to change member status'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own status' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_target_role
  FROM account_members
  WHERE account_id = v_caller_account AND user_id = p_user_id
  FOR UPDATE;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '22023';
  END IF;

  -- guard_last_owner independently blocks deactivating the final owner.
  UPDATE account_members
  SET status = p_status
  WHERE account_id = v_caller_account AND user_id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.set_member_status(uuid, text) IS
  'ADR-004: set a member''s per-membership status on account_members. Does not '
  'touch profiles.status, which is a global per-user flag.';

-- ----------------------------------------------------------------------------
-- Grants: these are all authenticated-user operations. `anon` held EXECUTE
-- purely by inheritance; nothing calls them unauthenticated (each raises 42501
-- when auth.uid() is NULL), so remove the reachability.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.switch_active_account(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_account_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_member_status(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.switch_active_account(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_member_status(uuid, text) TO authenticated, service_role;

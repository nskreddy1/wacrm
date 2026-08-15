-- ============================================================
-- Member grants: make account_members the single source of truth
-- ============================================================
--
-- BUG (data-visibility escalation + blank UI)
--
-- redeem_invitation wrote the admin's chosen workspace role/profile to
-- `profiles` only. `account_members` got just (role, status, invited_by).
-- But the members UI (/api/account/members) and the record-visibility
-- RLS both read account_members.workspace_role_id / _profile_id.
--
-- Two observable failures from that one split:
--
--   1. An invited member's Profile/Role render blank in Settings, even
--      though the invite specified them.
--   2. Worse: because account_members.workspace_role_id stayed NULL,
--      can_view_owned_record() could not place the member on the
--      ladder. A member intended to be a Level 5 rep was treated as
--      unplaced and observed at Level 1 (sees every record).
--
-- Owner bootstrap had the mirror-image gap: an account created by the
-- signup trigger got its roles seeded, but if the owner's grant row was
-- written before/without the profile lookup, account_members kept NULLs
-- and the owner showed no Profile or Role at all.
--
-- FIX
--   (1) redeem_invitation writes the grants to account_members (the
--       table everything reads) as well as the profiles pointer.
--   (2) Backfill: heal existing rows, and specifically de-escalate any
--       invited non-owner who is sitting on the top tier they were never
--       granted.
--   (3) A trigger keeps the two tables from silently diverging again.
--
-- Idempotent: safe to re-run.

-- ------------------------------------------------------------------
-- 1. redeem_invitation — write grants where they are actually read
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id        UUID := auth.uid();
  v_caller_email     TEXT;
  v_caller_confirmed TIMESTAMPTZ;
  v_inv              account_invitations%ROWTYPE;
  v_member_status    TEXT;
  v_member_role      account_role_enum;
  v_ws_role_id       UUID;
  v_ws_profile_id    UUID;
  v_rows             INTEGER;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE serializes two concurrent clicks on the same link so the
  -- accepted_at write below cannot race.
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- (c) ownership is never granted by a link
  IF v_inv.role = 'owner' THEN
    RAISE EXCEPTION 'Invitations cannot grant ownership'
      USING ERRCODE = '42501';
  END IF;

  -- (a)(b) bind the invite to the invited identity
  SELECT u.email, u.email_confirmed_at
  INTO v_caller_email, v_caller_confirmed
  FROM auth.users u
  WHERE u.id = v_caller_id;

  IF v_inv.invited_email IS NULL THEN
    RAISE EXCEPTION
      'This invitation is not addressed to an email address and can no longer be redeemed'
      USING ERRCODE = '22023';
  END IF;

  IF v_caller_email IS NULL
     OR LOWER(v_caller_email) <> LOWER(v_inv.invited_email) THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_confirmed IS NULL THEN
    RAISE EXCEPTION 'Confirm your email address before joining this workspace'
      USING ERRCODE = '42501';
  END IF;

  -- (d) re-validate the invite's role/profile against the INVITING
  -- account, so a tampered invitation row cannot attach another
  -- account's objects. NULL when absent or foreign.
  SELECT r.id INTO v_ws_role_id
  FROM workspace_roles r
  WHERE r.id = v_inv.workspace_role_id
    AND r.account_id = v_inv.account_id;

  SELECT wp.id INTO v_ws_profile_id
  FROM workspace_profiles wp
  WHERE wp.id = v_inv.workspace_profile_id
    AND wp.account_id = v_inv.account_id;

  -- Fall back to the least-privileged sensible defaults rather than
  -- leaving NULLs behind. A NULL workspace_role_id cannot be placed on
  -- the ladder, and an unplaced member is the escalation this migration
  -- exists to close: default to the LOWEST tier (own records only), and
  -- to the narrowest system profile.
  IF v_ws_role_id IS NULL THEN
    SELECT r.id INTO v_ws_role_id
    FROM workspace_roles r
    WHERE r.account_id = v_inv.account_id
      AND r.system_key = 'level_5'
    LIMIT 1;
  END IF;

  IF v_ws_profile_id IS NULL THEN
    SELECT wp.id INTO v_ws_profile_id
    FROM workspace_profiles wp
    WHERE wp.account_id = v_inv.account_id
      AND wp.name = 'Standard'
    LIMIT 1;
  END IF;

  -- Idempotency: an existing ACTIVE member simply lands in the
  -- workspace instead of raising a duplicate-key error.
  SELECT m.status, m.role
  INTO v_member_status, v_member_role
  FROM account_members m
  WHERE m.account_id = v_inv.account_id
    AND m.user_id = v_caller_id;

  IF v_member_status = 'active' THEN
    UPDATE account_invitations
    SET accepted_at = NOW(),
        accepted_by_user_id = v_caller_id
    WHERE id = v_inv.id;

    -- (e) role is NOT rewritten from the invite; the pointer is aligned
    -- to the role they actually hold here.
    -- (d) foreign workspace pointers are cleared, not carried across.
    UPDATE profiles p
    SET account_id = v_inv.account_id,
        account_role = v_member_role,
        workspace_role_id = (
          SELECT r.id FROM workspace_roles r
          WHERE r.id = p.workspace_role_id
            AND r.account_id = v_inv.account_id
        ),
        workspace_profile_id = (
          SELECT wp.id FROM workspace_profiles wp
          WHERE wp.id = p.workspace_profile_id
            AND wp.account_id = v_inv.account_id
        )
    WHERE p.user_id = v_caller_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'No profile row for the caller; cannot set active workspace'
        USING ERRCODE = '22023';
    END IF;

    RETURN v_inv.account_id;
  END IF;

  -- JOIN. The grants now land on account_members too -- that is the
  -- table the members API and the visibility RLS read from. Writing
  -- only `profiles` (the old behaviour) left this member unplaced on
  -- the ladder and blank in Settings.
  INSERT INTO account_members (
    account_id, user_id, role, status, invited_by,
    workspace_role_id, workspace_profile_id
  )
  VALUES (
    v_inv.account_id,
    v_caller_id,
    v_inv.role,
    'active',
    v_inv.created_by_user_id,
    v_ws_role_id,
    v_ws_profile_id
  )
  ON CONFLICT (account_id, user_id) DO UPDATE
  SET role = EXCLUDED.role,
      status = 'active',
      invited_by = EXCLUDED.invited_by,
      workspace_role_id = EXCLUDED.workspace_role_id,
      workspace_profile_id = EXCLUDED.workspace_profile_id;

  -- Point the active-workspace pointer at the joined account. `profiles`
  -- is UNIQUE(user_id): one active workspace per user in V1. The
  -- caller's own account is NOT deleted -- they remain its owner, so
  -- V2's switcher can send them back.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role,
      workspace_role_id = v_ws_role_id,
      workspace_profile_id = v_ws_profile_id
  WHERE user_id = v_caller_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'No profile row for the caller; cannot set active workspace'
      USING ERRCODE = '22023';
  END IF;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  RETURN v_inv.account_id;
END;
$function$;

-- ------------------------------------------------------------------
-- 2. Backfill existing rows
-- ------------------------------------------------------------------

-- (2a) SECURITY: de-escalate invited non-owners who ended up on the top
-- tier. A member is only legitimately Level 1 if they are the account
-- owner. Anyone else holding level_1 got there through the bug above,
-- so drop them to the lowest tier; an admin can promote deliberately.
UPDATE account_members m
SET workspace_role_id = (
      SELECT r.id FROM workspace_roles r
      WHERE r.account_id = m.account_id AND r.system_key = 'level_5'
      LIMIT 1
    )
WHERE m.role <> 'owner'
  AND m.user_id <> (SELECT a.owner_user_id FROM accounts a WHERE a.id = m.account_id)
  AND EXISTS (
    SELECT 1 FROM workspace_roles r
    WHERE r.id = m.workspace_role_id AND r.system_key = 'level_1'
  );

-- (2b) Recover grants the old code wrote only to `profiles`, so an
-- existing member's chosen Profile/Role stops rendering blank.
UPDATE account_members m
SET workspace_profile_id = p.workspace_profile_id
FROM profiles p
WHERE p.user_id = m.user_id
  AND m.workspace_profile_id IS NULL
  AND p.workspace_profile_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM workspace_profiles wp
    WHERE wp.id = p.workspace_profile_id AND wp.account_id = m.account_id
  );

UPDATE account_members m
SET workspace_role_id = p.workspace_role_id
FROM profiles p
WHERE p.user_id = m.user_id
  AND m.workspace_role_id IS NULL
  AND p.workspace_role_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM workspace_roles r
    WHERE r.id = p.workspace_role_id AND r.account_id = m.account_id
  );

-- (2c) Owners with no grants at all (the admin1-owns-own-workspace
-- case): give them Administrator + Level 1, which is what the signup
-- bootstrap intends.
UPDATE account_members m
SET workspace_profile_id = COALESCE(
      m.workspace_profile_id,
      (SELECT wp.id FROM workspace_profiles wp
        WHERE wp.account_id = m.account_id AND wp.name = 'Administrator'
        LIMIT 1)
    ),
    workspace_role_id = COALESCE(
      m.workspace_role_id,
      (SELECT r.id FROM workspace_roles r
        WHERE r.account_id = m.account_id AND r.system_key = 'level_1'
        LIMIT 1)
    )
WHERE m.role = 'owner'
  AND (m.workspace_profile_id IS NULL OR m.workspace_role_id IS NULL);

-- (2d) Any remaining member without grants: least privilege.
UPDATE account_members m
SET workspace_profile_id = COALESCE(
      m.workspace_profile_id,
      (SELECT wp.id FROM workspace_profiles wp
        WHERE wp.account_id = m.account_id AND wp.name = 'Standard'
        LIMIT 1)
    ),
    workspace_role_id = COALESCE(
      m.workspace_role_id,
      (SELECT r.id FROM workspace_roles r
        WHERE r.account_id = m.account_id AND r.system_key = 'level_5'
        LIMIT 1)
    )
WHERE m.workspace_profile_id IS NULL OR m.workspace_role_id IS NULL;

-- ------------------------------------------------------------------
-- 3. Stop the two tables diverging again
-- ------------------------------------------------------------------
-- Any future writer that sets the grants on account_members without
-- updating the caller's active-workspace pointer would recreate the
-- blank-UI symptom. Mirroring in a trigger keeps `profiles` aligned for
-- the row that currently points at this account.
CREATE OR REPLACE FUNCTION public.sync_member_grants_to_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE profiles p
  SET workspace_role_id = NEW.workspace_role_id,
      workspace_profile_id = NEW.workspace_profile_id,
      account_role = NEW.role
  WHERE p.user_id = NEW.user_id
    AND p.account_id = NEW.account_id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_member_grants_to_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_member_grants_to_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_member_grants_to_profile() FROM anon;

DROP TRIGGER IF EXISTS trg_sync_member_grants ON account_members;
CREATE TRIGGER trg_sync_member_grants
  AFTER INSERT OR UPDATE OF workspace_role_id, workspace_profile_id, role
  ON account_members
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_member_grants_to_profile();

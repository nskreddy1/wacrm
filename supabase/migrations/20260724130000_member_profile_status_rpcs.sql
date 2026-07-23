-- ============================================================
-- Member management RPCs for the permission-profile model.
--
-- Follows the SECURITY DEFINER pattern of migration 018
-- (set_member_role / remove_account_member): authorisation lives
-- INSIDE the function, TS routes only forward calls.
--
--   set_member_profile(p_user_id, p_profile_id)
--     Assign a workspace profile (permission set) to a member.
--
--   set_member_status(p_user_id, p_status)
--     Activate / deactivate / soft-delete a member.
--
-- Rules enforced here (mirroring Zoho/Bigin semantics):
--   * Caller must be an active member of the same account holding
--     'members:manage' (or be the account owner).
--   * Target must be in the caller's account.
--   * The account owner ("Super Admin") can never be deactivated,
--     deleted, or reassigned — ownership transfer is a separate
--     explicit flow.
--   * Callers cannot change their own status (no self-lockout).
-- ============================================================

CREATE OR REPLACE FUNCTION set_member_profile(
  p_user_id UUID,
  p_profile_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account UUID;
  v_target_account UUID;
  v_owner UUID;
  v_profile_account UUID;
BEGIN
  SELECT account_id INTO v_caller_account
  FROM profiles WHERE user_id = auth.uid() AND status = 'active';

  IF v_caller_account IS NULL THEN
    RAISE EXCEPTION 'Caller has no active account membership'
      USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_account, 'members:manage') THEN
    RAISE EXCEPTION 'You need the members:manage permission to change member profiles'
      USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_target_account
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account IS DISTINCT FROM v_caller_account THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '22023';
  END IF;

  SELECT owner_user_id INTO v_owner FROM accounts WHERE id = v_caller_account;
  IF p_user_id = v_owner THEN
    RAISE EXCEPTION 'The account owner''s profile cannot be changed'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_profile_account
  FROM workspace_profiles WHERE id = p_profile_id;

  IF v_profile_account IS DISTINCT FROM v_caller_account THEN
    RAISE EXCEPTION 'Profile does not belong to your account'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET workspace_profile_id = p_profile_id
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION set_member_profile(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_member_profile(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION set_member_status(
  p_user_id UUID,
  p_status TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account UUID;
  v_target_account UUID;
  v_owner UUID;
BEGIN
  IF p_status NOT IN ('active', 'inactive', 'deleted') THEN
    RAISE EXCEPTION 'Status must be active, inactive, or deleted'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_caller_account
  FROM profiles WHERE user_id = auth.uid() AND status = 'active';

  IF v_caller_account IS NULL THEN
    RAISE EXCEPTION 'Caller has no active account membership'
      USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_account, 'members:manage') THEN
    RAISE EXCEPTION 'You need the members:manage permission to change member status'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own status'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_target_account
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account IS DISTINCT FROM v_caller_account THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '22023';
  END IF;

  SELECT owner_user_id INTO v_owner FROM accounts WHERE id = v_caller_account;
  IF p_user_id = v_owner THEN
    RAISE EXCEPTION 'The account owner cannot be deactivated or deleted'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET status = p_status,
      status_changed_at = NOW()
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION set_member_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_member_status(UUID, TEXT) TO authenticated;

-- ============================================================
-- ADR-004 D3: redeem_invitation JOINS a workspace instead of
-- MOVING the caller into it.
--
-- Before this migration, redeeming an invite:
--   1. required the caller to be the SOLE OWNER of their current
--      account and for that account to hold NO domain data,
--   2. re-pointed profiles.account_id at the inviting account, and
--   3. DELETED the caller's own account.
-- Anyone who had already used the product was told to
-- "sign up with a different email" — which is the exact failure
-- ADR-004 exists to remove.
--
-- After this migration, redeeming an invite:
--   1. inserts an `account_members` row (the durable, multi-workspace
--      source of truth that `is_account_member` now reads), and
--   2. points `profiles` (the single active-workspace pointer) at the
--      newly joined account so the user actually lands in it,
--   3. deletes NOTHING. The caller keeps their own account, and keeps
--      access to it via the `accounts.owner_user_id` grant inside
--      `is_account_member` plus their own backfilled membership row.
--
-- Security changes bundled here on purpose (they are part of the same
-- trust decision, not drive-by edits):
--   * The invite is now BOUND to the invited identity. An emailed
--     invite may only be redeemed by a signed-in user whose verified
--     email matches `invited_email`. Previously ANY authenticated user
--     who obtained the link could claim an invite addressed to someone
--     else.
--   * `role = 'owner'` is refused defensively. There is a CHECK on the
--     table, but this function is SECURITY DEFINER so it re-verifies.
--   * `workspace_role_id` / `workspace_profile_id` are re-validated to
--     belong to the INVITING account before being applied, so a
--     tampered invite row cannot attach a foreign account's profile.
--
-- Error contract is UNCHANGED (src/app/api/invitations/[token]/redeem
-- maps these exactly): 42501 -> 401, 22023 -> 400, 23505 -> 409.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
RETURNS uuid
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
  v_ws_role_id       UUID;
  v_ws_profile_id    UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE serializes two clicks on the same link, so the
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

  -- Defence in depth: ownership is transferred only by
  -- transfer_ownership(), never by redeeming a link.
  IF v_inv.role = 'owner' THEN
    RAISE EXCEPTION 'Invitations cannot grant ownership'
      USING ERRCODE = '42501';
  END IF;

  -- ----------------------------------------------------------
  -- Bind the invite to the invited identity.
  -- ----------------------------------------------------------
  SELECT u.email, u.email_confirmed_at
  INTO v_caller_email, v_caller_confirmed
  FROM auth.users u
  WHERE u.id = v_caller_id;

  IF v_inv.invited_email IS NULL THEN
    -- Both invite-creation UIs (invite-user-sheet, onboarding-wizard)
    -- require an email, and the API now rejects a missing one, so a
    -- NULL here is a pre-ADR-004 relic. Refusing is the safe read: an
    -- unbound invite is a bearer token that anyone who finds the link
    -- could redeem.
    RAISE EXCEPTION 'This invitation is not addressed to an email address and can no longer be redeemed'
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

  -- ----------------------------------------------------------
  -- Idempotency: an existing ACTIVE member just lands in the
  -- workspace. Previously this raised 23505 (409), which showed the
  -- user an error for what is effectively a no-op.
  -- ----------------------------------------------------------
  SELECT m.status INTO v_member_status
  FROM account_members m
  WHERE m.account_id = v_inv.account_id
    AND m.user_id = v_caller_id;

  IF v_member_status = 'active' THEN
    UPDATE account_invitations
    SET accepted_at = NOW(),
        accepted_by_user_id = v_caller_id
    WHERE id = v_inv.id;

    UPDATE profiles
    SET account_id = v_inv.account_id
    WHERE user_id = v_caller_id;

    RETURN v_inv.account_id;
  END IF;

  -- ----------------------------------------------------------
  -- Re-validate the invite's workspace role/profile against the
  -- INVITING account. The creation route already checks this; doing
  -- it again here means a directly-tampered invitation row cannot
  -- attach another account's profile (which would confer that
  -- profile's permissions through is_account_member).
  -- ----------------------------------------------------------
  SELECT r.id INTO v_ws_role_id
  FROM workspace_roles r
  WHERE r.id = v_inv.workspace_role_id
    AND r.account_id = v_inv.account_id;

  SELECT p.id INTO v_ws_profile_id
  FROM workspace_profiles p
  WHERE p.id = v_inv.workspace_profile_id
    AND p.account_id = v_inv.account_id;

  -- ----------------------------------------------------------
  -- JOIN. `ON CONFLICT` reactivates a previously removed member
  -- (status <> 'active') without a second round trip.
  -- ----------------------------------------------------------
  INSERT INTO account_members (account_id, user_id, role, status, invited_by)
  VALUES (
    v_inv.account_id,
    v_caller_id,
    v_inv.role,
    'active',
    v_inv.created_by_user_id
  )
  ON CONFLICT (account_id, user_id) DO UPDATE
  SET role = EXCLUDED.role,
      status = 'active',
      invited_by = EXCLUDED.invited_by;

  -- Point the active-workspace pointer at the joined account and
  -- apply the role/profile the admin chose when inviting. `profiles`
  -- is UNIQUE(user_id): one active workspace per user in V1. The
  -- caller's own account is NOT deleted and NOT emptied — they remain
  -- its owner and a member of it, so V2's switcher can send them back.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role,
      workspace_role_id = v_ws_role_id,
      workspace_profile_id = v_ws_profile_id
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  RETURN v_inv.account_id;
END;
$function$;

COMMENT ON FUNCTION public.redeem_invitation(text) IS
  'ADR-004 D3: joins the caller to the inviting account by inserting '
  'an account_members row and re-pointing the profiles active-workspace '
  'pointer. Never deletes the caller''s own account. Requires the '
  'caller''s verified email to match account_invitations.invited_email. '
  'Idempotent for existing active members. Error codes: 42501=401, '
  '22023=400, 23505=409.';

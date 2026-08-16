-- ===================================================================
-- peek_invitation: return the workspace ROLE NAME the inviter actually
-- chose, instead of only the legacy account-role enum.
--
-- THE BUG
-- ---------------------------------------------------------------
-- /join rendered "Joining as Agent" for an invite whose admin had
-- selected Role = 'Level 1', Profile = 'Standard'.
--
-- Nothing was corrupt in the data — the screen was reading the wrong
-- column. An invitation carries THREE separate notions of access:
--
--   role                  legacy enum: owner|admin|agent|viewer
--   workspace_role_id  →  workspace_roles.name    e.g. 'Level 1'
--   workspace_profile_id →  workspace_profiles.name e.g. 'Standard'
--
-- The invite sheet derives `role` mechanically for backwards
-- compatibility — the Administrator system profile maps to 'admin' and
-- EVERYTHING ELSE collapses to 'agent' (see invite-user-sheet.tsx).
-- So 'agent' is not a choice anyone made; it is the residue of a
-- lossy mapping, and it is the one value of the three the admin never
-- picked. Showing it to the invitee misreported their own invitation:
-- a 'Level 1' reporting role reads as the lowest rung of the ladder.
--
-- THE FIX
-- ---------------------------------------------------------------
-- Return `workspace_role_name` so the page can name the role that was
-- actually selected. `role` is still returned unchanged — RLS and the
-- role ladder genuinely run on that enum, and older clients read it —
-- but it is no longer the only thing on offer.
--
-- Resolved here rather than client-side: workspace_roles is
-- account-scoped and RLS-protected, so an anonymous /join visitor
-- cannot read the name itself. It is disclosed for the same reason
-- profile_name already is — it is org metadata strictly less revealing
-- than the `role` enum this function has returned since 019.
--
-- Every previously returned key keeps its name and meaning.
-- Idempotent — CREATE OR REPLACE, safe to re-run.
-- ===================================================================

CREATE OR REPLACE FUNCTION public.peek_invitation(
  p_token_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv          account_invitations%ROWTYPE;
  v_account_name TEXT;
  v_profile_name TEXT;
  v_role_name    TEXT;
  v_caller_id    UUID := auth.uid();
  v_caller_email TEXT;
  v_matches      BOOLEAN;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  -- Failure branches stay byte-for-byte identical to 019: the reason
  -- codes and their order drive the /join page's copy, and a failed
  -- peek must never carry invite metadata.
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name INTO v_account_name
  FROM accounts
  WHERE id = v_inv.account_id;

  -- Permission set the invite grants. Scoped by account_id as well as
  -- id: workspace_profile_id is validated on write, but re-scoping here
  -- means a row that somehow referenced a foreign profile reads as NULL
  -- rather than leaking another account's profile name.
  IF v_inv.workspace_profile_id IS NOT NULL THEN
    SELECT wp.name INTO v_profile_name
    FROM workspace_profiles wp
    WHERE wp.id = v_inv.workspace_profile_id
      AND wp.account_id = v_inv.account_id;
  END IF;

  -- Reporting role the inviter selected. Same account_id re-scoping as
  -- the profile lookup above, for the same reason.
  IF v_inv.workspace_role_id IS NOT NULL THEN
    SELECT wr.name INTO v_role_name
    FROM workspace_roles wr
    WHERE wr.id = v_inv.workspace_role_id
      AND wr.account_id = v_inv.account_id;
  END IF;

  -- Identity comparison happens inside the function so the invited
  -- plaintext never leaves the DB for a caller who fails it. Stays NULL
  -- when anonymous: "nobody to compare yet" and "compared, did not
  -- match" are different states and the UI branches on the difference.
  IF v_caller_id IS NOT NULL THEN
    SELECT u.email INTO v_caller_email
    FROM auth.users u
    WHERE u.id = v_caller_id;

    -- Must agree with redeem_invitation's own comparison, or the UI
    -- would promise an outcome redeem then refuses.
    v_matches := v_caller_email IS NOT NULL
      AND LOWER(TRIM(v_caller_email)) = LOWER(TRIM(v_inv.invited_email));
  END IF;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    -- Legacy enum. Retained because RLS and the role ladder run on it
    -- and older clients still read it — but the UI now prefers
    -- workspace_role_name below when one exists.
    'role', v_inv.role,
    'workspace_role_name', v_role_name,
    'expires_at', v_inv.expires_at,
    'invited_email_hint', mask_email(v_inv.invited_email),
    'invited_email_matches', v_matches,
    'profile_name', v_profile_name,
    -- Gated on the identity check. COALESCE so a NULL v_matches
    -- (anonymous) is treated as false rather than making the whole
    -- CASE evaluate to NULL by accident.
    'invited_email_exact',
      CASE WHEN COALESCE(v_matches, FALSE) THEN v_inv.invited_email END,
    'invited_first_name',
      CASE WHEN COALESCE(v_matches, FALSE) THEN v_inv.invited_first_name END
  );
END;
$$;

COMMENT ON FUNCTION public.peek_invitation(TEXT) IS
  'Anonymous invite preview by token hash. Always returns account name, '
  'legacy account role, workspace role name, workspace profile name, '
  'expiry, a MASKED invited-email hint, and whether the caller''s own '
  'email matches the invited one. Returns the exact invited email and '
  'first name ONLY when that match is true (i.e. only to the invited '
  'person themselves); anonymous or wrong-identity callers get NULL.';

ALTER FUNCTION public.peek_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated;

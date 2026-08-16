-- ===================================================================
-- peek_invitation: reveal the invited identity to the invited person,
-- and name the access they are being granted.
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------
-- 20260816140000 added a MASKED hint plus `invited_email_matches`, so
-- /join could warn a wrong-identity visitor before they committed.
-- That solved the warning, but left two things wrong on the happy path:
--
--   1. The person the link IS for still only ever saw 'ad****@gmail.com'.
--      Masking protects the address from a stranger holding a forwarded
--      link — it has no purpose once the caller is *already
--      authenticated as that very address*. Hiding a value from the one
--      person who provably owns it is not privacy, it is just a worse
--      confirmation screen. Once `invited_email_matches` is true, the
--      exact address is the caller's own data and returning it tells
--      them nothing they could not read off their own profile.
--
--   2. The page said "Joining as Agent" and stopped there. An invitation
--      also carries a workspace PROFILE (the permission set — typically
--      'Standard'), which redeem_invitation writes to
--      account_members.workspace_profile_id. It was being applied on
--      join but never disclosed beforehand, so the accept screen
--      understated what was actually being granted.
--
-- WHAT IS RETURNED, AND TO WHOM
-- ---------------------------------------------------------------
--   invited_email_hint     masked      — always (anonymous-safe)
--   invited_email_matches  bool/NULL   — always (a fact about caller)
--   profile_name           text        — always; org metadata, not PII,
--                                        and strictly less revealing
--                                        than `role`, already returned.
--   invited_email_exact    text        — ONLY when matches IS TRUE
--   invited_first_name     text        — ONLY when matches IS TRUE
--
-- The two gated fields are guarded by the same equality that
-- redeem_invitation enforces, evaluated in this function against
-- auth.users. An anonymous or wrong-identity caller gets NULL for both,
-- so the disclosure surface for a stolen link is completely unchanged
-- from the previous migration.
--
-- Every key from 019 and from 20260816140000 is still present with the
-- same meaning, so older clients keep working.
--
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
    'role', v_inv.role,
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
  'account role, workspace profile name, expiry, a MASKED invited-email '
  'hint, and whether the caller''s own email matches the invited one. '
  'Returns the exact invited email and first name ONLY when that match '
  'is true (i.e. only to the invited person themselves); anonymous or '
  'wrong-identity callers get NULL for both.';

ALTER FUNCTION public.peek_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated;

-- ===================================================================
-- peek_invitation: return the invited email (masked) so /join can
-- validate the visitor's identity BEFORE they commit to accepting.
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------
-- redeem_invitation (20260813130000) already binds an invitation to
-- one identity: it refuses unless the caller's *confirmed* email
-- matches account_invitations.invited_email. That check is correct and
-- stays exactly as it is — it is the security boundary.
--
-- The defect is one of ORDER, not of enforcement. peek_invitation
-- returns only { account_name, role, expires_at }, so /join/<token>
-- cannot know who the link is addressed to. A visitor signed in as the
-- wrong person (very common — the invite was forwarded, or they have a
-- personal and a work login) sees a confident "Continue as
-- wrong@example.com" button, clicks it, waits for the round trip, and
-- only THEN learns the invite was never theirs. The refusal arrives
-- after the commitment instead of before it.
--
-- Returning the invited address lets the page compare it to the
-- signed-in identity on arrival and say so up front. Same rule, shown
-- at the moment it can still be acted on.
--
-- WHY MASKED
-- ---------------------------------------------------------------
-- peek is ANONYMOUS (granted to `anon`) — it must be, because the page
-- renders before sign-in. Returning the raw address would turn any
-- invite link into an email-address disclosure for anyone who obtains
-- it (forwarded thread, shared screenshot, chat unfurler, proxy log).
--
-- So we return two things instead:
--   * invited_email_hint — masked for DISPLAY ('al****@example.com').
--     Enough for the real recipient to recognise their own address;
--     not enough to harvest one that wasn't already known.
--   * invited_email_matches — a BOOLEAN comparing the invited address
--     to the CALLER's own email, computed inside this function so the
--     plaintext never leaves the database. Null when anonymous (there
--     is no caller identity to compare against yet).
--
-- The boolean is what the UI actually branches on, and it is only ever
-- true for someone already authenticated as that address — i.e. it
-- tells the caller a fact about themselves, which is not a disclosure.
--
-- The domain is left visible in the hint deliberately: 'al****@' alone
-- is not enough for a recipient to tell which of their addresses was
-- invited, and the domain is the part that makes it recognisable
-- ("ah, my work address"). Local-part is the identifying half and is
-- what gets hidden.
--
-- Backwards compatible: every previously returned key is still present
-- and unchanged, so an older client keeps working.
--
-- Idempotent — CREATE OR REPLACE, safe to re-run.
-- ===================================================================

-- -------------------------------------------------------------------
-- Mask an email for display to a possibly-unauthenticated viewer.
--
-- 'alice@example.com'  -> 'al****@example.com'
-- 'jo@example.com'     -> 'j*@example.com'      (1-char local part)
-- 'a@example.com'      -> '*@example.com'       (never echo a 1-char
--                                                local part verbatim)
-- IMMUTABLE: pure string function of its input, so Postgres may inline
-- and cache it.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mask_email(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_at     INT;
  v_local  TEXT;
  v_domain TEXT;
  v_keep   INT;
BEGIN
  IF p_email IS NULL THEN RETURN NULL; END IF;

  v_at := POSITION('@' IN p_email);
  -- Not an address we can split; reveal nothing rather than guess.
  IF v_at < 2 THEN RETURN '****'; END IF;

  v_local  := LEFT(p_email, v_at - 1);
  v_domain := SUBSTRING(p_email FROM v_at);  -- includes '@'

  -- Show at most the first 2 characters, and never more than half of a
  -- short local part, so 'jo' cannot come back as 'jo'.
  v_keep := LEAST(2, LENGTH(v_local) / 2);

  RETURN LEFT(v_local, v_keep)
      || REPEAT('*', GREATEST(LENGTH(v_local) - v_keep, 1))
      || v_domain;
END;
$$;

COMMENT ON FUNCTION public.mask_email(TEXT) IS
  'Masks an email local-part for display to a possibly-anonymous '
  'viewer (alice@example.com -> al****@example.com). Used by '
  'peek_invitation so an invite link cannot be used to harvest the '
  'invited address.';

ALTER FUNCTION public.mask_email(TEXT) OWNER TO postgres;

-- -------------------------------------------------------------------
-- peek_invitation — adds invited_email_hint + invited_email_matches.
--
-- Failure branches are byte-for-byte the same as 019: the reason codes
-- (not_found / used / expired) and their order are load-bearing for the
-- /join page's copy, and a failure must never carry invite metadata.
-- -------------------------------------------------------------------
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
  v_caller_id    UUID := auth.uid();
  v_caller_email TEXT;
  v_matches      BOOLEAN;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

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

  -- Compare inside the function so the invited plaintext never leaves
  -- the DB. Stays NULL for anonymous visitors: there is no identity to
  -- compare yet, which is different from "compared and did not match"
  -- and the UI must be able to tell those apart.
  IF v_caller_id IS NOT NULL THEN
    SELECT u.email INTO v_caller_email
    FROM auth.users u
    WHERE u.id = v_caller_id;

    -- LOWER(TRIM(...)) on both sides. invited_email is already
    -- normalised by normalize_invitation_email_trg
    -- (20260813131000), but auth.users.email is not ours to
    -- guarantee, and this must agree with redeem_invitation's own
    -- comparison or the UI would promise something redeem refuses.
    v_matches := v_caller_email IS NOT NULL
      AND LOWER(TRIM(v_caller_email)) = LOWER(TRIM(v_inv.invited_email));
  END IF;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at,
    -- Masked: safe to render to an anonymous visitor.
    'invited_email_hint', mask_email(v_inv.invited_email),
    -- NULL when anonymous, true/false once signed in.
    'invited_email_matches', v_matches
  );
END;
$$;

COMMENT ON FUNCTION public.peek_invitation(TEXT) IS
  'Anonymous invite preview by token hash. Returns account name, role, '
  'expiry, a MASKED invited-email hint, and (when the caller is '
  'authenticated) whether their own email matches the invited one, so '
  '/join can warn about a wrong-identity session before the user '
  'attempts to redeem. Never returns the invited address in plaintext.';

ALTER FUNCTION public.peek_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated;

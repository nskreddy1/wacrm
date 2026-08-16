-- ============================================================
-- invitation_email_matches(token_hash, candidate_email)
--
-- Answers one question for the SIGNUP page: "would this address
-- be able to accept this invitation?" — BEFORE an account exists.
--
-- Why this is needed
--   Signup previously ignored the invite's address entirely. Someone
--   following an invite for admin@gmail.com could type their own
--   address, and Supabase would happily create the user. The
--   handle_new_user trigger then found no matching invitation, so it
--   fell through to its "brand new customer" path and bootstrapped a
--   SEPARATE workspace. Only afterwards, on /join, did the UI report
--   "Signed in with a different email" — by which point the wrong
--   account and a stray workspace already existed, and the invite was
--   still unaccepted. Checking before creation is what makes that
--   unreachable rather than merely reported.
--
-- Disclosure model
--   Returns a BOOLEAN, never the invited address. A caller must
--   already know (or guess) an address to learn anything, which is
--   strictly less than the masked hint peek_invitation already hands
--   to anyone holding the link. Combined with the per-IP rate limit on
--   the calling route, this is not a usable enumeration oracle.
--
--   Deliberately does NOT distinguish "no such invite" from "invite
--   expired" in `matches` — both simply fail to match. The separate
--   `reason` exists so the UI can say something useful, and it
--   describes the INVITE's state, which the link holder can already
--   read from peek.
--
-- Idempotent: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.invitation_email_matches(
  p_token_hash text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin search_path: this is SECURITY DEFINER, so a caller-controlled
-- search_path could otherwise resolve `account_invitations` to a
-- shadowing table and make the comparison lie.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invited_email text;
  v_accepted_at   timestamptz;
  v_expires_at    timestamptz;
  v_candidate     text;
BEGIN
  IF p_token_hash IS NULL OR btrim(p_token_hash) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'matches', false);
  END IF;

  SELECT i.invited_email, i.accepted_at, i.expires_at
    INTO v_invited_email, v_accepted_at, v_expires_at
    FROM public.account_invitations i
   WHERE i.token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found', 'matches', false);
  END IF;

  IF v_accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_accepted', 'matches', false);
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired', 'matches', false);
  END IF;

  -- Normalize both sides the same way the signup form and redeem path
  -- do (trim + lowercase). Without this, "Admin@Gmail.com " would be
  -- reported as a mismatch and then be accepted by redeem later, or
  -- vice versa — the two checks must agree exactly.
  v_candidate := lower(btrim(COALESCE(p_email, '')));

  RETURN jsonb_build_object(
    'ok', true,
    'reason', NULL,
    'matches', v_candidate <> ''
               AND v_candidate = lower(btrim(COALESCE(v_invited_email, '')))
  );
END;
$$;

-- Anonymous callers only: this exists precisely for people who do not
-- yet have an account.
GRANT EXECUTE ON FUNCTION public.invitation_email_matches(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.invitation_email_matches(text, text) IS
  'Pre-signup guard: does this candidate email match the invitation''s invited_email? Returns a boolean only, never the invited address.';

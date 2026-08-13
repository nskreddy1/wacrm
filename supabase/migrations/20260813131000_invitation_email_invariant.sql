-- ===================================================================
-- ADR-004 / Task 3 follow-up: make the invited-email invariant true at
-- the SOURCE instead of compensating at every read site.
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------
-- redeem_invitation (20260813130000) binds an invitation to the
-- invited identity with
--
--     LOWER(v_caller_email) <> LOWER(v_inv.invited_email)
--
-- A behaviour test on the applied function found a real defect: LOWER()
-- alone does not tolerate surrounding whitespace, so an invitation
-- stored as '  Person@Example.com  ' can NEVER be redeemed by
-- 'person@example.com'. The invite is silently dead — the recipient
-- sees "sent to a different email address" for their own address.
--
-- Two ways to fix it:
--   (1) wrap both sides in TRIM() at the comparison, or
--   (2) guarantee the stored value is already normalised.
--
-- (2) is chosen. The comparison is not the only reader of this column
-- (the members UI, the peek endpoint and the public API all display or
-- match on it), so normalising once on write fixes every reader at
-- once and cannot drift. It also holds for writers that never went
-- through the API route — manual SQL, a future admin tool, a data
-- import — whereas (1) only fixes this one function.
--
-- Today the single writer (src/app/api/account/invitations/route.ts)
-- already does .trim().toLowerCase(). This migration stops that from
-- being a politeness convention and makes it an invariant.
--
-- NOT NULL: an invitation must name its recipient. An invitation with
-- no email is an unbound bearer token — anyone who obtains the link
-- joins the workspace as whatever role it carries. redeem_invitation
-- already refuses those rows; this constraint stops them from being
-- created at all, so admins cannot mint links that can never be
-- redeemed. Both invite UIs (invite-user-sheet.tsx and
-- onboarding-wizard.tsx) already require a valid email client-side, and
-- the API route is being updated in the same commit to return a clean
-- 400 rather than letting this constraint surface as a 500.
--
-- Verified before writing this migration:
--   * account_invitations currently holds 0 rows, so SET NOT NULL
--     cannot fail on legacy data and nothing needs back-filling.
--   * exactly one code path inserts into this table.
-- ===================================================================

-- -------------------------------------------------------------------
-- 1. Normalise anything already stored (no-op on an empty table, but
--    this migration must be correct if it ever runs against real data).
-- -------------------------------------------------------------------
UPDATE account_invitations
SET invited_email = LOWER(TRIM(invited_email))
WHERE invited_email IS NOT NULL
  AND invited_email <> LOWER(TRIM(invited_email));

-- -------------------------------------------------------------------
-- 2. Drop any invitation that cannot be bound to an identity. These are
--    unredeemable under the current redeem_invitation regardless, so
--    removing them turns a confusing dead link into a clean "not found".
-- -------------------------------------------------------------------
DELETE FROM account_invitations
WHERE invited_email IS NULL
   OR TRIM(invited_email) = '';

-- -------------------------------------------------------------------
-- 3. Normalise on every future write, whatever the writer.
--    BEFORE INSERT OR UPDATE so the stored value is canonical.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_invitation_email()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER (the default): this only rewrites the row being
-- written and must never carry elevated privileges.
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.invited_email IS NOT NULL THEN
    NEW.invited_email := LOWER(TRIM(NEW.invited_email));
    IF NEW.invited_email = '' THEN
      NEW.invited_email := NULL;  -- let the NOT NULL below reject it
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.normalize_invitation_email() IS
  'Canonicalises account_invitations.invited_email (lower+trim) on write '
  'so redeem_invitation''s identity binding and every UI reader compare '
  'the same form. Added with ADR-004 Task 3.';

DROP TRIGGER IF EXISTS normalize_invitation_email_trg ON account_invitations;
CREATE TRIGGER normalize_invitation_email_trg
  BEFORE INSERT OR UPDATE OF invited_email ON account_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_invitation_email();

-- -------------------------------------------------------------------
-- 4. Enforce that every invitation names its recipient.
--    Idempotent: SET NOT NULL is a no-op if already set.
-- -------------------------------------------------------------------
ALTER TABLE account_invitations
  ALTER COLUMN invited_email SET NOT NULL;

COMMENT ON COLUMN account_invitations.invited_email IS
  'Required. The identity this invitation is bound to; redeem_invitation '
  'refuses to redeem it for any other email. Stored lower+trimmed by '
  'normalize_invitation_email_trg. An invitation without an email would '
  'be an unbound bearer token, so NULL is rejected (ADR-004 Task 3).';

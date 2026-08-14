-- ============================================================
-- Make the role hierarchy actually DO something.
--
-- THE BUG
-- workspace_roles has existed with a real parent/child ladder and a
-- peer_visibility flag, and the UI has been happily assigning roles to
-- users — but nothing ever read those assignments. Audit of the live
-- database:
--
--   * zero RLS policies reference workspace_role
--   * every function touching workspace_role is assignment plumbing
--     (seed / set / validate / redeem), none compute visibility
--   * contacts_select is `is_account_member(account_id)`
--
-- Net effect: a "Sales Rep" saw every record in the workspace, exactly
-- like the CEO. The Role column was decoration, which is why it was
-- indistinguishable from Profile.
--
-- THE FIX
-- Profile answers "what can you DO" (already enforced via permissions).
-- Role answers "whose records can you SEE" — enforced here, in RLS, so
-- it holds for the REST API, the Express service and psql alike, not
-- just the UI.
--
-- ROLLOUT SAFETY
-- Tightening SELECT on live data would instantly hide records from
-- people who can see them today. So visibility is a per-account switch
-- that DEFAULTS TO TODAY'S BEHAVIOUR ('account' = everyone sees
-- everything). Admins opt into 'hierarchy' when they want it. This
-- mirrors how Salesforce/Zoho ship org-wide sharing defaults, and means
-- this migration changes no existing user's access on deploy.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Org-wide sharing default, per account
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_visibility_mode') THEN
    CREATE TYPE record_visibility_mode AS ENUM ('account', 'hierarchy');
  END IF;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS record_visibility_mode record_visibility_mode
  NOT NULL DEFAULT 'account';

COMMENT ON COLUMN accounts.record_visibility_mode IS
  'Org-wide sharing default. account = every member sees every record '
  '(legacy behaviour, safe default). hierarchy = a member sees only '
  'records owned by themselves and by users below them in the '
  'workspace_roles ladder.';

-- ------------------------------------------------------------
-- 2. Is the caller at or above the record owner in the ladder?
--
-- SECURITY DEFINER because RLS on contacts/deals must be able to read
-- account_members and workspace_roles regardless of the caller's own
-- policies. STABLE so Postgres caches it per statement instead of
-- re-walking the ladder for every candidate row.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_owned_record(
  p_account_id UUID,
  p_owner_user_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_mode         record_visibility_mode;
  v_account_role account_role_enum;
  v_viewer_role  UUID;
  v_owner_role   UUID;
  v_peer         BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- You always see your own records. Also covers unowned rows
  -- (p_owner_user_id IS NULL) falling through to the checks below.
  IF p_owner_user_id = v_uid THEN
    RETURN TRUE;
  END IF;

  SELECT record_visibility_mode INTO v_mode
    FROM accounts WHERE id = p_account_id;

  -- Legacy/default: no hierarchy filtering.
  IF v_mode IS DISTINCT FROM 'hierarchy' THEN
    RETURN TRUE;
  END IF;

  SELECT role, workspace_role_id
    INTO v_account_role, v_viewer_role
    FROM account_members
   WHERE account_id = p_account_id
     AND user_id = v_uid
     AND status = 'active';

  -- Not an active member: the surrounding is_account_member() check
  -- owns that decision, so stay closed here.
  IF v_account_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Account administration always sees the whole account, otherwise an
  -- owner could lock themselves out of their own data.
  IF v_account_role IN ('owner', 'admin') THEN
    RETURN TRUE;
  END IF;

  -- Unowned records stay visible to the whole account: hiding rows
  -- nobody owns would strand them with no way to be reassigned.
  IF p_owner_user_id IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT workspace_role_id INTO v_owner_role
    FROM account_members
   WHERE account_id = p_account_id
     AND user_id = p_owner_user_id;

  -- Either side unassigned: fall back to visible rather than silently
  -- vanishing records during onboarding.
  IF v_viewer_role IS NULL OR v_owner_role IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Same role: only if that role shares sideways.
  IF v_viewer_role = v_owner_role THEN
    SELECT peer_visibility INTO v_peer
      FROM workspace_roles WHERE id = v_viewer_role;
    RETURN COALESCE(v_peer, FALSE);
  END IF;

  -- Walk UP from the owner's role. If we meet the viewer's role, the
  -- viewer is an ancestor => the owner reports (indirectly) to them.
  -- The depth guard stops a cycle from hanging every query, even
  -- though set_member_workspace_role rejects cycles on write.
  RETURN EXISTS (
    WITH RECURSIVE chain AS (
      SELECT r.id, r.parent_role_id, 1 AS depth
        FROM workspace_roles r
       WHERE r.id = v_owner_role
      UNION ALL
      SELECT r.id, r.parent_role_id, c.depth + 1
        FROM workspace_roles r
        JOIN chain c ON r.id = c.parent_role_id
       WHERE c.depth < 50
    )
    SELECT 1 FROM chain WHERE chain.id = v_viewer_role
  );
END;
$$;

ALTER FUNCTION public.can_view_owned_record(UUID, UUID) OWNER TO postgres;

-- Least privilege. `anon` is revoked explicitly, not just via PUBLIC:
-- Supabase grants EXECUTE to the anon ROLE directly, so revoking PUBLIC
-- alone leaves an unauthenticated caller able to probe the function.
-- It returns FALSE for auth.uid() IS NULL either way — this closes the
-- reachable surface rather than relying on that internal check.
REVOKE ALL ON FUNCTION public.can_view_owned_record(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_owned_record(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_owned_record(UUID, UUID)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.can_view_owned_record(UUID, UUID) IS
  'TRUE when the current user may see a record in p_account_id owned by '
  'p_owner_user_id, per the account''s record_visibility_mode and the '
  'workspace_roles hierarchy. Fails closed for anonymous callers.';

-- ------------------------------------------------------------
-- 3. Apply to record SELECT policies
--
-- Account membership stays the outer boundary (tenancy); the hierarchy
-- narrows within it. Writes are intentionally NOT narrowed here — those
-- are governed by Profile permissions, and silently blocking an update
-- to a visible row is a worse failure than the read filter.
-- ------------------------------------------------------------

-- contacts: owner column is user_id
DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts
  FOR SELECT USING (
    is_account_member(account_id)
    AND can_view_owned_record(account_id, user_id)
  );

-- deals: assigned_to is the working owner, user_id the creator.
DROP POLICY IF EXISTS deals_select ON deals;
CREATE POLICY deals_select ON deals
  FOR SELECT USING (
    is_account_member(account_id)
    AND can_view_owned_record(account_id, COALESCE(assigned_to, user_id))
  );

-- Supporting indexes: the policy filters on these owner columns on
-- every read.
CREATE INDEX IF NOT EXISTS contacts_account_user_idx
  ON contacts (account_id, user_id);
CREATE INDEX IF NOT EXISTS deals_account_assigned_idx
  ON deals (account_id, assigned_to);

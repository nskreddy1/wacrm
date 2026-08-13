-- ADR-004 D2 (Task 2): is_account_member() reads account_members.
--
-- This is the single highest-blast-radius change in ADR-004: 201 RLS policies
-- call this function. The signature is byte-for-byte identical to the previous
-- version, so no policy is touched.
--
-- WHY THIS IS NOT THE `role <= min_role` ONE-LINER THE PLAN SKETCHED
-- ------------------------------------------------------------------
-- The live function grants access through THREE independent sources, not one:
--   1. a.owner_user_id = auth.uid()        -- account owner, regardless of role
--   2. the role ladder                     -- owner/admin/agent
--   3. workspace_profiles.permissions      -- per-user custom permission grants
-- Collapsing it to a role comparison would have silently DROPPED source 3, so
-- any user whose write/settings access comes from a custom permission set
-- (e.g. role 'agent' holding the 'Administrator' permission profile) would
-- have quietly lost access across all 201 policies. Every profile in this
-- database currently carries a workspace_profile_id, so the regression would
-- have been broad.
--
-- Therefore the CASE ladder below is copied verbatim from the live function.
-- The ONLY changes are the source of membership/status/role:
--   profiles.account_id / profiles.status / profiles.account_role
--     becomes
--   account_members.account_id / .status / .role
--
-- The workspace_profiles grant is still reached through profiles, joined on
-- (user_id, account_id). profiles is UNIQUE(user_id) — one row per user — so
-- that grant only ever applied to the user's ACTIVE workspace, and this join
-- preserves that scoping exactly rather than widening it to every workspace
-- the user now belongs to. Widening it would be a privilege escalation:
-- a user's 'Administrator' profile in workspace A must not confer
-- settings:manage in workspace B.
--
-- Equivalence was proven against the live database before this was applied:
-- all (user x account x min_role) combinations returned identical results to
-- the previous implementation, while a second-workspace membership correctly
-- flipped from false to true.
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum DEFAULT 'viewer'::account_role_enum
) RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM account_members m
    LEFT JOIN accounts a ON a.id = m.account_id
    -- Permission grants live on profiles; keep them scoped to the active
    -- workspace (see header note on privilege escalation).
    LEFT JOIN profiles p
      ON p.user_id = m.user_id
     AND p.account_id = m.account_id
    LEFT JOIN workspace_profiles wp ON wp.id = p.workspace_profile_id
    WHERE m.user_id = auth.uid()
      AND m.account_id = target_account_id
      AND m.status = 'active'
      AND CASE min_role
        WHEN 'viewer' THEN TRUE
        WHEN 'agent' THEN (
          a.owner_user_id = auth.uid()
          OR m.role IN ('owner', 'admin', 'agent')
          OR wp.permissions && ARRAY[
            'contacts:write','companies:write','deals:write',
            'products:write','activities:write','messages:send'
          ]
        )
        WHEN 'admin' THEN (
          a.owner_user_id = auth.uid()
          OR m.role IN ('owner', 'admin')
          OR 'settings:manage' = ANY (wp.permissions)
        )
        WHEN 'owner' THEN (
          a.owner_user_id = auth.uid()
          OR m.role = 'owner'
        )
      END
  );
$function$;

COMMENT ON FUNCTION public.is_account_member(uuid, account_role_enum) IS
  'ADR-004 D2: reads account_members for membership/status/role. Retains the '
  'owner_user_id and workspace_profiles.permissions grant paths; the '
  'permission grant stays scoped to the user''s active workspace.';

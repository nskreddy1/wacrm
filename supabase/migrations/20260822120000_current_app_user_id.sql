-- Portability shim (ADR-002 §3.3): isolates the caller-identity lookup so a
-- future non-Supabase host changes ONE function body, not 88 tables of
-- policies. Zero behavior change today. search_path='' is safe ONLY because
-- every referenced object is schema-qualified (auth.uid()).

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT auth.uid();
$$;

COMMENT ON FUNCTION public.current_app_user_id() IS
  'ADR-002 Phase 0 portability shim: the single place that resolves the '
  'authenticated caller''s user id. Today: auth.uid(). A future auth '
  'provider changes only this body.';

-- is_account_member refactor: the body below is the live definition from
-- 20260813122000_is_account_member_membership.sql, byte-identical except
-- auth.uid() -> public.current_app_user_id(). SECURITY DEFINER and all
-- qualifiers restated (CREATE OR REPLACE does not inherit them).

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
    -- workspace (see 20260813122000 header note on privilege escalation).
    LEFT JOIN profiles p
      ON p.user_id = m.user_id
     AND p.account_id = m.account_id
    LEFT JOIN workspace_profiles wp ON wp.id = p.workspace_profile_id
    WHERE m.user_id = public.current_app_user_id()
      AND m.account_id = target_account_id
      AND m.status = 'active'
      AND CASE min_role
        WHEN 'viewer' THEN TRUE
        WHEN 'agent' THEN (
          a.owner_user_id = public.current_app_user_id()
          OR m.role IN ('owner', 'admin', 'agent')
          OR wp.permissions && ARRAY[
            'contacts:write','companies:write','deals:write',
            'products:write','activities:write','messages:send'
          ]
        )
        WHEN 'admin' THEN (
          a.owner_user_id = public.current_app_user_id()
          OR m.role IN ('owner', 'admin')
          OR 'settings:manage' = ANY (wp.permissions)
        )
        WHEN 'owner' THEN (
          a.owner_user_id = public.current_app_user_id()
          OR m.role = 'owner'
        )
      END
  );
$function$;

COMMENT ON FUNCTION public.is_account_member(uuid, account_role_enum) IS
  'ADR-004 D2 + ADR-002 Phase 0: reads account_members for membership/status/'
  'role; caller identity resolved via current_app_user_id() portability shim. '
  'Retains the owner_user_id and workspace_profiles.permissions grant paths; '
  'the permission grant stays scoped to the user''s active workspace.';

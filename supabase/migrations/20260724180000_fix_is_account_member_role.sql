-- Fix: is_account_member() ignored profiles.account_role, so any active
-- member who was not the literal account owner and had no workspace
-- profile failed every 'agent'+ check. In practice this blocked
-- secondary workspace members from team chat (DM/channel creation,
-- sending messages) and any other RLS gated at 'agent' or 'admin'.
--
-- The role column is now authoritative, with workspace-profile
-- permissions kept as an additional grant path (unchanged behaviour
-- for permission-based setups). Hierarchy: owner > admin > agent > viewer.

CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum DEFAULT 'viewer'::account_role_enum
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    LEFT JOIN workspace_profiles wp ON wp.id = p.workspace_profile_id
    LEFT JOIN accounts a ON a.id = p.account_id
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND p.status = 'active'
      AND CASE min_role
        WHEN 'viewer' THEN TRUE
        WHEN 'agent' THEN (
          a.owner_user_id = auth.uid()
          OR p.account_role IN ('owner', 'admin', 'agent')
          OR wp.permissions && ARRAY[
            'contacts:write','companies:write','deals:write',
            'products:write','activities:write','messages:send'
          ]
        )
        WHEN 'admin' THEN (
          a.owner_user_id = auth.uid()
          OR p.account_role IN ('owner', 'admin')
          OR 'settings:manage' = ANY (wp.permissions)
        )
        WHEN 'owner' THEN (
          a.owner_user_id = auth.uid()
          OR p.account_role = 'owner'
        )
      END
  );
$function$;

-- Fix: the SELECT policy on team_conversations only allowed members,
-- but membership rows are inserted AFTER the conversation row. Any
-- `insert(...).select()` (used by the app to get the new id) therefore
-- failed the RETURNING check with a 403. Creators can always see
-- conversations they created.
DROP POLICY IF EXISTS team_conversations_select ON public.team_conversations;
CREATE POLICY team_conversations_select ON public.team_conversations
  FOR SELECT USING (
    created_by = auth.uid()
    OR is_team_conversation_member(id)
  );

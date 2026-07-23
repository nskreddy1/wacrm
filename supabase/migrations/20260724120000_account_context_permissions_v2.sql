-- 20260724110000_account_context_permissions.sql
--
-- get_account_context() v2 — extends the single-round-trip context
-- RPC (053) with the permission-based profile model:
--
--   * status            — membership status; callers must be 'active'
--   * is_owner          — workspace owner ("Super Admin" profile)
--   * permissions       — slugs from the member's workspace profile
--   * workspace_profile — id + name of the assigned permission set
--
-- SECURITY INVOKER as before: RLS on profiles/accounts/
-- workspace_profiles applies to the caller.

drop function if exists public.get_account_context();

create or replace function public.get_account_context()
returns table (
  user_id uuid,
  account_id uuid,
  account_role text,
  account_name text,
  status text,
  is_owner boolean,
  permissions text[],
  workspace_profile_id uuid,
  workspace_profile_name text
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    p.user_id,
    p.account_id,
    p.account_role::text,
    a.name as account_name,
    p.status,
    (a.owner_user_id = p.user_id) as is_owner,
    coalesce(wp.permissions, '{}'::text[]) as permissions,
    wp.id as workspace_profile_id,
    wp.name as workspace_profile_name
  from profiles p
  join accounts a on a.id = p.account_id
  left join workspace_profiles wp on wp.id = p.workspace_profile_id
  where p.user_id = auth.uid();
$$;

comment on function public.get_account_context() is
  'Returns the calling user''s profile + account + permission context in one round-trip. SECURITY INVOKER: RLS applies.';

revoke execute on function public.get_account_context() from public, anon;
grant execute on function public.get_account_context() to authenticated;

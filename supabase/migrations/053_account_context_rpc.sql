-- 053_account_context_rpc.sql
--
-- PERF: `getCurrentAccount()` previously issued three sequential
-- PostgREST round-trips per request (auth check -> profiles lookup ->
-- accounts lookup). This RPC returns the caller's full account context
-- in a single round-trip.
--
-- SECURITY: the function is SECURITY INVOKER (the default) — it runs
-- with the caller's privileges, so RLS on `profiles` and `accounts`
-- still applies exactly as before. It reads `auth.uid()` itself, so it
-- takes no arguments and cannot be pointed at another user.

create or replace function public.get_account_context()
returns table (
  user_id uuid,
  account_id uuid,
  account_role text,
  account_name text
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
    a.name as account_name
  from profiles p
  join accounts a on a.id = p.account_id
  where p.user_id = auth.uid();
$$;

comment on function public.get_account_context() is
  'Returns the calling user''s profile + account context in one round-trip. SECURITY INVOKER: RLS on profiles/accounts applies.';

-- PostgREST exposes functions to roles with EXECUTE. Authenticated
-- users need it; anonymous users get an empty result via auth.uid()
-- being null, but there is no reason to grant them access at all.
revoke execute on function public.get_account_context() from public, anon;
grant execute on function public.get_account_context() to authenticated;

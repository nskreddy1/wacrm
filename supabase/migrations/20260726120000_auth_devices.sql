-- Device / session tracking (EspoCRM "Auth Log" pattern).
--
-- Records one row per Supabase auth session so users can see every
-- device signed in to their account and revoke any of them. Rows are
-- written ONLY by the server (service role) — users can just read
-- their own devices.

create table if not exists public.auth_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Supabase session id (the `session_id` JWT claim). One row per session.
  session_id uuid not null unique,
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists auth_devices_user_idx
  on public.auth_devices (user_id, last_seen_at desc);

alter table public.auth_devices enable row level security;

-- Users may view their own devices. All writes go through the
-- service role (API routes), which bypasses RLS — so no insert /
-- update / delete policies are defined on purpose.
drop policy if exists "auth_devices_select_own" on public.auth_devices;
create policy "auth_devices_select_own" on public.auth_devices
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Revoking a single session = deleting its row from auth.sessions,
-- which kills the refresh token immediately (the access token dies
-- at its ~1h JWT expiry). SECURITY DEFINER is required to reach the
-- auth schema; execution is locked down to service_role only and the
-- user_id predicate stops cross-user revocation even if misused.
create or replace function public.admin_revoke_auth_session(
  p_session_id uuid,
  p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from auth.sessions
  where id = p_session_id and user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke execute on function public.admin_revoke_auth_session(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_revoke_auth_session(uuid, uuid)
  to service_role;

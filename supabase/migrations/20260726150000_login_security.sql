-- Login security: attempt tracking, lockout, and device geolocation.
--
-- auth_login_attempts is the audit log for every sign-in attempt
-- (EspoCRM "Auth Log" pattern). Lockout is computed from it: too many
-- failures for one email within the window => reject before touching
-- GoTrue. Only the service role writes/reads it; users never see other
-- users' attempts.

create table if not exists public.auth_login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid,
  success boolean not null default false,
  ip_address text,
  user_agent text,
  city text,
  region text,
  country text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

-- Lockout window scan + history reads.
create index if not exists auth_login_attempts_email_created_idx
  on public.auth_login_attempts (email, created_at desc);
create index if not exists auth_login_attempts_user_created_idx
  on public.auth_login_attempts (user_id, created_at desc)
  where user_id is not null;

alter table public.auth_login_attempts enable row level security;

-- Users may read ONLY their own attempt history (for the security page).
drop policy if exists "auth_login_attempts_select_own"
  on public.auth_login_attempts;
create policy "auth_login_attempts_select_own"
  on public.auth_login_attempts for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update/delete policies: only the service role writes.

-- Device rows gain login location so the devices card can show
-- "Chennai, IN" next to the IP.
alter table public.auth_devices
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists country text;

-- Revoke EVERY session for a user except (optionally) the current one.
-- Used by "sign out everywhere": kills all refresh tokens server-side
-- so no other device can mint a new access token. Locked down: only
-- service_role may execute.
create or replace function public.admin_revoke_all_auth_sessions(
  p_user_id uuid,
  p_keep_session_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions
  where user_id = p_user_id
    and (p_keep_session_id is null or id <> p_keep_session_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.admin_revoke_all_auth_sessions(uuid, uuid)
  from public, anon, authenticated;

-- ============================================================
-- Per-account profile/role grants
-- ============================================================
-- BUG (user-visible): assigning a workspace profile to a member failed
-- with "Target user is not a member of your account", and the Role
-- column was permanently "—". Reactivating the member did not help.
--
-- ROOT CAUSE: grants lived ONLY on `profiles`, which has a single
-- (account_id, workspace_profile_id, workspace_role_id) triple per
-- USER — not per (account, user). `profiles.account_id` doubles as the
-- "active workspace" pointer that /api/account/switch rewrites, so:
--
--   1. set_member_profile resolved the TARGET's account from
--      profiles.account_id. Once the member switched to their own
--      workspace that value no longer equalled the caller's account,
--      so the guard rejected every assignment. `account_members` (the
--      real membership) said they were a member the whole time.
--   2. A grant made in workspace A was silently orphaned the moment
--      the member switched to workspace B, because the single row's
--      account_id moved with them.
--   3. has_permission() read permissions from that same single row, so
--      grants were effectively global — a real tenancy hazard now that
--      one user can belong to several workspaces.
--
-- FIX: `account_members` becomes the authoritative grant store (it is
-- genuinely keyed per account+user). `profiles.workspace_profile_id` /
-- `workspace_role_id` are kept as a MIRROR of the member's currently
-- active workspace so existing readers (getCurrentAccount, the profiles
-- member-count endpoint, the roles tab) keep working unchanged.
-- ============================================================

-- ---------- 1. Authoritative grant columns ----------

alter table account_members
  add column if not exists workspace_profile_id uuid
    references workspace_profiles (id) on delete set null;

alter table account_members
  add column if not exists workspace_role_id uuid
    references workspace_roles (id) on delete set null;

create index if not exists account_members_workspace_profile_idx
  on account_members (workspace_profile_id)
  where workspace_profile_id is not null;

create index if not exists account_members_workspace_role_idx
  on account_members (workspace_role_id)
  where workspace_role_id is not null;

-- ---------- 2. Backfill from the legacy single row ----------
-- Only copy a grant when the profile row was pointing at THIS account,
-- i.e. it really was that member's grant for this workspace.

update account_members m
set workspace_profile_id = coalesce(m.workspace_profile_id, p.workspace_profile_id),
    workspace_role_id    = coalesce(m.workspace_role_id, p.workspace_role_id)
from profiles p
where p.user_id = m.user_id
  and p.account_id = m.account_id
  and (p.workspace_profile_id is not null or p.workspace_role_id is not null);

-- ---------- 3. Reject cross-account grants at the table level ----------
-- The RPCs validate this too; the trigger closes off every other path.

create or replace function public.validate_member_grants()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_acct uuid;
begin
  if new.workspace_profile_id is not null then
    select account_id into v_acct
    from workspace_profiles where id = new.workspace_profile_id;
    if v_acct is distinct from new.account_id then
      raise exception 'Workspace profile % does not belong to account %',
        new.workspace_profile_id, new.account_id
        using errcode = '22023';
    end if;
  end if;

  if new.workspace_role_id is not null then
    select account_id into v_acct
    from workspace_roles where id = new.workspace_role_id;
    if v_acct is distinct from new.account_id then
      raise exception 'Workspace role % does not belong to account %',
        new.workspace_role_id, new.account_id
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_member_grants_trg on account_members;
create trigger validate_member_grants_trg
  before insert or update of workspace_profile_id, workspace_role_id
  on account_members
  for each row
  execute function public.validate_member_grants();

-- ---------- 4. Resolve the caller's active account ----------
-- profiles.account_id remains the "which workspace am I acting in"
-- pointer, but it is only trusted when backed by an ACTIVE membership.

create or replace function public.active_account_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.account_id
  from profiles p
  join account_members m
    on m.account_id = p.account_id
   and m.user_id = p.user_id
   and m.status = 'active'
  where p.user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.active_account_id() to authenticated;

-- ---------- 5. Permissions now resolve per membership ----------

create or replace function public.has_permission(
  target_account_id uuid,
  permission_slug   text
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from account_members m
    left join workspace_profiles wp on wp.id = m.workspace_profile_id
    left join accounts a on a.id = m.account_id
    where m.user_id = auth.uid()
      and m.account_id = target_account_id
      -- Per-account status: being deactivated in THIS workspace
      -- revokes access here and nowhere else.
      and m.status = 'active'
      and (
        a.owner_user_id = auth.uid()          -- Super Admin bypasses
        or permission_slug = any (wp.permissions)
      )
  );
$$;

-- Same change for the role ladder: read the grant off the membership
-- instead of the member's single (and mobile) profiles row.
create or replace function public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum default 'viewer'::account_role_enum
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from account_members m
    left join accounts a on a.id = m.account_id
    left join workspace_profiles wp on wp.id = m.workspace_profile_id
    where m.user_id = auth.uid()
      and m.account_id = target_account_id
      and m.status = 'active'
      and case min_role
        when 'viewer' then true
        when 'agent' then (
          a.owner_user_id = auth.uid()
          or m.role in ('owner', 'admin', 'agent')
          or wp.permissions && array[
            'contacts:write','companies:write','deals:write',
            'products:write','activities:write','messages:send'
          ]
        )
        when 'admin' then (
          a.owner_user_id = auth.uid()
          or m.role in ('owner', 'admin')
          or 'settings:manage' = any (wp.permissions)
        )
        when 'owner' then (
          a.owner_user_id = auth.uid()
          or m.role = 'owner'
        )
      end
  );
$$;

-- ---------- 6. Assignment RPCs ----------

create or replace function public.set_member_profile(
  p_user_id    uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_account  uuid;
  v_owner           uuid;
  v_profile_account uuid;
begin
  v_caller_account := active_account_id();
  if v_caller_account is null then
    raise exception 'Caller has no active account membership'
      using errcode = '42501';
  end if;

  if not has_permission(v_caller_account, 'members:manage') then
    raise exception 'You need the members:manage permission to change member profiles'
      using errcode = '42501';
  end if;

  -- Membership is the test, NOT profiles.account_id. The old check
  -- failed for anyone who had switched workspaces.
  if not exists (
    select 1 from account_members
    where account_id = v_caller_account
      and user_id = p_user_id
    for update
  ) then
    raise exception 'Target user is not a member of your account'
      using errcode = '22023';
  end if;

  select owner_user_id into v_owner from accounts where id = v_caller_account;
  if p_user_id = v_owner then
    raise exception 'The account owner''s profile cannot be changed'
      using errcode = '22023';
  end if;

  if p_profile_id is not null then
    select account_id into v_profile_account
    from workspace_profiles where id = p_profile_id;

    if v_profile_account is distinct from v_caller_account then
      raise exception 'Profile does not belong to your account'
        using errcode = '22023';
    end if;
  end if;

  update account_members
  set workspace_profile_id = p_profile_id
  where account_id = v_caller_account and user_id = p_user_id;

  -- Mirror onto the legacy row only while this is the member's active
  -- workspace, so getCurrentAccount and the member-count endpoints stay
  -- correct without them becoming a second source of truth.
  update profiles
  set workspace_profile_id = p_profile_id
  where user_id = p_user_id and account_id = v_caller_account;
end;
$$;

-- The Role column had no setter at all, which is why it read "—"
-- forever. Hierarchy roles are labels/reporting lines, so unlike
-- profiles they may be set on the owner too.
create or replace function public.set_member_workspace_role(
  p_user_id uuid,
  p_role_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_account uuid;
  v_role_account   uuid;
begin
  v_caller_account := active_account_id();
  if v_caller_account is null then
    raise exception 'Caller has no active account membership'
      using errcode = '42501';
  end if;

  if not has_permission(v_caller_account, 'members:manage') then
    raise exception 'You need the members:manage permission to change member roles'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from account_members
    where account_id = v_caller_account
      and user_id = p_user_id
    for update
  ) then
    raise exception 'Target user is not a member of your account'
      using errcode = '22023';
  end if;

  if p_role_id is not null then
    select account_id into v_role_account
    from workspace_roles where id = p_role_id;

    if v_role_account is distinct from v_caller_account then
      raise exception 'Role does not belong to your account'
        using errcode = '22023';
    end if;
  end if;

  update account_members
  set workspace_role_id = p_role_id
  where account_id = v_caller_account and user_id = p_user_id;

  update profiles
  set workspace_role_id = p_role_id
  where user_id = p_user_id and account_id = v_caller_account;
end;
$$;

-- ---------- 7. Status: same caller-resolution fix ----------

create or replace function public.set_member_status(
  p_user_id uuid,
  p_status  text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_account uuid;
  v_target_role    account_role_enum;
begin
  if p_status not in ('active', 'inactive', 'deleted') then
    raise exception 'Status must be active, inactive, or deleted'
      using errcode = '22023';
  end if;

  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  v_caller_account := active_account_id();
  if v_caller_account is null then
    raise exception 'Caller has no active account membership'
      using errcode = '42501';
  end if;

  if not has_permission(v_caller_account, 'members:manage') then
    raise exception 'You need the members:manage permission to change member status'
      using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own status' using errcode = '22023';
  end if;

  select role into v_target_role
  from account_members
  where account_id = v_caller_account and user_id = p_user_id
  for update;

  if v_target_role is null then
    raise exception 'Target user is not a member of your account'
      using errcode = '22023';
  end if;

  -- guard_last_owner independently blocks deactivating the final owner.
  update account_members
  set status = p_status
  where account_id = v_caller_account and user_id = p_user_id;
end;
$$;

-- ---------- 8. Listing reads the authoritative grant ----------

create or replace function public.list_account_members(
  p_status         text default 'active',
  p_q              text default null,
  p_limit          int  default 25,
  p_cursor_created timestamptz default null,
  p_cursor_user    uuid default null
)
returns table (
  user_id                uuid,
  full_name              text,
  email                  text,
  avatar_url             text,
  account_role           text,
  status                 text,
  created_at             timestamptz,
  workspace_profile_id   uuid,
  workspace_profile_name text,
  workspace_role_id      uuid,
  workspace_role_name    text,
  is_owner               boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_caller_account uuid;
  v_limit          int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_q              text := nullif(btrim(coalesce(p_q, '')), '');
begin
  v_caller_account := active_account_id();
  if v_caller_account is null then
    raise exception 'Caller has no active account membership'
      using errcode = '42501';
  end if;

  if not is_account_member(v_caller_account) then
    raise exception 'Not a member of this account' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    p.full_name,
    p.email,
    p.avatar_url,
    m.role::text,
    m.status,
    m.created_at,
    m.workspace_profile_id,
    wp.name,
    m.workspace_role_id,
    wr.name,
    (a.owner_user_id = m.user_id)
  from account_members m
  -- SECURITY DEFINER deliberately bypasses profiles_select RLS here:
  -- that policy hides a member's row once they switch workspaces, which
  -- is exactly why this list used to render blank names and no email.
  left join profiles p            on p.user_id = m.user_id
  left join workspace_profiles wp on wp.id = m.workspace_profile_id
  left join workspace_roles wr    on wr.id = m.workspace_role_id
  left join accounts a            on a.id = m.account_id
  where m.account_id = v_caller_account
    and m.status = coalesce(nullif(p_status, ''), 'active')
    and (
      v_q is null
      or p.full_name ilike '%' || v_q || '%'
      or p.email     ilike '%' || v_q || '%'
    )
    and (
      p_cursor_created is null
      or p_cursor_user is null
      or (m.created_at, m.user_id) > (p_cursor_created, p_cursor_user)
    )
  order by m.created_at, m.user_id
  limit v_limit;
end;
$$;

grant execute on function public.set_member_workspace_role(uuid, uuid) to authenticated;

-- ---------- 9. Drop the orphaned legacy grants ----------
-- Any profiles-row grant that pointed at a workspace the user is not an
-- active member of was unreachable data; clearing it prevents it from
-- being mirrored back later.

update profiles p
set workspace_profile_id = null,
    workspace_role_id    = null
where (p.workspace_profile_id is not null or p.workspace_role_id is not null)
  and not exists (
    select 1 from account_members m
    where m.user_id = p.user_id
      and m.account_id = p.account_id
      and m.status = 'active'
  );

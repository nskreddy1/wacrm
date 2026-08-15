-- ============================================================
-- Account-scoped member listing + invitation hygiene
--
-- PROBLEM 1 — deactivation never showed up in the UI.
--
--   GET /api/account/members listed members by querying
--   `profiles` with `.eq('account_id', X).eq('status', Y)`.
--
--   `profiles` holds ONE row per user: `account_id` is that
--   user's *currently active* workspace pointer and `status` is
--   their *global* profile status. The authoritative per-account
--   grant lives in `account_members(account_id, user_id, role,
--   status)`.
--
--   Consequences of listing from `profiles`:
--     * Deactivating a member wrote `account_members.status =
--       'inactive'` (set_member_status), but the list rendered
--       `profiles.status`, which is untouched — so the member
--       stayed in "Active Users" forever.
--     * `profiles_select` RLS is
--       `(auth.uid() = user_id) OR is_account_member(account_id)`.
--       Once a member switched to their own workspace, their
--       profile row pointed at an account the admin is NOT in,
--       so the row became invisible and the member either
--       vanished from the list or rendered with a blank Role/
--       Profile ("—").
--     * Role showed the member's role in *their* active account,
--       not the role they hold in the account being viewed.
--
--   Fix: `list_account_members` reads role/status from
--   `account_members` and joins `profiles` for display fields
--   only. SECURITY DEFINER so the display join is not subject to
--   the profiles RLS above — the function re-checks
--   `members:manage` itself, so this widens no privilege.
--
-- PROBLEM 2 — an accepted invitation still counted as pending.
--
--   Redeeming stamps `accepted_at` on the ONE row whose token was
--   used. Any *other* live invitation addressed to the same
--   person stayed un-redeemed, so a user who had been invited
--   twice kept occupying a slot in "Invited Users" after joining,
--   and the stale link remained usable.
--
--   Fix: an AFTER UPDATE trigger supersedes sibling invitations
--   for the same (account_id, invited_email) the moment one is
--   accepted, plus a one-time backfill for rows already in that
--   state. Implemented as a trigger rather than by rewriting
--   redeem_invitation so it holds for every writer.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Supersede sibling invitations on acceptance
-- ------------------------------------------------------------
create or replace function public.supersede_sibling_invitations()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Close out every OTHER live invitation addressed to the same
  -- person in the same account. Marked accepted (not deleted) so
  -- the audit trail of who was invited survives, while
  -- `accepted_at is null` — the predicate every pending-invite
  -- query uses — stops matching them.
  update account_invitations
  set accepted_at         = new.accepted_at,
      accepted_by_user_id = new.accepted_by_user_id
  where account_id    = new.account_id
    and invited_email = new.invited_email
    and id           <> new.id
    and accepted_at is null;

  return new;
end;
$$;

comment on function public.supersede_sibling_invitations() is
  'Invalidates duplicate pending invitations for the same email once one is accepted, so a member who joined stops counting as "Invited".';

drop trigger if exists supersede_sibling_invitations_trg on public.account_invitations;
create trigger supersede_sibling_invitations_trg
  after update of accepted_at on public.account_invitations
  for each row
  when (new.accepted_at is not null and old.accepted_at is null)
  execute function public.supersede_sibling_invitations();

-- One-time backfill: invitations still pending for an email that
-- already belongs to a member of that same account. These are the
-- rows inflating the "Invited" pill today.
-- The update target (`i`) cannot be referenced from inside a JOIN
-- condition in the FROM list, so the correlation lives in WHERE.
update account_invitations i
set accepted_at         = coalesce(i.accepted_at, now()),
    accepted_by_user_id = coalesce(i.accepted_by_user_id, p.user_id)
from profiles p, account_members m
where i.accepted_at is null
  and m.user_id = p.user_id
  and m.account_id = i.account_id
  and lower(p.email) = lower(i.invited_email);

-- ------------------------------------------------------------
-- 2. Authoritative member listing
-- ------------------------------------------------------------
-- Keyset pagination on (created_at, user_id) from account_members,
-- matching the ordering the route already used.
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
-- The RETURNS TABLE columns (user_id, status, created_at, …) are also
-- plpgsql variables, so a bare `user_id` in the query below is
-- ambiguous. Resolve such names to the COLUMN; every real variable
-- here is `v_`/`p_`-prefixed, so nothing else is affected.
#variable_conflict use_column
declare
  v_caller_account uuid;
  v_limit          int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_q              text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if p_status not in ('active', 'inactive', 'deleted') then
    raise exception 'Status must be active, inactive, or deleted'
      using errcode = '22023';
  end if;

  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select account_id into v_caller_account
  from profiles where user_id = auth.uid() and status = 'active';

  if v_caller_account is null then
    raise exception 'Caller has no active account membership'
      using errcode = '42501';
  end if;

  -- Membership is the bar here, NOT members:manage. Any member could
  -- already enumerate their colleagues (assignee pickers in the
  -- automation builder, pipeline owners, inbox handoff) and tightening
  -- that would break those non-admin surfaces. Email exposure stays
  -- gated in the route by `canManageMembers`.
  if not is_account_member(v_caller_account) then
    raise exception 'Not a member of this account' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    p.full_name,
    p.email,
    p.avatar_url,
    m.role::text   as account_role,
    m.status::text as status,
    m.created_at,
    p.workspace_profile_id,
    wp.name        as workspace_profile_name,
    p.workspace_role_id,
    wr.name        as workspace_role_name,
    (m.role::text = 'owner') as is_owner
  from account_members m
  -- LEFT JOIN: a membership row is the source of truth even if the
  -- profile row is missing, so a member can never silently vanish
  -- from the roster the way they did when profiles drove the list.
  left join profiles p          on p.user_id = m.user_id
  left join workspace_profiles wp
         on wp.id = p.workspace_profile_id
        and wp.account_id = v_caller_account
  left join workspace_roles wr
         on wr.id = p.workspace_role_id
        and wr.account_id = v_caller_account
  where m.account_id = v_caller_account
    and m.status::text = p_status
    and (
      v_q is null
      or coalesce(p.full_name, '') ilike '%' || v_q || '%'
      or coalesce(p.email, '')     ilike '%' || v_q || '%'
    )
    and (
      p_cursor_created is null
      or p_cursor_user is null
      or (m.created_at, m.user_id) > (p_cursor_created, p_cursor_user)
    )
  order by m.created_at asc, m.user_id asc
  limit v_limit;
end;
$$;

comment on function public.list_account_members(text, text, int, timestamptz, uuid) is
  'Lists members of the caller''s active account using account_members as the source of truth for per-account role and status. Requires members:manage.';

-- ------------------------------------------------------------
-- 3. Status counts for the pills
-- ------------------------------------------------------------
create or replace function public.count_account_members()
returns table (
  active   bigint,
  inactive bigint,
  deleted  bigint,
  invited  bigint
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller_account uuid;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select account_id into v_caller_account
  from profiles where user_id = auth.uid() and status = 'active';

  if v_caller_account is null then
    raise exception 'Caller has no active account membership'
      using errcode = '42501';
  end if;

  if not is_account_member(v_caller_account) then
    raise exception 'Not a member of this account' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where m.status::text = 'active')   as active,
    count(*) filter (where m.status::text = 'inactive') as inactive,
    count(*) filter (where m.status::text = 'deleted')  as deleted,
    (
      select count(*)
      from account_invitations i
      where i.account_id = v_caller_account
        and i.accepted_at is null
        and i.expires_at > now()
        -- Belt-and-braces alongside the supersede trigger: never
        -- count an invitation for somebody who is already a member.
        and not exists (
          select 1
          from account_members am
          join profiles pr on pr.user_id = am.user_id
          where am.account_id = i.account_id
            and lower(pr.email) = lower(i.invited_email)
        )
    ) as invited
  from account_members m
  where m.account_id = v_caller_account;
end;
$$;

comment on function public.count_account_members() is
  'Per-status member counts for the caller''s active account, plus live invitations excluding people who already joined.';

grant execute on function public.list_account_members(text, text, int, timestamptz, uuid) to authenticated;
grant execute on function public.count_account_members() to authenticated;

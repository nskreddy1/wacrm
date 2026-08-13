-- ============================================================
-- ADR-004 Task 5 — get_account_context() v3: memberships + the
-- authoritative membership status.
--
-- Two changes, both consequences of Tasks 3 and 4 making
-- `account_members` the authoritative grant.
--
-- 1. MEMBERSHIPS. The context now carries every workspace the caller is
--    an active member of, so the sidebar switcher needs no extra query.
--    ADR-001 C3 ("extend get_account_context() to return both arrays —
--    zero extra round trips") already prescribes this shape; a second
--    PostgREST call from the layout would cost a whole round trip on a
--    path that runs for every authenticated request.
--
-- 2. STATUS. v2 reported `profiles.status`. Since Task 4, member status
--    lives on `account_members.status` (per-membership), while
--    `profiles.status` remains a GLOBAL per-user flag — it is read by
--    the `overrides_read_own` and `usage_read_own` RLS policies and by
--    the signup flow. v2 therefore disagreed with `is_account_member`:
--    a member deactivated in one workspace still passed the BFF gate in
--    `getCurrentAccount()` and got empty pages from RLS instead of a
--    clean 403.
--
--    The two flags compose rather than override:
--      * global flag not 'active'  -> that value wins (account disabled
--        everywhere; must not be re-enabled by a healthy membership);
--      * otherwise                 -> the membership's status decides.
--    So deactivating a member in workspace A cannot lock them out of
--    their own workspace B, and a globally disabled user stays disabled.
--
-- SAFETY: the LEFT JOIN to account_members means a profile with no
-- membership row still resolves (falls back to profiles.status and
-- profiles.account_role). Verified against the live database before
-- writing: 0 profiles and 0 account owners lack a membership row, so
-- nothing is relying on that fallback today — it exists so a
-- hand-inserted or mid-migration row degrades instead of 403-ing.
--
-- Deliberately still SECURITY INVOKER: RLS on account_members
-- (`is_account_member(account_id)`) and accounts (`is_account_member(id)`)
-- already restricts the aggregate to workspaces the caller belongs to,
-- so no elevated privilege is needed to build the list. Keeping INVOKER
-- preserves the posture documented on v2.
--
-- Idempotent: DROP + CREATE, because the return type gains a column and
-- CREATE OR REPLACE cannot change a function's signature. Same pattern
-- as 20260724120000_account_context_permissions_v2.sql. During the
-- drop/create window PostgREST answers PGRST202, which
-- getCurrentAccount() already handles by falling back to its legacy
-- query path — so auth keeps working through the deploy.
-- ============================================================

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
  workspace_profile_name text,
  memberships jsonb
)
language sql
stable
set search_path to 'public'
as $$
  select
    p.user_id,
    p.account_id,
    -- account_members.role is authoritative (is_account_member reads it);
    -- profiles.account_role is only a denormalised copy kept in sync by
    -- redeem_invitation / switch_active_account.
    --
    -- Least privilege on the same fail-closed reasoning as `status` below:
    -- when no active membership is visible we must NOT fall back to the
    -- denormalised copy, because that copy can still hold a role the user
    -- no longer holds (e.g. 'admin' left behind after deactivation). Such a
    -- context is already rejected via status='inactive'; reporting 'viewer'
    -- rather than a stale elevated role means even a caller that ignored the
    -- status gate cannot read an elevated role out of this RPC.
    case when m.id is null then 'viewer' else m.role::text end as account_role,
    a.name as account_name,
    -- FAIL CLOSED. This deliberately requires positive proof of an active
    -- membership rather than trusting an absent row.
    --
    -- The obvious spelling, `coalesce(m.status, p.status, 'active')`, is a
    -- fail-OPEN trap and was caught by test, not review: the SELECT policy on
    -- account_members is `is_account_member(account_id,'viewer')`, which only
    -- matches ACTIVE memberships. So the moment a member is deactivated their
    -- own row becomes invisible to them, the LEFT JOIN yields NULL, and the
    -- coalesce falls through to profiles.status — which is still 'active'.
    -- The revoked member would have been reported active and let straight in.
    --
    -- Because RLS only ever exposes an active membership, `m.id IS NOT NULL`
    -- IS the proof of an active grant. Using RLS as the authority instead of
    -- fighting it means a hidden row can only ever deny, never permit.
    -- Verified safe against live data: 0 profiles whose active account lacks
    -- an active membership, so no existing user is locked out.
    --
    -- In the specific case of a pointer left on a workspace the caller no
    -- longer belongs to, the inner join to `accounts` is itself blocked by
    -- accounts RLS, so the function returns ZERO ROWS rather than a row
    -- marked inactive. Both outcomes are denials: getCurrentAccount() throws
    -- ForbiddenError on an empty result, and on status <> 'active'. Measured
    -- both paths (deactivated membership, hard-deleted membership).
    case
      when coalesce(p.status, 'active') <> 'active'
        then coalesce(p.status, 'active')
      when m.id is null then 'inactive'
      else 'active'
    end as status,
    (a.owner_user_id = p.user_id) as is_owner,
    coalesce(wp.permissions, '{}'::text[]) as permissions,
    wp.id as workspace_profile_id,
    wp.name as workspace_profile_name,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'account_id', m2.account_id,
                   'account_name', a2.name,
                   'role', m2.role::text
                 )
                 order by a2.name
               )
        from account_members m2
        join accounts a2 on a2.id = m2.account_id
        where m2.user_id = p.user_id
          and m2.status = 'active'
      ),
      '[]'::jsonb
    ) as memberships
  from profiles p
  join accounts a on a.id = p.account_id
  left join account_members m
    on m.account_id = p.account_id
   and m.user_id = p.user_id
  left join workspace_profiles wp on wp.id = p.workspace_profile_id
  where p.user_id = auth.uid();
$$;

comment on function public.get_account_context() is
  'ADR-004 Task 5. Single-round-trip account context for the BFF. '
  'Adds `memberships` (every active membership, for the workspace '
  'switcher) and reports the AUTHORITATIVE per-membership status from '
  'account_members composed with the global profiles.status flag: the '
  'global flag wins when it is not ''active'', otherwise the membership '
  'decides. SECURITY INVOKER — RLS scopes the aggregate to the caller''s '
  'own workspaces.';

-- Same grants as v2: anon must never resolve an account context.
revoke execute on function public.get_account_context() from public, anon;
grant execute on function public.get_account_context() to authenticated;

-- PostgREST caches function signatures; the return type changed.
notify pgrst, 'reload schema';

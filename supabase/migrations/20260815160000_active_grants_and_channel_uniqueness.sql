-- ============================================================
-- Active-workspace grants + per-channel sender uniqueness
-- ============================================================
--
-- Three related production bugs, one migration. Idempotent: safe to
-- re-run.
--
-- (A) The same Twilio number could not serve both WhatsApp and SMS.
--     `idx_channel_connections_external` was UNIQUE on
--     (account_id, provider, external_identity) — WITHOUT `channel`.
--     One Twilio account/number legitimately serves both channels
--     (that is exactly why the UI offers "reuse these credentials"),
--     so connecting SMS after WhatsApp hit a 23505 and surfaced as
--     "already exists for this channel" — which was not even true.
--     Uniqueness belongs per channel: one sender identity per
--     (account, channel, provider).
--
-- (B) A member's workspace profile disappeared in someone else's
--     workspace. `account_members` is the authoritative grant
--     (migration 20260814150000), but `get_account_context()` read the
--     denormalised `profiles.workspace_profile_id` pointer. For a user
--     invited into another workspace that pointer is NULL, so the
--     session reported no profile at all: blank role line in the
--     sidebar and ZERO permissions, while Settings → Members correctly
--     showed the granted profile.
--
-- (C) Switching workspaces DROPPED the grant. `switch_active_account`
--     kept the pointer only when it happened to belong to the target
--     account and otherwise set NULL, instead of adopting the grant
--     recorded on the target membership. So every switch into an
--     invited workspace landed with no profile and no permissions.
--
-- Security note for (B)/(C): the membership grant is only trusted when
-- the profile/role row genuinely belongs to the active account
-- (`wp.account_id = p.account_id`). `is_account_member()` joins
-- workspace_profiles by id alone, so a foreign pointer would otherwise
-- confer that workspace's permissions — the original reason the switch
-- nulled it. Adopting the target membership's own grant is both correct
-- and account-scoped.

-- ------------------------------------------------------------------
-- (A) Sender identity is unique per channel, not per provider
-- ------------------------------------------------------------------
DROP INDEX IF EXISTS idx_channel_connections_external;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_connections_external
  ON public.channel_connections (
    account_id, channel, provider, external_identity
  )
  WHERE external_identity IS NOT NULL;

-- ------------------------------------------------------------------
-- (B) Active context resolves grants from account_members
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_account_context()
RETURNS TABLE(
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
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select
    p.user_id,
    p.account_id,
    -- account_members.role is authoritative (is_account_member reads it);
    -- profiles.account_role is only a denormalised copy kept in sync by
    -- redeem_invitation / switch_active_account.
    --
    -- Least privilege: when no active membership is visible we must NOT
    -- fall back to the denormalised copy, because that copy can hold a
    -- role the user no longer holds. Such a context is already rejected
    -- via status='inactive'; reporting 'viewer' means even a caller that
    -- ignored the status gate cannot read an elevated role out of here.
    case when m.id is null then 'viewer' else m.role::text end as account_role,
    a.name as account_name,
    -- FAIL CLOSED. Requires positive proof of an active membership
    -- rather than trusting an absent row: the SELECT policy on
    -- account_members only matches ACTIVE memberships, so a deactivated
    -- member's own row becomes invisible and the LEFT JOIN yields NULL.
    -- `m.id IS NOT NULL` IS the proof of an active grant.
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
                   'role', m2.role::text,
                   -- Per-workspace permission profile, so the switcher can
                   -- label each row with what the user actually IS there
                   -- ("Administrator", "Standard") instead of the coarse
                   -- membership role.
                   'profile_name', wp2.name
                 )
                 order by a2.name
               )
        from account_members m2
        join accounts a2 on a2.id = m2.account_id
        left join workspace_profiles wp2
          on wp2.id = m2.workspace_profile_id
         and wp2.account_id = m2.account_id
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
  -- The grant for the ACTIVE workspace: the membership row first (single
  -- source of truth), the legacy profiles pointer only as a fallback for
  -- rows written before 20260814150000. Both are constrained to the
  -- active account, so no foreign profile can leak permissions in.
  left join workspace_profiles wp
    on wp.id = coalesce(m.workspace_profile_id, p.workspace_profile_id)
   and wp.account_id = p.account_id
  where p.user_id = auth.uid();
$function$;

-- ------------------------------------------------------------------
-- (C) Switching adopts the target membership's grants
-- ------------------------------------------------------------------
-- SECURITY DEFINER is LOAD-BEARING, not boilerplate. `profiles` carries a
-- BEFORE UPDATE guard (migration 034) that raises 42501 whenever
-- account_id/account_role change while `current_user = 'authenticated'`,
-- because those columns are membership state and must only move through
-- supervised RPCs. This IS one of those RPCs, and it runs as its
-- postgres owner so the guard sees `postgres` and lets the write
-- through. `CREATE OR REPLACE` does NOT inherit the previous function's
-- security mode, so omitting this line downgrades the function to
-- INVOKER and every switch fails with "account_role and account_id
-- cannot be changed directly".
--
-- Running as owner bypasses RLS, so authorisation is enforced inline
-- instead: every branch is keyed to `auth.uid()` and requires an ACTIVE
-- `account_members` row for the target account, and each adopted
-- profile/role id is re-validated against that account.
CREATE OR REPLACE FUNCTION public.switch_active_account(p_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_switched uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE profiles p
  SET account_id   = m.account_id,
      account_role = m.role,
      -- Adopt the grant recorded on the membership being switched INTO.
      -- Previously this only preserved a pointer that happened to belong
      -- to the target and otherwise nulled it, so switching into an
      -- invited workspace arrived with no profile and no permissions.
      -- Validated against the target account, so a foreign
      -- workspace_profiles row can never be carried across.
      workspace_profile_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM workspace_profiles wp
          WHERE wp.id = m.workspace_profile_id
            AND wp.account_id = m.account_id
        ) THEN m.workspace_profile_id
        WHEN EXISTS (
          SELECT 1 FROM workspace_profiles wp
          WHERE wp.id = p.workspace_profile_id
            AND wp.account_id = m.account_id
        ) THEN p.workspace_profile_id
        ELSE NULL
      END,
      workspace_role_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM workspace_roles wr
          WHERE wr.id = m.workspace_role_id
            AND wr.account_id = m.account_id
        ) THEN m.workspace_role_id
        WHEN EXISTS (
          SELECT 1 FROM workspace_roles wr
          WHERE wr.id = p.workspace_role_id
            AND wr.account_id = m.account_id
        ) THEN p.workspace_role_id
        ELSE NULL
      END,
      updated_at = now()
  FROM account_members m
  WHERE p.user_id = auth.uid()
    AND m.user_id = auth.uid()
    AND m.account_id = p_account_id
    AND m.status = 'active'
  RETURNING p.account_id INTO v_switched;

  RETURN v_switched IS NOT NULL;
END;
$function$;

-- ------------------------------------------------------------------
-- Backfill: heal pointers that are already stale/empty
-- ------------------------------------------------------------------
-- Members invited into another workspace before this migration have a
-- NULL (or mismatched) pointer even though their membership carries the
-- grant. Align the pointer with the active membership so legacy readers
-- of `profiles` agree with `account_members`.
UPDATE profiles p
SET workspace_profile_id = m.workspace_profile_id,
    updated_at = now()
FROM account_members m
WHERE m.user_id = p.user_id
  AND m.account_id = p.account_id
  AND m.status = 'active'
  AND m.workspace_profile_id IS NOT NULL
  AND p.workspace_profile_id IS DISTINCT FROM m.workspace_profile_id
  AND EXISTS (
    SELECT 1 FROM workspace_profiles wp
    WHERE wp.id = m.workspace_profile_id
      AND wp.account_id = m.account_id
  );

UPDATE profiles p
SET workspace_role_id = m.workspace_role_id,
    updated_at = now()
FROM account_members m
WHERE m.user_id = p.user_id
  AND m.account_id = p.account_id
  AND m.status = 'active'
  AND m.workspace_role_id IS NOT NULL
  AND p.workspace_role_id IS DISTINCT FROM m.workspace_role_id
  AND EXISTS (
    SELECT 1 FROM workspace_roles wr
    WHERE wr.id = m.workspace_role_id
      AND wr.account_id = m.account_id
  );

-- Keep the denormalised role copy honest too.
UPDATE profiles p
SET account_role = m.role,
    updated_at = now()
FROM account_members m
WHERE m.user_id = p.user_id
  AND m.account_id = p.account_id
  AND m.status = 'active'
  AND p.account_role IS DISTINCT FROM m.role;

-- Stop naming personal workspaces after the owner's raw email address.
--
-- handle_new_user fell back to `NEW.email` when signup carried no
-- full_name, so a workspace was literally called "admin@gmail.com".
-- That name is not private data (it is shown to everyone invited), and
-- it made the invite screen read "You've been invited to join
-- admin@gmail.com" — as though the invitation were to a person rather
-- than to a workspace.
--
-- The email local part is a much better default: derived from the same
-- information, but reads as a place ("admin's workspace"). This only
-- changes the DEFAULT applied at signup; a workspace the owner has
-- explicitly named is never touched.
--
-- Idempotent: safe to re-run.

-- A single source of truth for the fallback, so the trigger below and
-- the backfill at the bottom cannot drift apart.
CREATE OR REPLACE FUNCTION public.default_workspace_name(
  p_full_name TEXT,
  p_email TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1. A real name the person gave us — but only if it isn't itself an
    --    address. Plenty of people type their email into a "name" field,
    --    and taking it verbatim would put the address straight back into
    --    the workspace name this function exists to keep it out of.
    (SELECT NULLIF(btrim(COALESCE(p_full_name, '')), '')
      WHERE position('@' IN COALESCE(p_full_name, '')) = 0),
    -- 2. Otherwise the local part of whichever value looks like an
    --    address, never the full address. split_part returns '' rather
    --    than NULL when there is no match, hence the NULLIF.
    NULLIF(
      split_part(
        btrim(COALESCE(NULLIF(btrim(COALESCE(p_full_name, '')), ''), p_email, '')),
        '@', 1
      ),
      ''
    ) || '''s workspace',
    -- 3. Nothing usable at all.
    'My workspace'
  );
$$;

COMMENT ON FUNCTION public.default_workspace_name(TEXT, TEXT) IS
  'Default display name for a newly provisioned personal workspace. Prefers the '
  'owner''s full name, then the email LOCAL PART ("admin''s workspace"), never '
  'the full address — workspace names are visible to every invited member.';

-- Point the signup trigger at the helper.
--
-- Rewritten with a targeted replacement rather than restating the whole
-- function body: handle_new_user also owns domain capture, profile and
-- account_members seeding, and default provisioning, and copying all of
-- that forward just to change one COALESCE is how those paths get
-- silently reverted by an older copy.
DO $$
DECLARE
  v_def TEXT;
  v_old TEXT := 'COALESCE(NULLIF(v_full_name, ''''), NEW.email, ''My account'')';
  v_new TEXT := 'public.default_workspace_name(v_full_name, NEW.email)';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'handle_new_user';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'handle_new_user() not found — migration order problem';
  END IF;

  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'handle_new_user already uses default_workspace_name; skipping';
    RETURN;
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    -- Fail loudly rather than leave the caller believing the fix landed.
    RAISE EXCEPTION
      'handle_new_user() does not contain the expected email fallback; '
      'inspect it manually before re-running this migration';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$$;

-- Backfill workspaces already carrying an email address as their name.
--
-- Deliberately narrow: only rows whose name is exactly the owner's own
-- email, i.e. unmistakably the old default rather than a deliberate
-- choice. A workspace someone genuinely named after an email keeps it.
UPDATE public.accounts a
   SET name = public.default_workspace_name(p.full_name, u.email),
       updated_at = now()
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
 WHERE a.owner_user_id = u.id
   AND lower(btrim(a.name)) = lower(btrim(u.email));

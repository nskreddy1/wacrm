-- ============================================================
-- Make the role hierarchy self-explanatory, and make system role
-- lookups survive a rename.
--
-- WHY THIS EXISTS
-- Two separate problems, one root cause.
--
-- 1. "Level 1".."Level 5" tells an admin nothing. The hierarchy is
--    real and load-bearing (it drives record visibility), but the
--    names hide that, so the Role column reads as decoration and
--    admins can't tell it apart from Profile. Renaming them to job
--    titles makes the visibility ladder legible at a glance.
--
-- 2. Those display names were also the LOOKUP KEY. Both
--    seed_default_role_hierarchy() and handle_new_user() find system
--    roles with `WHERE name = 'Level 1'`. So the rename in (1) would
--    silently break owner/new-user seeding — and, more importantly,
--    that bug already exists today: workspace_roles.name is editable
--    from Settings, so any admin renaming a system role breaks their
--    own signup bootstrap with no error (both call sites swallow
--    failures into a RAISE WARNING).
--
-- Fix: add a stable `system_key` that code keys off, leaving `name`
-- as a purely human, freely-editable label.
--
-- Also repairs owner seeding to write the workspace grants into
-- account_members (the authoritative per-account store as of
-- 20260814110000), not just the profiles mirror.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Stable identity for system roles
-- ------------------------------------------------------------
ALTER TABLE workspace_roles
  ADD COLUMN IF NOT EXISTS system_key TEXT;

COMMENT ON COLUMN workspace_roles.system_key IS
  'Stable machine identifier for seeded system roles (level_1..level_5). '
  'Code MUST match on this, never on name — name is a display label '
  'that admins are free to rename.';

-- Backfill from the legacy display names before they change.
UPDATE workspace_roles
   SET system_key = 'level_' || substring(name from 'Level ([1-5])')
 WHERE system_key IS NULL
   AND is_system
   AND name ~ '^Level [1-5]$';

-- One row per key per account (partial: custom roles stay NULL).
CREATE UNIQUE INDEX IF NOT EXISTS workspace_roles_account_system_key_uniq
  ON workspace_roles (account_id, system_key)
  WHERE system_key IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Job-title names + descriptions that state the visibility rule
--
-- Only touches rows still carrying the default "Level N" name, so an
-- admin who already renamed a role keeps their label. Skipped when
-- the account already has a role using the target name, since
-- (account_id, name) must stay unique.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  target_name TEXT;
  target_desc TEXT;
BEGIN
  FOR r IN
    SELECT id, account_id, system_key, name
      FROM workspace_roles
     WHERE is_system
       AND system_key IS NOT NULL
       AND name ~ '^Level [1-5]$'
  LOOP
    SELECT n, d INTO target_name, target_desc
      FROM (VALUES
        ('level_1', 'CEO',
         'Top of the hierarchy. Sees and manages records owned by everyone in the workspace.'),
        ('level_2', 'Head of Sales',
         'Sees records owned by Sales Managers, Team Leads and Sales Reps, plus their own.'),
        ('level_3', 'Sales Manager',
         'Sees records owned by Team Leads and Sales Reps, plus their own.'),
        ('level_4', 'Team Lead',
         'Sees records owned by Sales Reps who report to them, plus their own.'),
        ('level_5', 'Sales Rep',
         'Sees only the records they own.')
      ) AS m(k, n, d)
     WHERE m.k = r.system_key;

    CONTINUE WHEN target_name IS NULL;

    -- Don't collide with an admin-created role of the same name.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM workspace_roles w
       WHERE w.account_id = r.account_id
         AND w.name = target_name
         AND w.id <> r.id
    );

    UPDATE workspace_roles
       SET name = target_name,
           description = target_desc
     WHERE id = r.id;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. Reseed keyed on system_key instead of display name
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_default_role_hierarchy(target_account_id UUID)
RETURNS UUID  -- returns the leaf (level_5) role id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent UUID := NULL;
  v_id     UUID;
  v_leaf   UUID;
  spec     RECORD;
BEGIN
  -- Walk top-down so each level can parent the next.
  FOR spec IN
    SELECT * FROM (VALUES
      ('level_1', 'CEO',
       'Top of the hierarchy. Sees and manages records owned by everyone in the workspace.',
       TRUE),
      ('level_2', 'Head of Sales',
       'Sees records owned by Sales Managers, Team Leads and Sales Reps, plus their own.',
       TRUE),
      ('level_3', 'Sales Manager',
       'Sees records owned by Team Leads and Sales Reps, plus their own.',
       TRUE),
      ('level_4', 'Team Lead',
       'Sees records owned by Sales Reps who report to them, plus their own.',
       FALSE),
      ('level_5', 'Sales Rep',
       'Sees only the records they own.',
       FALSE)
    ) AS t(key, nm, descr, peer)
  LOOP
    -- Idempotent, and rename-safe: match on system_key. Falls back to
    -- the legacy name so accounts seeded before this migration adopt
    -- the key instead of getting a duplicate ladder.
    SELECT id INTO v_id
      FROM workspace_roles
     WHERE account_id = target_account_id
       AND is_system
       AND (system_key = spec.key
            OR (system_key IS NULL
                AND name = 'Level ' || right(spec.key, 1)))
     LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO workspace_roles
        (account_id, name, description, parent_role_id, peer_visibility,
         is_system, system_key)
      VALUES
        (target_account_id, spec.nm, spec.descr, v_parent, spec.peer,
         TRUE, spec.key)
      RETURNING id INTO v_id;
    ELSE
      -- Adopt the key and re-anchor the parent link, without
      -- clobbering an admin's custom name.
      UPDATE workspace_roles
         SET system_key = spec.key,
             parent_role_id = v_parent
       WHERE id = v_id;
    END IF;

    v_parent := v_id;
    v_leaf := v_id;
  END LOOP;

  RETURN v_leaf;
END;
$$;

ALTER FUNCTION seed_default_role_hierarchy(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION seed_default_role_hierarchy(UUID) TO service_role;

-- Adopt system_key for every pre-existing account.
DO $$
DECLARE
  acc RECORD;
BEGIN
  FOR acc IN SELECT id FROM accounts LOOP
    BEGIN
      PERFORM seed_default_role_hierarchy(acc.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Could not normalize role hierarchy for account %: %',
        acc.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4. Signup bootstrap: key off system_key, and write grants to
--    account_members as well as the profiles mirror.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_domain TEXT;
  v_capture RECORD;
  v_profile_id UUID;
  v_role_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_domain := lower(split_part(NEW.email, '@', 2));

  -- Domain capture: verified org domain with auto-join enabled.
  SELECT ad.account_id, ad.default_workspace_profile_id, ad.default_workspace_role_id
    INTO v_capture
    FROM account_domains ad
    WHERE ad.domain = v_domain AND ad.verified AND ad.auto_join_enabled
    LIMIT 1;

  IF v_capture.account_id IS NOT NULL THEN
    -- Resolve defaults: explicit domain defaults, else Standard/leaf role.
    v_profile_id := v_capture.default_workspace_profile_id;
    IF v_profile_id IS NULL THEN
      SELECT id INTO v_profile_id FROM workspace_profiles
        WHERE account_id = v_capture.account_id AND name = 'Standard' AND is_system;
    END IF;
    v_role_id := v_capture.default_workspace_role_id;
    IF v_role_id IS NULL THEN
      -- system_key, not name: survives an admin renaming the role.
      SELECT id INTO v_role_id FROM workspace_roles
        WHERE account_id = v_capture.account_id
          AND is_system AND system_key = 'level_5';
    END IF;

    INSERT INTO public.profiles
      (user_id, full_name, email, account_id, account_role,
       workspace_profile_id, workspace_role_id, status)
    VALUES
      (NEW.id, v_full_name, NEW.email, v_capture.account_id, 'agent',
       v_profile_id, v_role_id, 'active');

    -- ADR-004: mirror the profile into account_members. Role/status are copied
    -- from the profile written immediately above so the two never disagree.
    -- The workspace grants ride along: account_members is authoritative
    -- per account (20260814110000), so omitting them here would leave an
    -- auto-joined user with no permissions in the workspace they joined.
    INSERT INTO public.account_members
      (account_id, user_id, role, status, workspace_profile_id, workspace_role_id)
    VALUES
      (v_capture.account_id, NEW.id, 'agent', 'active', v_profile_id, v_role_id)
    ON CONFLICT (account_id, user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- No capture: original path — fresh personal account.
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  INSERT INTO public.account_members (account_id, user_id, role, status)
  VALUES (v_account_id, NEW.id, 'owner', 'active')
  ON CONFLICT (account_id, user_id) DO NOTHING;

  BEGIN
    PERFORM public.provision_account_defaults(v_account_id, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to provision defaults for account %: %', v_account_id, SQLERRM;
  END;

  -- Seed system profiles + role hierarchy for the new account.
  BEGIN
    PERFORM seed_default_role_hierarchy(v_account_id);
    INSERT INTO workspace_profiles (account_id, name, description, permissions, is_system)
    VALUES
      (v_account_id, 'Administrator',
       'This profile will have all the permissions. Users with Administrator profile will be able to view and manage all the data within the organization account by default.',
       ARRAY['contacts:read','contacts:write','contacts:delete','companies:read','companies:write','companies:delete','deals:read','deals:write','deals:delete','products:read','products:write','products:delete','activities:read','activities:write','activities:delete','messages:send','broadcasts:send','sms:send','templates:manage','quick-replies:manage','automations:manage','flows:manage','ai:manage','data:import','data:export','members:manage','settings:manage','channels:manage','api-keys:manage','webhooks:manage'],
       TRUE),
      (v_account_id, 'Standard',
       'This profile will have all the permissions except administrative privileges.',
       ARRAY['contacts:read','contacts:write','contacts:delete','companies:read','companies:write','companies:delete','deals:read','deals:write','deals:delete','products:read','products:write','products:delete','activities:read','activities:write','activities:delete','messages:send','broadcasts:send','sms:send','templates:manage','quick-replies:manage','automations:manage','flows:manage','data:import','data:export'],
       TRUE),
      (v_account_id, 'AI Agent',
       'Locked profile that AI agents run under. Conversational scope: read records and reply to customers. No deletes, no exports, no administration.',
       ARRAY['contacts:read','companies:read','deals:read','products:read','activities:read','messages:send'],
       TRUE)
    ON CONFLICT (account_id, name) DO NOTHING;

    -- Owner: Administrator profile + top-of-hierarchy role.
    SELECT id INTO v_profile_id FROM workspace_profiles
      WHERE account_id = v_account_id AND name = 'Administrator' AND is_system;
    SELECT id INTO v_role_id FROM workspace_roles
      WHERE account_id = v_account_id AND is_system AND system_key = 'level_1';

    UPDATE profiles p SET
      workspace_profile_id = v_profile_id,
      workspace_role_id = v_role_id
    WHERE p.user_id = NEW.id AND p.account_id = v_account_id;

    -- Same grants on the authoritative membership row, otherwise the
    -- owner shows "Unassigned" in Settings despite the mirror being set.
    UPDATE account_members m SET
      workspace_profile_id = v_profile_id,
      workspace_role_id = v_role_id
    WHERE m.user_id = NEW.id AND m.account_id = v_account_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to seed roles/profiles for account %: %', v_account_id, SQLERRM;
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------
-- 5. Backfill: existing owners whose membership row predates the
--    grant columns still read "Unassigned" in Settings.
-- ------------------------------------------------------------
UPDATE account_members m
   SET workspace_profile_id = COALESCE(m.workspace_profile_id, p.workspace_profile_id),
       workspace_role_id    = COALESCE(m.workspace_role_id, p.workspace_role_id)
  FROM profiles p
 WHERE p.user_id = m.user_id
   AND p.account_id = m.account_id
   AND (m.workspace_profile_id IS NULL OR m.workspace_role_id IS NULL);

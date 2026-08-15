-- ADR-004 D1 follow-up: teach signup bootstrap to write account_members.
--
-- WHY THIS EXISTS
-- handle_new_user() predates public.account_members. It writes public.profiles
-- but never a membership row, so every user created after 20260813120000
-- (fresh signup AND verified-domain auto-join) lands with NO membership.
--
-- That is latent today because RLS still reads profiles.account_id. The moment
-- the policies switch to account_members, those users are locked out of their
-- own workspace and every "account has >= 1 active owner" invariant breaks.
-- Fixing the trigger BEFORE the policy cutover keeps the migration order safe.
--
-- The function body below is the live definition with exactly two additions
-- (both marked "ADR-004"); nothing else is altered. The membership insert is
-- deliberately NOT wrapped in its own EXCEPTION block: membership is now
-- load-bearing for authorization, so it must share the same atomicity as the
-- profiles insert rather than failing open into a locked-out user.

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
    -- Resolve defaults: explicit domain defaults, else Standard/Agent.
    v_profile_id := v_capture.default_workspace_profile_id;
    IF v_profile_id IS NULL THEN
      SELECT id INTO v_profile_id FROM workspace_profiles
        WHERE account_id = v_capture.account_id AND name = 'Standard' AND is_system;
    END IF;
    v_role_id := v_capture.default_workspace_role_id;
    IF v_role_id IS NULL THEN
      SELECT id INTO v_role_id FROM workspace_roles
        WHERE account_id = v_capture.account_id AND name = 'Level 5' AND is_system;
    END IF;

    INSERT INTO public.profiles
      (user_id, full_name, email, account_id, account_role,
       workspace_profile_id, workspace_role_id, status)
    VALUES
      (NEW.id, v_full_name, NEW.email, v_capture.account_id, 'agent',
       v_profile_id, v_role_id, 'active');

    -- ADR-004: mirror the profile into account_members. Role/status are copied
    -- from the profile written immediately above so the two never disagree.
    INSERT INTO public.account_members (account_id, user_id, role, status)
    VALUES (v_capture.account_id, NEW.id, 'agent', 'active')
    ON CONFLICT (account_id, user_id) DO NOTHING;

    RETURN NEW;
  END IF;

  -- No capture: original path — fresh personal account.
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  -- ADR-004: the creator of a fresh workspace is its owner. Without this row
  -- the last-owner guard sees an ownerless account and the user cannot read
  -- their own workspace once RLS moves to account_members.
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

    -- Owner: Administrator profile + Level 1 role.
    UPDATE profiles p SET
      workspace_profile_id = (SELECT id FROM workspace_profiles WHERE account_id = v_account_id AND name = 'Administrator' AND is_system),
      workspace_role_id = (SELECT id FROM workspace_roles WHERE account_id = v_account_id AND name = 'Level 1' AND is_system)
    WHERE p.user_id = NEW.id AND p.account_id = v_account_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to seed roles/profiles for account %: %', v_account_id, SQLERRM;
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

-- Catch up anyone created between 20260813120000 and this migration, plus any
-- profile the earlier backfill could not see. Idempotent and least-privilege:
-- role/status are copied from the profile, never invented.
INSERT INTO public.account_members (account_id, user_id, role, status)
SELECT p.account_id, p.user_id,
       COALESCE(p.account_role, 'viewer'::account_role_enum),
       COALESCE(p.status, 'active')
FROM public.profiles p
WHERE p.account_id IS NOT NULL
  AND p.user_id IS NOT NULL
ON CONFLICT (account_id, user_id) DO NOTHING;

-- Owners are authoritative from accounts.owner_user_id (see 20260813120000).
INSERT INTO public.account_members (account_id, user_id, role, status)
SELECT a.id, a.owner_user_id, 'owner'::account_role_enum, 'active'
FROM public.accounts a
WHERE a.owner_user_id IS NOT NULL
ON CONFLICT (account_id, user_id) DO UPDATE
  SET role = 'owner'::account_role_enum,
      status = CASE WHEN account_members.status = 'deleted'
                    THEN account_members.status ELSE 'active' END
  WHERE account_members.role <> 'owner'::account_role_enum;

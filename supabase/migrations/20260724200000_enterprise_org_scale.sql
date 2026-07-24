-- ============================================================
-- ENTERPRISE ORG SCALE: domain capture (JIT join), default role
-- hierarchy, AI Agent system profile.
--
-- Solves: "an organization with 100-1000 employees signs up for
-- our product — how does everyone land in ONE workspace with the
-- right role/profile?" (Slack/Notion domain-capture pattern.)
--
-- 1. account_domains — verified company email domains per account.
--    A signup whose email domain matches a verified, auto-join
--    domain joins that account instead of creating a new one.
-- 2. Default role hierarchy — CEO > VP > Manager > Team Lead >
--    Agent seeded for every account (visibility axis).
-- 3. AI Agent — locked system profile with conversational-scope
--    permissions that AI features run under (permission axis).
-- ============================================================

-- ------------------------------------------------------------
-- 1. account_domains
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_domains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Always stored lowercase; one org owns a domain globally.
  domain TEXT NOT NULL CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  -- DNS TXT verification token (compared by the verify endpoint).
  verification_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  auto_join_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Defaults granted to JIT joiners; NULL falls back to the
  -- 'Standard' profile / 'Agent' role at join time.
  default_workspace_profile_id UUID REFERENCES workspace_profiles(id) ON DELETE SET NULL,
  default_workspace_role_id UUID REFERENCES workspace_roles(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (domain)
);

CREATE INDEX IF NOT EXISTS idx_account_domains_account
  ON account_domains(account_id);

ALTER TABLE account_domains ENABLE ROW LEVEL SECURITY;

-- Members can see their org's domains; only admins manage them.
DROP POLICY IF EXISTS account_domains_select ON account_domains;
CREATE POLICY account_domains_select ON account_domains
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS account_domains_insert ON account_domains;
CREATE POLICY account_domains_insert ON account_domains
  FOR INSERT WITH CHECK (
    is_account_member(account_id, 'admin')
    -- Public mailbox providers can never be captured as org domains.
    AND domain NOT IN (
      'gmail.com','googlemail.com','yahoo.com','yahoo.co.in','outlook.com',
      'hotmail.com','live.com','msn.com','icloud.com','me.com','aol.com',
      'proton.me','protonmail.com','zoho.com','zohomail.in','gmx.com',
      'mail.com','yandex.com','rediffmail.com'
    )
  );

DROP POLICY IF EXISTS account_domains_update ON account_domains;
CREATE POLICY account_domains_update ON account_domains
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  -- verified/verified_at can only be flipped by the server-side
  -- verify endpoint (service role bypasses RLS); clients cannot
  -- self-verify a domain.
  WITH CHECK (is_account_member(account_id, 'admin') AND verified = (
    SELECT ad.verified FROM account_domains ad WHERE ad.id = account_domains.id
  ));

DROP POLICY IF EXISTS account_domains_delete ON account_domains;
CREATE POLICY account_domains_delete ON account_domains
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 2. Default role hierarchy seeding
--    CEO > VP > Manager > Team Lead > Agent
-- ------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS workspace_role_id UUID
    REFERENCES workspace_roles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_workspace_role
  ON profiles(workspace_role_id);

CREATE OR REPLACE FUNCTION seed_default_role_hierarchy(target_account_id UUID)
RETURNS UUID  -- returns the leaf ('Agent') role id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ceo UUID; v_vp UUID; v_mgr UUID; v_lead UUID; v_agent UUID;
BEGIN
  -- Idempotent: reuse existing system roles when present.
  SELECT id INTO v_ceo FROM workspace_roles
    WHERE account_id = target_account_id AND name = 'CEO' AND is_system;
  IF v_ceo IS NULL THEN
    INSERT INTO workspace_roles (account_id, name, description, parent_role_id, peer_visibility, is_system)
    VALUES (target_account_id, 'CEO', 'Top of the hierarchy. Sees all data in the workspace.', NULL, TRUE, TRUE)
    RETURNING id INTO v_ceo;
  END IF;

  SELECT id INTO v_vp FROM workspace_roles
    WHERE account_id = target_account_id AND name = 'VP' AND is_system;
  IF v_vp IS NULL THEN
    INSERT INTO workspace_roles (account_id, name, description, parent_role_id, peer_visibility, is_system)
    VALUES (target_account_id, 'VP', 'Sees data owned by managers, team leads and agents below them.', v_ceo, TRUE, TRUE)
    RETURNING id INTO v_vp;
  END IF;

  SELECT id INTO v_mgr FROM workspace_roles
    WHERE account_id = target_account_id AND name = 'Manager' AND is_system;
  IF v_mgr IS NULL THEN
    INSERT INTO workspace_roles (account_id, name, description, parent_role_id, peer_visibility, is_system)
    VALUES (target_account_id, 'Manager', 'Sees data owned by team leads and agents below them.', v_vp, TRUE, TRUE)
    RETURNING id INTO v_mgr;
  END IF;

  SELECT id INTO v_lead FROM workspace_roles
    WHERE account_id = target_account_id AND name = 'Team Lead' AND is_system;
  IF v_lead IS NULL THEN
    INSERT INTO workspace_roles (account_id, name, description, parent_role_id, peer_visibility, is_system)
    VALUES (target_account_id, 'Team Lead', 'Sees data owned by agents on their team.', v_mgr, FALSE, TRUE)
    RETURNING id INTO v_lead;
  END IF;

  SELECT id INTO v_agent FROM workspace_roles
    WHERE account_id = target_account_id AND name = 'Agent' AND is_system;
  IF v_agent IS NULL THEN
    INSERT INTO workspace_roles (account_id, name, description, parent_role_id, peer_visibility, is_system)
    VALUES (target_account_id, 'Agent', 'Sees only their own records.', v_lead, FALSE, TRUE)
    RETURNING id INTO v_agent;
  END IF;

  RETURN v_agent;
END;
$$;

ALTER FUNCTION seed_default_role_hierarchy(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION seed_default_role_hierarchy(UUID) TO service_role;

-- Backfill hierarchy for every existing account and attach each
-- account owner to the CEO role.
DO $$
DECLARE
  acc RECORD;
BEGIN
  FOR acc IN SELECT id, owner_user_id FROM accounts LOOP
    PERFORM seed_default_role_hierarchy(acc.id);
    UPDATE profiles p
      SET workspace_role_id = wr.id
      FROM workspace_roles wr
      WHERE p.account_id = acc.id
        AND p.user_id = acc.owner_user_id
        AND p.workspace_role_id IS NULL
        AND wr.account_id = acc.id AND wr.name = 'CEO' AND wr.is_system;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. AI Agent system profile (least-privilege conversational scope)
-- ------------------------------------------------------------
INSERT INTO workspace_profiles (account_id, name, description, permissions, is_system)
SELECT
  a.id,
  'AI Agent',
  'Locked profile that AI agents run under. Conversational scope: read records and reply to customers. No deletes, no exports, no administration.',
  ARRAY[
    'contacts:read','companies:read','deals:read',
    'products:read','activities:read',
    'messages:send'
  ],
  TRUE
FROM accounts a
ON CONFLICT (account_id, name) DO NOTHING;

-- Backfill: every member gets a role — account owners CEO,
-- everyone else Agent (idempotent; only fills NULLs).
UPDATE profiles p
  SET workspace_role_id = wr.id
  FROM workspace_roles wr, accounts a
  WHERE p.workspace_role_id IS NULL
    AND p.account_id IS NOT NULL
    AND a.id = p.account_id
    AND wr.account_id = p.account_id
    AND wr.is_system
    AND wr.name = CASE WHEN a.owner_user_id = p.user_id THEN 'CEO' ELSE 'Agent' END;

-- ------------------------------------------------------------
-- 4. JIT domain-capture signup. Rewrites handle_new_user:
--    verified + auto-join domain match -> join org workspace
--    with the domain's default profile/role; otherwise keep the
--    existing behavior (fresh personal account).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        WHERE account_id = v_capture.account_id AND name = 'Agent' AND is_system;
    END IF;

    INSERT INTO public.profiles
      (user_id, full_name, email, account_id, account_role,
       workspace_profile_id, workspace_role_id, status)
    VALUES
      (NEW.id, v_full_name, NEW.email, v_capture.account_id, 'agent',
       v_profile_id, v_role_id, 'active');

    RETURN NEW;
  END IF;

  -- No capture: original path — fresh personal account.
  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

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

    -- Owner: Administrator profile + CEO role.
    UPDATE profiles p SET
      workspace_profile_id = (SELECT id FROM workspace_profiles WHERE account_id = v_account_id AND name = 'Administrator' AND is_system),
      workspace_role_id = (SELECT id FROM workspace_roles WHERE account_id = v_account_id AND name = 'CEO' AND is_system)
    WHERE p.user_id = NEW.id AND p.account_id = v_account_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to seed roles/profiles for account %: %', v_account_id, SQLERRM;
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

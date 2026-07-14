-- ============================================================
-- 042 — WORKSPACE DEFAULTS PROVISIONING
--
-- Dynamic template catalog + automatic provisioning so every new
-- account starts with default pipelines, tags, and quick replies.
-- Adding a future template = one INSERT into workspace_templates,
-- zero code changes. See docs/roadmap/phase-1-provisioning.md.
-- ============================================================

-- ------------------------------------------------------------
-- 1. workspace_templates — platform-level catalog (the dynamic part)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT NOT NULL UNIQUE,
  -- Extensible: later kinds (e.g. 'ai_routes', 'custom_fields') only
  -- need a new CASE branch in provision_account_defaults().
  kind TEXT NOT NULL CHECK (kind IN ('pipeline', 'tags', 'quick_replies')),
  name TEXT NOT NULL,
  description TEXT,
  -- Full payload: pipeline stages w/ colors, tag list, reply list.
  definition JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_default BOOLEAN NOT NULL DEFAULT FALSE, -- auto-provision to every new account
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspace_templates ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may browse the catalog (future "New from template"
-- UI); writes happen only via service role / migrations (no policy).
DROP POLICY IF EXISTS workspace_templates_select ON workspace_templates;
CREATE POLICY workspace_templates_select ON workspace_templates
  FOR SELECT TO authenticated USING (is_active);

-- ------------------------------------------------------------
-- 2. account_provisioned_templates — idempotency + audit log
--
-- The PK guarantees a template is applied AT MOST ONCE per account,
-- even if the signup trigger and the backfill script both run.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_provisioned_templates (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES workspace_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, template_id)
);

ALTER TABLE account_provisioned_templates ENABLE ROW LEVEL SECURITY;

-- Members can see what their account was provisioned with; writes go
-- through the SECURITY DEFINER function only.
DROP POLICY IF EXISTS account_provisioned_templates_select ON account_provisioned_templates;
CREATE POLICY account_provisioned_templates_select ON account_provisioned_templates
  FOR SELECT USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- 3. provision_account_defaults() — the provisioning engine
--
-- SECURITY DEFINER so it can run from the signup trigger (as
-- postgres) and from the backfill script. A failure in ONE template
-- logs a WARNING and continues — provisioning must never block
-- signup or poison other templates.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_account_defaults(
  p_account_id UUID,
  p_owner_user_id UUID
)
RETURNS INTEGER -- number of templates applied in this call
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template RECORD;
  v_pipeline_id UUID;
  v_stage JSONB;
  v_item JSONB;
  v_position INTEGER;
  v_applied INTEGER := 0;
BEGIN
  FOR v_template IN
    SELECT wt.*
    FROM workspace_templates wt
    WHERE wt.is_default
      AND wt.is_active
      AND NOT EXISTS (
        SELECT 1 FROM account_provisioned_templates apt
        WHERE apt.account_id = p_account_id
          AND apt.template_id = wt.id
      )
    ORDER BY wt.created_at
  LOOP
    BEGIN
      CASE v_template.kind
        WHEN 'pipeline' THEN
          INSERT INTO pipelines (user_id, account_id, name)
          VALUES (p_owner_user_id, p_account_id, v_template.name)
          RETURNING id INTO v_pipeline_id;

          v_position := 0;
          FOR v_stage IN SELECT * FROM jsonb_array_elements(v_template.definition->'stages')
          LOOP
            INSERT INTO pipeline_stages (pipeline_id, name, position, color)
            VALUES (
              v_pipeline_id,
              v_stage->>'name',
              v_position,
              COALESCE(v_stage->>'color', '#3b82f6')
            );
            v_position := v_position + 1;
          END LOOP;

        WHEN 'tags' THEN
          -- Tags are user-scoped today (001) with account_id added in
          -- 017; seed against the owner. Account-scoping the reads is
          -- roadmap phase 5 item #1.
          FOR v_item IN SELECT * FROM jsonb_array_elements(v_template.definition->'tags')
          LOOP
            INSERT INTO tags (user_id, account_id, name, color)
            VALUES (
              p_owner_user_id,
              p_account_id,
              v_item->>'name',
              COALESCE(v_item->>'color', '#3b82f6')
            );
          END LOOP;

        WHEN 'quick_replies' THEN
          FOR v_item IN SELECT * FROM jsonb_array_elements(v_template.definition->'replies')
          LOOP
            INSERT INTO quick_replies (account_id, user_id, title, kind, content_text)
            VALUES (
              p_account_id,
              p_owner_user_id,
              v_item->>'title',
              'text',
              v_item->>'content'
            );
          END LOOP;

        ELSE
          RAISE WARNING 'provision_account_defaults: unknown template kind % (slug %)',
            v_template.kind, v_template.slug;
          CONTINUE;
      END CASE;

      INSERT INTO account_provisioned_templates (account_id, template_id, version)
      VALUES (p_account_id, v_template.id, v_template.version)
      ON CONFLICT (account_id, template_id) DO NOTHING;

      v_applied := v_applied + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'provision_account_defaults: failed template % for account %: %',
        v_template.slug, p_account_id, SQLERRM;
    END;
  END LOOP;

  RETURN v_applied;
END;
$$;

ALTER FUNCTION public.provision_account_defaults(UUID, UUID) OWNER TO postgres;
-- Only trusted paths may call it (trigger runs as owner; backfill uses
-- the service role). Not exposed to browser clients.
REVOKE EXECUTE ON FUNCTION public.provision_account_defaults(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provision_account_defaults(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_account_defaults(UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- 4. Signup trigger — replace (same pattern as 017/034) to also
--    provision defaults after creating account + profile. Kept
--    inside the existing EXCEPTION safety net: provisioning
--    failures must never block signup.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

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

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- The on_auth_user_created trigger from 017 keeps pointing at this
-- function; CREATE OR REPLACE preserves the binding.

-- ------------------------------------------------------------
-- 5. Seed the default catalog (idempotent via slug conflict)
-- ------------------------------------------------------------
INSERT INTO workspace_templates (slug, kind, name, description, definition, is_default)
VALUES
  (
    'sales-pipeline',
    'pipeline',
    'Sales Pipeline',
    'Track deals from first contact to close.',
    '{"stages":[{"name":"New Lead","color":"#3b82f6"},{"name":"Qualified","color":"#8b5cf6"},{"name":"Proposal Sent","color":"#f59e0b"},{"name":"Negotiation","color":"#f97316"},{"name":"Won","color":"#22c55e"}]}'::jsonb,
    TRUE
  ),
  (
    'customer-support',
    'pipeline',
    'Customer Support',
    'Manage support tickets from intake to resolution.',
    '{"stages":[{"name":"New Ticket","color":"#3b82f6"},{"name":"In Progress","color":"#f59e0b"},{"name":"Waiting on Customer","color":"#8b5cf6"},{"name":"Resolved","color":"#22c55e"}]}'::jsonb,
    TRUE
  ),
  (
    'default-tags',
    'tags',
    'Starter Tags',
    'Common contact labels ready to use on day one.',
    '{"tags":[{"name":"New Lead","color":"#3b82f6"},{"name":"Hot Lead","color":"#ef4444"},{"name":"VIP","color":"#f59e0b"},{"name":"Follow Up","color":"#8b5cf6"},{"name":"Customer","color":"#22c55e"}]}'::jsonb,
    TRUE
  ),
  (
    'starter-quick-replies',
    'quick_replies',
    'Starter Quick Replies',
    'Canned responses for the most common inbox moments.',
    '{"replies":[{"title":"Greeting","content":"Hi! Thanks for reaching out. How can we help you today?"},{"title":"Away Message","content":"Thanks for your message! Our team is currently away, but we will get back to you as soon as possible."},{"title":"Thanks & Closing","content":"Thank you for contacting us! If there is anything else we can help with, just send us a message."}]}'::jsonb,
    TRUE
  )
ON CONFLICT (slug) DO NOTHING;

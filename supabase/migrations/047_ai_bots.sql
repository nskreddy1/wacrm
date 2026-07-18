-- ============================================================
-- 047_ai_bots.sql — Multi-bot AI agents
--
-- Evolves the single account-level AI persona (ai_configs.system_prompt)
-- into a multi-bot system:
--
--   - `ai_bots` — many persona bots per account, exactly ONE active for
--     WhatsApp auto-reply (partial unique index enforces it race-free).
--     Credentials stay account-level in `ai_configs`; a bot is a persona
--     layer (prompt, tone, language, greeting, temperature, model
--     override, reply cap, handoff agent, working hours, KB toggle)
--     merged on top at load time.
--   - `ai_bot_templates` — admin-managed template catalog, merged with
--     the built-in catalog shipped in code (src/lib/ai/bot-templates.ts).
--   - `ai_support_requests` — in-app "help me configure AI" requests,
--     reviewed by platform super-admins.
--   - `conversations.ai_away_message_sent` — tracks that the bot's
--     outside-working-hours away message was sent once for a thread.
--
-- Backfill: every existing `ai_configs` row with a non-empty
-- `system_prompt` gets one ACTIVE bot ("My Assistant") carrying that
-- prompt, so existing accounts keep identical behavior.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- ai_bots
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_bots (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by                        uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Identity
  name                              text NOT NULL,
  description                       text,
  emoji                             text,

  -- Persona
  system_prompt                     text NOT NULL,
  tone                              text NOT NULL DEFAULT 'friendly'
                                      CHECK (tone IN ('professional', 'friendly', 'casual', 'formal', 'playful')),
  -- 'auto' = mirror the customer's language; otherwise a language name
  -- ("Spanish", "Hindi") appended as a reply-language directive.
  language                          text NOT NULL DEFAULT 'auto',
  greeting_message                  text,

  -- Generation overrides (null → account/provider default)
  temperature                       numeric CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2)),
  model_override                    text,

  -- Auto-reply overrides (null → fall back to ai_configs values)
  auto_reply_max_per_conversation   integer
                                      CHECK (auto_reply_max_per_conversation IS NULL
                                             OR auto_reply_max_per_conversation BETWEEN 1 AND 20),
  handoff_agent_id                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Working hours: null = always on. Shape:
  --   { "timezone": "Asia/Kolkata",
  --     "days": { "mon": {"start":"09:00","end":"18:00"}, ... , "sun": null } }
  working_hours                     jsonb,
  outside_hours_behavior            text NOT NULL DEFAULT 'silent'
                                      CHECK (outside_hours_behavior IN ('silent', 'away_message')),
  away_message                      text,

  use_knowledge_base                boolean NOT NULL DEFAULT true,

  -- Exactly one active bot per account (see partial unique index below).
  is_active                         boolean NOT NULL DEFAULT false,

  -- Which template this bot was created from (analytics/UX only).
  template_key                      text,

  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

-- Race-safe "exactly one active bot per account": two concurrent
-- activations can both pass an app-level check, but only one can hold
-- this index.
CREATE UNIQUE INDEX IF NOT EXISTS ai_bots_one_active_per_account
  ON ai_bots (account_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS ai_bots_account_idx ON ai_bots (account_id);

ALTER TABLE ai_bots ENABLE ROW LEVEL SECURITY;

-- Mirrors ai_configs: viewer+ can read (the inbox / playground need to
-- know which bot is live), admin+ writes (settings-class).
DROP POLICY IF EXISTS ai_bots_select ON ai_bots;
CREATE POLICY ai_bots_select ON ai_bots FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_bots_insert ON ai_bots;
CREATE POLICY ai_bots_insert ON ai_bots FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_bots_update ON ai_bots;
CREATE POLICY ai_bots_update ON ai_bots FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_bots_delete ON ai_bots;
CREATE POLICY ai_bots_delete ON ai_bots FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_bots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_bots_updated_at ON ai_bots;
CREATE TRIGGER ai_bots_updated_at
  BEFORE UPDATE ON ai_bots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_bots_updated_at();

-- ============================================================
-- Atomic activation: deactivate the account's current active bot and
-- activate the requested one in a single statement-level transaction,
-- so the partial unique index can never be violated by the swap and two
-- concurrent activations serialize cleanly.
--
-- SECURITY DEFINER + explicit admin membership check (mirrors the RPC
-- pattern of 018/019): callable from the dashboard by admin+ members.
-- Returns true when the bot was activated, false when the bot doesn't
-- exist / belongs to another account.
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_ai_bot(
  p_account_id uuid,
  p_bot_id uuid
)
RETURNS boolean AS $$
DECLARE
  v_found boolean;
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM ai_bots WHERE id = p_bot_id AND account_id = p_account_id
  ) INTO v_found;
  IF NOT v_found THEN
    RETURN false;
  END IF;

  UPDATE ai_bots SET is_active = false
    WHERE account_id = p_account_id AND is_active AND id <> p_bot_id;

  UPDATE ai_bots SET is_active = true
    WHERE id = p_bot_id AND account_id = p_account_id AND NOT is_active;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.activate_ai_bot(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_ai_bot(uuid, uuid) TO service_role;

-- ============================================================
-- ai_bot_templates — admin-managed catalog, merged with the built-in
-- catalog in code. Published rows are readable by any signed-in user;
-- writes happen only via the service-role client (super-admin API).
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_bot_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key               text NOT NULL UNIQUE,
  name              text NOT NULL,
  description       text,
  emoji             text,
  category          text NOT NULL DEFAULT 'general',
  system_prompt     text NOT NULL,
  tone              text NOT NULL DEFAULT 'friendly'
                      CHECK (tone IN ('professional', 'friendly', 'casual', 'formal', 'playful')),
  greeting_message  text,
  sort_order        integer NOT NULL DEFAULT 0,
  is_published      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_bot_templates ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can browse published templates. No INSERT /
-- UPDATE / DELETE policies — writes only via service role (bypasses RLS).
DROP POLICY IF EXISTS ai_bot_templates_select ON ai_bot_templates;
CREATE POLICY ai_bot_templates_select ON ai_bot_templates FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_published);

CREATE OR REPLACE FUNCTION public.update_ai_bot_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_bot_templates_updated_at ON ai_bot_templates;
CREATE TRIGGER ai_bot_templates_updated_at
  BEFORE UPDATE ON ai_bot_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_bot_templates_updated_at();

-- ============================================================
-- ai_support_requests — in-app "help me configure AI" requests.
-- Members create + read their own account's requests; status/notes
-- updates happen only via the service-role client (super-admin API).
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_support_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  topic         text NOT NULL DEFAULT 'setup_help'
                  CHECK (topic IN ('setup_help', 'api_key', 'prompt_tuning', 'handoff', 'other')),
  message       text NOT NULL,
  contact_info  text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'in_progress', 'resolved')),
  admin_notes   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_support_requests_account_idx
  ON ai_support_requests (account_id);
CREATE INDEX IF NOT EXISTS ai_support_requests_status_idx
  ON ai_support_requests (status);

ALTER TABLE ai_support_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_support_requests_select ON ai_support_requests;
CREATE POLICY ai_support_requests_select ON ai_support_requests FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_support_requests_insert ON ai_support_requests;
CREATE POLICY ai_support_requests_insert ON ai_support_requests FOR INSERT
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());

-- No UPDATE / DELETE policies — admin triage runs under service role.

CREATE OR REPLACE FUNCTION public.update_ai_support_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_support_requests_updated_at ON ai_support_requests;
CREATE TRIGGER ai_support_requests_updated_at
  BEFORE UPDATE ON ai_support_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_support_requests_updated_at();

-- ============================================================
-- conversations.ai_away_message_sent — the bot sends its outside-hours
-- away message at most once per conversation; this flags that it did.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_away_message_sent boolean NOT NULL DEFAULT false;

-- ============================================================
-- Backfill: one active "My Assistant" bot per account that already has
-- a persona prompt in ai_configs, preserving current behavior exactly.
-- Skips accounts that already have any bot (idempotent re-runs).
-- ============================================================
INSERT INTO ai_bots (
  account_id, created_by, name, description, system_prompt,
  auto_reply_max_per_conversation, handoff_agent_id, is_active
)
SELECT
  c.account_id,
  c.created_by,
  'My Assistant',
  'Migrated from your previous AI agent setup.',
  c.system_prompt,
  c.auto_reply_max_per_conversation,
  c.handoff_agent_id,
  true
FROM ai_configs c
WHERE c.system_prompt IS NOT NULL
  AND btrim(c.system_prompt) <> ''
  AND NOT EXISTS (SELECT 1 FROM ai_bots b WHERE b.account_id = c.account_id);

-- ============================================================
-- Seed a couple of DB-backed template examples (the full curated
-- catalog ships in code; these demonstrate the admin-managed path).
-- ============================================================
INSERT INTO ai_bot_templates (key, name, description, emoji, category, system_prompt, tone, greeting_message, sort_order)
VALUES
  (
    'feedback_collector',
    'Feedback Collector',
    'Politely gathers customer feedback and ratings after a purchase or support interaction.',
    '📝',
    'engagement',
    'You collect customer feedback for the business. Ask the customer how their recent experience was, and if they are willing, ask them to rate it from 1 to 5. Thank them warmly for any feedback. If they report a problem or complaint, apologize briefly and let them know a team member will follow up — do not attempt to resolve the issue yourself. Never argue with negative feedback.',
    'friendly',
    'Hi! We''d love to hear about your recent experience with us. How did we do?',
    100
  ),
  (
    'delivery_updates',
    'Delivery Updates',
    'Handles "where is my delivery" questions by collecting details and setting expectations.',
    '🚚',
    'operations',
    'You help customers with delivery-related questions. Collect the customer''s order or tracking number if they have not provided it. Never invent delivery dates, tracking statuses, or courier names — if the answer is not in the business context or knowledge excerpts, tell the customer a team member will check and follow up shortly. Be reassuring and concise.',
    'professional',
    NULL,
    110
  )
ON CONFLICT (key) DO NOTHING;

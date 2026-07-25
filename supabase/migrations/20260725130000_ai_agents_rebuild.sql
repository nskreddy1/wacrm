-- ============================================================
-- 20260725130000_ai_agents_rebuild.sql — per-agent AI system
--
-- Replaces the single shared `ai_configs` row with one row PER AGENT
-- (`copilot` = inbox draft assistant, `autoreply` = inbound bot), each
-- fully self-contained: its own provider, BYO API key, model, system
-- prompt, and kind-specific behavior settings.
--
-- Decisions (confirmed with the workspace owner):
--   - Start completely empty: existing `ai_configs` rows are wiped;
--     clients re-create agents in the new guided setup. `ai_configs`
--     is kept (deprecated) until a later cleanup migration.
--   - Fully independent agents: no shared provider/key/model.
--
-- Design notes
--   - `api_key` is AES-256-GCM-encrypted at rest (same encrypt()/
--     decrypt() scheme as channel credentials) and never returned to
--     the client after save.
--   - `settings` is jsonb because the two kinds have disjoint shapes:
--       autoreply: { replyCap, limitMode, scheduleStart, scheduleEnd,
--                    timezone, handoffAgentId }
--       copilot:   { tone }
--     Cross-kind constraints stay in the API layer.
--   - UNIQUE(account_id, kind): one agent of each kind per workspace.
--
-- RLS: settings-class, mirroring `ai_configs` — members read (the
-- inbox needs to know whether AI is on), admin+ writes. The runtime
-- engine (webhooks) uses the service-role client and bypasses RLS.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('copilot', 'autoreply')),
  display_name  text NOT NULL,
  -- Mirrors AI_PROVIDERS in src/features/assistant/lib/ai/types.ts.
  provider      text CHECK (provider IN ('openai', 'anthropic', 'gemini', 'nvidia', 'groq', 'openrouter', 'together', 'mistral', 'deepseek', 'xai', 'ollama', 'custom')),
  model         text,
  api_key       text,             -- AES-256-GCM-encrypted BYO provider key
  base_url      text,             -- custom / OpenAI-compatible endpoints
  system_prompt text,             -- persona / tone / business context
  is_enabled    boolean NOT NULL DEFAULT false,
  settings      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, kind)
);

ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;

-- SELECT: any member (viewer+) — the inbox banner / draft button need
-- to know whether an agent is live.
DROP POLICY IF EXISTS ai_agents_select ON ai_agents;
CREATE POLICY ai_agents_select ON ai_agents FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS ai_agents_insert ON ai_agents;
CREATE POLICY ai_agents_insert ON ai_agents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_agents_update ON ai_agents;
CREATE POLICY ai_agents_update ON ai_agents FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_agents_delete ON ai_agents;
CREATE POLICY ai_agents_delete ON ai_agents FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Keep updated_at fresh on every write (mirrors ai_configs trigger).
CREATE OR REPLACE FUNCTION public.update_ai_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_agents_updated_at ON ai_agents;
CREATE TRIGGER ai_agents_updated_at
  BEFORE UPDATE ON ai_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_agents_updated_at();

-- ============================================================
-- Per-agent usage attribution.
--
-- `ai_usage_log.agent_id` makes Run History / Usage natively
-- per-agent. Nullable: pre-rebuild rows keep only their `mode`,
-- which the runs API still accepts as a fallback filter.
-- ON DELETE SET NULL — spend history outlives a deleted agent.
-- ============================================================
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES ai_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_agent_created
  ON ai_usage_log(agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

-- ============================================================
-- Start-empty wipe (explicitly requested): remove the legacy shared
-- config so no account silently keeps running on the old single-row
-- model. The old table/columns stay in place (deprecated) until a
-- follow-up cleanup migration drops them.
-- ============================================================
DELETE FROM ai_configs;

-- ============================================================
-- Per-agent configuration: give the Auto-Reply Agent its own
-- system prompt, separate from the Support Copilot's.
--
-- Before this, both agents in the AI Agents console shared the
-- single `ai_configs.system_prompt`, so the Configuration tab was
-- identical for both. Now:
--   * `system_prompt`            → Support Copilot (inbox drafts)
--   * `autoreply_system_prompt`  → Auto-Reply Agent (customer-facing
--                                  bot). NULL = inherit the Copilot
--                                  prompt (previous behaviour, so
--                                  existing accounts change nothing).
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS autoreply_system_prompt text;

COMMENT ON COLUMN ai_configs.autoreply_system_prompt IS
  'System prompt for the customer-facing Auto-Reply Agent. NULL inherits system_prompt (the Support Copilot prompt).';

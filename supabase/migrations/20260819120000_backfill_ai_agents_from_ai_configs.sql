-- ============================================================
-- 20260819120000_backfill_ai_agents_from_ai_configs.sql
--
-- Why: `ai_agents` is the ONLY table the bot runtime reads
-- (auto-reply.ts, /api/ai/draft, /api/ai/playground all go through
-- loadAgentConfig → ai_agents), but the super-admin console was still
-- writing `ai_configs`. Any workspace provisioned from the platform
-- console therefore had a fully configured row that nothing consumed:
-- provisioning was a silent no-op on the bot. The console is being
-- re-pointed at `ai_agents` in the same change; this migration carries
-- the rows it already wrote across so those workspaces keep working.
--
-- Column mapping (ai_configs → ai_agents):
--   provider, model, api_key, base_url, system_prompt, created_by → same
--   is_active                        → is_enabled AND suggestions_enabled
--   auto_reply_enabled               → autoreply_enabled
--   auto_reply_max_per_conversation  → settings.replyCap
--   auto_reply_limit_mode            → settings.limitMode
--   auto_reply_schedule_start/_end   → settings.scheduleStart/scheduleEnd
--   auto_reply_timezone              → settings.timezone
--   handoff_agent_id                 → settings.handoffAgentId
--   embeddings_api_key               → settings.embeddingsApiKey
--
-- The two key columns are copied as CIPHERTEXT, verbatim: both tables
-- are encrypted with the same AES-256-GCM ENCRYPTION_KEY, so no
-- re-encryption (and no plaintext anywhere) is involved.
--
-- Safety
--   • INSERT … SELECT … WHERE NOT EXISTS — never overwrites an agent
--     the customer already configured themselves; `ai_agents` wins on
--     conflict because it is the row the runtime has been using.
--   • Respects ai_agents_account_default_uniq (one kind='default' row
--     per account).
--   • Idempotent: re-running inserts nothing.
--   • `ai_configs` is NOT dropped — the tenant /api/ai/config route
--     still writes it. Retiring that path is a separate change.
--   • No SECURITY DEFINER function is created or altered.
-- ============================================================

insert into ai_agents (
  account_id,
  created_by,
  kind,
  display_name,
  provider,
  model,
  api_key,
  base_url,
  system_prompt,
  is_enabled,
  suggestions_enabled,
  autoreply_enabled,
  settings
)
select
  c.account_id,
  c.created_by,
  'default',
  'AI Assistant',
  c.provider,
  c.model,
  c.api_key,
  c.base_url,
  c.system_prompt,
  c.is_active,
  c.is_active,
  c.auto_reply_enabled,
  -- strip_nulls keeps the jsonb shape identical to what the API layer
  -- writes: absent keys, not explicit nulls, so readSettings() falls
  -- back to its own defaults rather than reading a null as "set".
  jsonb_strip_nulls(
    jsonb_build_object(
      'replyCap',          c.auto_reply_max_per_conversation,
      'limitMode',         c.auto_reply_limit_mode,
      -- `time` → 'HH:MM'; agents.ts tolerates 'HH:MM:SS' too, but the
      -- API writes 'HH:MM' and the console reads it back into a
      -- <input type="time">, which only accepts that form.
      'scheduleStart',     to_char(c.auto_reply_schedule_start, 'HH24:MI'),
      'scheduleEnd',       to_char(c.auto_reply_schedule_end, 'HH24:MI'),
      'timezone',          c.auto_reply_timezone,
      'handoffAgentId',    c.handoff_agent_id,
      'embeddingsApiKey',  c.embeddings_api_key
    )
  )
from ai_configs c
where not exists (
  select 1
  from ai_agents a
  where a.account_id = c.account_id
    and a.kind = 'default'
);

-- ============================================================
-- Workflows unification: the Flows engine absorbs every
-- capability of the legacy Automations module. This migration:
--   1. Widens flows.trigger_type to the absorbed event triggers.
--   2. Widens flow_nodes.node_type to the absorbed action nodes.
--   3. Adds flow_runs.wake_at + 'waiting' status for the wait node.
--   4. Creates workflow_connections — stored credentials for
--      external HTTP actions (secret injected server-side only).
-- The legacy automations tables are left in place for audit
-- history; the app no longer reads or writes them.
-- ============================================================

-- 1. Trigger types --------------------------------------------------
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_trigger_type_check;
ALTER TABLE flows ADD CONSTRAINT flows_trigger_type_check CHECK (
  trigger_type = ANY (ARRAY[
    'keyword'::text,
    'first_inbound_message'::text,
    'manual'::text,
    'new_message_received'::text,
    'new_contact_created'::text,
    'tag_added'::text,
    'conversation_assigned'::text,
    'interactive_reply'::text,
    'scheduled'::text
  ])
);

-- 2. Node types -----------------------------------------------------
ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_node_type_check CHECK (
  node_type = ANY (ARRAY[
    'start'::text,
    'send_buttons'::text,
    'send_list'::text,
    'send_message'::text,
    'send_media'::text,
    'collect_input'::text,
    'condition'::text,
    'set_tag'::text,
    'handoff'::text,
    'end'::text,
    -- Absorbed automation actions:
    'send_template'::text,
    'update_contact_field'::text,
    'assign_conversation'::text,
    'create_deal'::text,
    'send_webhook'::text,
    'close_conversation'::text,
    'wait'::text
  ])
);

-- 3. Wait/resume machinery ------------------------------------------
ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS wake_at TIMESTAMPTZ;

ALTER TABLE flow_runs DROP CONSTRAINT IF EXISTS flow_runs_status_check;
ALTER TABLE flow_runs ADD CONSTRAINT flow_runs_status_check CHECK (
  status = ANY (ARRAY[
    'active'::text,
    'waiting'::text,
    'completed'::text,
    'handed_off'::text,
    'timed_out'::text,
    'paused_by_agent'::text,
    'failed'::text
  ])
);

-- Cron sweep hot path: "runs due to wake" is a tiny partial index.
CREATE INDEX IF NOT EXISTS idx_flow_runs_wake_due
  ON flow_runs (wake_at)
  WHERE status = 'waiting';

-- Event dispatch hot path: active flows by account + trigger.
CREATE INDEX IF NOT EXISTS idx_flows_account_trigger_active
  ON flows (account_id, trigger_type)
  WHERE status = 'active';

-- 4. Stored connections for external HTTP actions -------------------
CREATE TABLE IF NOT EXISTS workflow_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  name TEXT NOT NULL,
  -- Where the secret goes on outbound requests.
  auth_type TEXT NOT NULL DEFAULT 'bearer'
    CHECK (auth_type IN ('bearer', 'header', 'basic')),
  -- Header name for auth_type='header' (e.g. 'X-Api-Key').
  header_name TEXT,
  -- The secret value. Only ever read server-side by the engine;
  -- API list endpoints must never return this column.
  secret TEXT NOT NULL,
  -- Optional allow-list prefix; when set, nodes using this
  -- connection may only call URLs starting with it.
  base_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_workflow_connections_account
  ON workflow_connections (account_id);

ALTER TABLE workflow_connections ENABLE ROW LEVEL SECURITY;

-- Members may see connection metadata (the API layer strips
-- `secret`; RLS here scopes rows to the caller's account).
DROP POLICY IF EXISTS workflow_connections_select ON workflow_connections;
CREATE POLICY workflow_connections_select ON workflow_connections
  FOR SELECT USING (
    account_id IN (
      SELECT p.account_id FROM profiles p WHERE p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS workflow_connections_insert ON workflow_connections;
CREATE POLICY workflow_connections_insert ON workflow_connections
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT p.account_id FROM profiles p
      WHERE p.user_id = auth.uid() AND p.account_role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS workflow_connections_update ON workflow_connections;
CREATE POLICY workflow_connections_update ON workflow_connections
  FOR UPDATE USING (
    account_id IN (
      SELECT p.account_id FROM profiles p
      WHERE p.user_id = auth.uid() AND p.account_role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS workflow_connections_delete ON workflow_connections;
CREATE POLICY workflow_connections_delete ON workflow_connections
  FOR DELETE USING (
    account_id IN (
      SELECT p.account_id FROM profiles p
      WHERE p.user_id = auth.uid() AND p.account_role IN ('owner','admin')
    )
  );

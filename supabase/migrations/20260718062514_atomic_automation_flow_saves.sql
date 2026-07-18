-- Atomic graph replacement for Automation and Flow editors.
-- These functions intentionally use SECURITY INVOKER. The application calls them
-- with the service role after performing account/role authorization, and each
-- function independently verifies the expected account before mutating rows.

CREATE OR REPLACE FUNCTION replace_automation_steps_atomic(
  p_automation_id UUID,
  p_account_id UUID,
  p_steps JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM automations
    WHERE id = p_automation_id AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'automation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF jsonb_typeof(p_steps) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'steps_must_be_an_array' USING ERRCODE = '22023';
  END IF;

  DELETE FROM automation_steps WHERE automation_id = p_automation_id;

  INSERT INTO automation_steps (
    id, automation_id, parent_step_id, branch, step_type, step_config, position
  )
  SELECT
    (item->>'id')::UUID,
    p_automation_id,
    NULLIF(item->>'parent_step_id', '')::UUID,
    NULLIF(item->>'branch', ''),
    item->>'step_type',
    COALESCE(item->'step_config', '{}'::jsonb),
    (item->>'position')::INTEGER
  FROM jsonb_array_elements(p_steps) AS item;
END;
$$;

REVOKE ALL ON FUNCTION replace_automation_steps_atomic(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_automation_steps_atomic(UUID, UUID, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION save_flow_graph_atomic(
  p_flow_id UUID,
  p_account_id UUID,
  p_patch JSONB,
  p_nodes JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM flows WHERE id = p_flow_id AND account_id = p_account_id
  ) THEN
    RAISE EXCEPTION 'flow_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE flows
  SET
    name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE name END,
    description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE description END,
    trigger_type = CASE WHEN p_patch ? 'trigger_type' THEN p_patch->>'trigger_type' ELSE trigger_type END,
    trigger_config = CASE WHEN p_patch ? 'trigger_config' THEN p_patch->'trigger_config' ELSE trigger_config END,
    entry_node_id = CASE WHEN p_patch ? 'entry_node_id' THEN p_patch->>'entry_node_id' ELSE entry_node_id END,
    fallback_policy = CASE WHEN p_patch ? 'fallback_policy' THEN p_patch->'fallback_policy' ELSE fallback_policy END,
    updated_at = NOW()
  WHERE id = p_flow_id AND account_id = p_account_id;

  IF p_nodes IS NOT NULL THEN
    IF jsonb_typeof(p_nodes) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'nodes_must_be_an_array' USING ERRCODE = '22023';
    END IF;

    DELETE FROM flow_nodes WHERE flow_id = p_flow_id;

    INSERT INTO flow_nodes (
      flow_id, node_key, node_type, config, position_x, position_y
    )
    SELECT
      p_flow_id,
      item->>'node_key',
      item->>'node_type',
      COALESCE(item->'config', '{}'::jsonb),
      COALESCE((item->>'position_x')::INTEGER, 0),
      COALESCE((item->>'position_y')::INTEGER, 0)
    FROM jsonb_array_elements(p_nodes) AS item;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION save_flow_graph_atomic(UUID, UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_flow_graph_atomic(UUID, UUID, JSONB, JSONB) TO service_role;

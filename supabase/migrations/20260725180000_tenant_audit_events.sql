-- ============================================================
-- Tenant-facing audit trail ("who did what, when" per workspace).
--
-- Complements platform_audit_log (super-admin actions) with
-- workspace-level events: member changes, agent config edits,
-- template lifecycle, broadcasts, channel changes, exports.
--
-- Security properties:
--   * Append-only: INSERT + SELECT policies only. No UPDATE or
--     DELETE policies exist, so even workspace owners cannot
--     tamper with history (service role excepted, as always).
--   * SELECT restricted to admin+ — audit history can reveal
--     operational details regular agents don't need.
--   * INSERT requires membership AND actor_id = auth.uid(), so a
--     member can't forge entries attributed to someone else.
--     Server routes using the service-role client set actor_id
--     explicitly from the authenticated session.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Denormalized so history stays readable after a member leaves.
  actor_label text,
  -- Machine-readable key: 'member.invited', 'agent.updated',
  -- 'template.submitted', 'broadcast.sent', ...
  action text NOT NULL,
  -- Entity descriptor: 'ai_agent:<uuid>', 'template:<uuid>', ...
  entity text NOT NULL,
  -- Small, PII-light diff/context. Never store message bodies,
  -- credentials, or full contact records here.
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_account_created_idx
  ON audit_events (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_account_action_idx
  ON audit_events (account_id, action);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_select ON audit_events;
CREATE POLICY audit_events_select ON audit_events FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS audit_events_insert ON audit_events;
CREATE POLICY audit_events_insert ON audit_events FOR INSERT
  WITH CHECK (
    is_account_member(account_id)
    AND actor_id = auth.uid()
  );

-- Intentionally NO update/delete policies: append-only by design.

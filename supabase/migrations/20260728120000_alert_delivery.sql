-- ============================================================================
-- Alert delivery layer (transactional outbox) for unattended-handoff alerts.
--
-- Context: the handoff watchdog (20260727110000) already detects overdue
-- handoffs and inserts in-app `notifications` rows. Those alerts are only
-- visible when someone has the app open — the exact situation an unattended
-- handoff implies they don't. This migration adds the delivery layer that
-- pushes those alerts out to external channels (Slack first; WhatsApp,
-- Telegram, email later).
--
-- Design notes (enterprise checklist applied):
--   * Transactional outbox: `alert_deliveries` rows are enqueued in the same
--     transaction scope as the notification insert; a dispatcher cron drains
--     the queue. Crash between enqueue and send -> row stays `pending` and is
--     retried. Crash after send -> `sent` row is never retried.
--   * Idempotency: UNIQUE(notification_id, destination_id) makes duplicate
--     enqueue impossible, no matter how often the watchdog or cron overlaps.
--   * Retry with backoff + dead-letter: `attempts`, `next_attempt_at`, and
--     `status = 'dead'` after max attempts, so a broken webhook cannot burn
--     provider quota forever.
--   * Credentials (e.g. per-workspace Slack bot tokens from the OAuth flow)
--     are AES-256-GCM encrypted by the server before storage and the column
--     is NEVER granted to browser roles (column-level grants below). Only
--     service_role can read it. RLS additionally scopes rows per account.
--   * Additive only: no existing table, constraint, or policy is touched.
--
-- Prereqs from earlier migrations (both exist since 001 / 017):
--   * update_updated_at_column()  (001_initial_schema.sql)
--   * is_account_member(uuid, text)  (017_account_sharing.sql)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Destinations: where an account wants its alerts pushed.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- One connector per provider, deliberately NOT a generic abstraction.
  provider TEXT NOT NULL CHECK (provider IN ('slack', 'whatsapp', 'telegram', 'email')),

  -- Human label shown in settings ("#support-alerts", "Ops WhatsApp group").
  display_name TEXT NOT NULL DEFAULT '',

  -- Provider-specific, NON-secret routing config:
  --   slack:    { "team_id", "team_name", "channel_id", "channel_name" }
  --   whatsapp: { "to_msisdn", "template_name", "template_language" }
  --   telegram: { "chat_id" }
  --   email:    { "to": ["ops@example.com"] }
  config JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Provider secrets (Slack xoxb- token), AES-256-GCM encrypted server-side.
  -- Column-level grants below keep this out of every browser session.
  credentials_encrypted TEXT,

  -- Which alert kinds this destination receives. Matches notifications.type
  -- values; today only the watchdog enqueues ('ai_escalation').
  event_types TEXT[] NOT NULL DEFAULT ARRAY['ai_escalation'],

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE alert_destinations IS
  'Per-account external alert channels (Slack workspace, WhatsApp number, ...). Secrets live only in credentials_encrypted, which browser roles cannot select.';

-- A workspace may add several destinations, but not the exact same channel
-- twice (prevents accidental double-alerting from a double-click on save).
CREATE UNIQUE INDEX IF NOT EXISTS alert_destinations_account_provider_config_key
  ON alert_destinations (account_id, provider, (config::text));

CREATE INDEX IF NOT EXISTS idx_alert_destinations_account
  ON alert_destinations (account_id) WHERE enabled;

DROP TRIGGER IF EXISTS set_updated_at ON alert_destinations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON alert_destinations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. Deliveries: the outbox. One row per (notification, destination).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES alert_destinations(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'dead')),

  -- Denormalized snapshot of what to send, so the dispatcher never needs to
  -- re-join notifications (whose row may later be mutated or deleted).
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Idempotency anchor: the same notification can never be enqueued twice to
  -- the same destination, regardless of cron overlap or watchdog re-runs.
  CONSTRAINT alert_deliveries_notification_destination_key
    UNIQUE (notification_id, destination_id)
);

COMMENT ON TABLE alert_deliveries IS
  'Transactional outbox for external alert delivery. Written exclusively by the server (service_role); browsers can only read their account''s rows.';

-- The dispatcher''s work-claim query: due pending/failed rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_due
  ON alert_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_account
  ON alert_deliveries (account_id, created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON alert_deliveries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. RLS — checklist: RLS on every exposed table; TO authenticated always
--    paired with an ownership predicate; UPDATE has USING + WITH CHECK.
-- ----------------------------------------------------------------------------
ALTER TABLE alert_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_deliveries ENABLE ROW LEVEL SECURITY;

-- Destinations: admins manage; agents may read (to see where alerts go).
DROP POLICY IF EXISTS alert_destinations_select ON alert_destinations;
CREATE POLICY alert_destinations_select ON alert_destinations
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS alert_destinations_insert ON alert_destinations;
CREATE POLICY alert_destinations_insert ON alert_destinations
  FOR INSERT TO authenticated
  WITH CHECK (
    is_account_member(account_id, 'admin')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS alert_destinations_update ON alert_destinations;
CREATE POLICY alert_destinations_update ON alert_destinations
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS alert_destinations_delete ON alert_destinations;
CREATE POLICY alert_destinations_delete ON alert_destinations
  FOR DELETE TO authenticated
  USING (is_account_member(account_id, 'admin'));

-- Deliveries: read-only visibility for the account; all writes go through
-- service_role (no INSERT/UPDATE/DELETE policies for authenticated at all).
DROP POLICY IF EXISTS alert_deliveries_select ON alert_deliveries;
CREATE POLICY alert_deliveries_select ON alert_deliveries
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'agent'));

-- ----------------------------------------------------------------------------
-- 4. Column-level grants: browsers must never see credentials_encrypted,
--    even on their own rows. RLS filters rows; grants filter columns.
-- ----------------------------------------------------------------------------
REVOKE ALL ON alert_destinations FROM anon, authenticated;
REVOKE ALL ON alert_deliveries FROM anon, authenticated;

GRANT SELECT (
  id, account_id, provider, display_name, config,
  event_types, enabled, created_by, created_at, updated_at
) ON alert_destinations TO authenticated;

GRANT INSERT (
  account_id, provider, display_name, config,
  event_types, enabled, created_by
) ON alert_destinations TO authenticated;

GRANT UPDATE (
  display_name, config, event_types, enabled
) ON alert_destinations TO authenticated;

GRANT DELETE ON alert_destinations TO authenticated;

GRANT SELECT ON alert_deliveries TO authenticated;

GRANT ALL ON alert_destinations TO service_role;
GRANT ALL ON alert_deliveries TO service_role;

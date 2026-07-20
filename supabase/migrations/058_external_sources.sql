-- ============================================================
-- 058_external_sources.sql — External recipient sources
--
-- Adds the `external_sources` table backing the broadcast
-- "External source" audience connector. A source describes how to
-- pull recipients (phone + name + template variables) from an
-- external backend at broadcast time:
--
--   - rest         — a JSON REST endpoint the workspace controls
--   - postgres     — a read-only SQL query over a Postgres database
--   - google_sheet — a shared Google Sheet (CSV export)
--
-- Design notes
--   - Account-scoped, like `api_keys` (026). `created_by` is audit
--     only, ON DELETE SET NULL.
--   - `config` holds NON-secret configuration (url, method, json
--     paths, sql text, sheet url, pagination mode). Rendered in the
--     dashboard.
--   - `encrypted_secret` holds the sensitive part (bearer token /
--     header value, Postgres connection string) encrypted with
--     AES-256-GCM under ENCRYPTION_KEY (same helper as
--     `whatsapp_config`). It is write-only from the dashboard: API
--     routes never select it back to the client, only server-side
--     fetchers decrypt it. NULL for sources with no secret (public
--     endpoint / public sheet).
--   - `field_map` maps source columns/paths onto the normalized
--     recipient shape: { "phone": "...", "name": "...",
--     "params": { "1": "...", "2": "..." } }.
--   - `last_tested_at` / `last_row_count` are stamped by the
--     preview ("Test connection") endpoint so the settings list can
--     show freshness without refetching the external system.
--
-- RLS
--   Settings-class table, mirroring `api_keys` (026): any account
--   member may read the roster; only admin+ may create / update /
--   delete. Server-side fetch routes use the session client, so RLS
--   applies there too.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS external_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN ('rest', 'postgres', 'google_sheet')),
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  encrypted_secret text,                    -- AES-256-GCM, never sent to clients
  field_map        jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_tested_at   timestamptz,
  last_row_count   integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- account_id: every "list this account's sources" query filters on it.
CREATE INDEX IF NOT EXISTS external_sources_account_id_idx
  ON external_sources (account_id);

ALTER TABLE external_sources ENABLE ROW LEVEL SECURITY;

-- SELECT: any member of the account (viewer+) can see the roster.
-- `encrypted_secret` is in the table but client-facing routes never
-- select it.
DROP POLICY IF EXISTS external_sources_select ON external_sources;
CREATE POLICY external_sources_select ON external_sources FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: admin+ only (settings-class).
DROP POLICY IF EXISTS external_sources_insert ON external_sources;
CREATE POLICY external_sources_insert ON external_sources FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS external_sources_update ON external_sources;
CREATE POLICY external_sources_update ON external_sources FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS external_sources_delete ON external_sources;
CREATE POLICY external_sources_delete ON external_sources FOR DELETE
  USING (is_account_member(account_id, 'admin'));

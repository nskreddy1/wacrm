-- ============================================================
-- 20260816120000_integration_layer.sql
--
-- Governed integration layer: lets an account ground the AI in data
-- that lives in the CLIENT's own system (an orders database, a fees
-- table, an internal REST API) so customer-support replies can answer
-- "where is my order?" truthfully instead of guessing.
--
-- Two tables:
--   integration_connections — where the external system is + how to
--                             authenticate (credential encrypted).
--   integration_operations  — the ONLY statements that may ever run
--                             against it, defined once by an admin.
--
-- Why named operations instead of letting the AI write SQL
--   The AI never composes a statement. An admin defines a
--   parameterised statement once; the AI may only invoke it by name.
--   Parameters are BOUND by the driver ($1), never string-concatenated,
--   so this is the injection-proof equivalent of a stored procedure.
--
-- THE IDENTITY-BINDING RULE (the security crux of this feature)
--   On the customer-support path the inbound message is UNTRUSTED
--   input. If the model were allowed to extract "order 5567" from a
--   WhatsApp message and we queried it, customer A could read customer
--   B's order — a cross-customer data leak inside the client's own
--   system of record.
--
--   So parameters do not come from the model. Each parameter declares
--   a BINDING to a field of the already-resolved contact row
--   (`contact.phone`, `contact.email`, ...) and the engine substitutes
--   it server-side. This mirrors how `buildCrmContext()` already scopes
--   every query with `.eq('contact_id', contactId)`.
--
--   "Which of my orders shipped?" still works: the operation returns
--   that contact's rows (capped by row_limit) and the model narrows
--   within a result set that is safe by construction.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Fix plaintext credentials on workflow_connections
--
-- `workflow_connections.secret` has always been stored raw, while the
-- comparable `external_sources.encrypted_secret` and `whatsapp_config`
-- both use AES-256-GCM. Encryption happens in Node (ENCRYPTION_KEY),
-- not in SQL, so we cannot convert rows here; instead we record the
-- format explicitly and let the engine read both.
--
-- Format is a COLUMN rather than sniffed from the string because a
-- basic-auth secret ("user:pass") contains exactly one colon and would
-- be misdetected as the legacy CBC ciphertext format.
-- Existing rows default to 'plaintext'; new writes store 'gcm'.
-- ------------------------------------------------------------
ALTER TABLE workflow_connections
  ADD COLUMN IF NOT EXISTS secret_format text NOT NULL DEFAULT 'plaintext';

ALTER TABLE workflow_connections
  DROP CONSTRAINT IF EXISTS workflow_connections_secret_format_check;
ALTER TABLE workflow_connections
  ADD CONSTRAINT workflow_connections_secret_format_check
  CHECK (secret_format IN ('plaintext', 'gcm'));

-- ------------------------------------------------------------
-- 1. Connections
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name             text NOT NULL,

  -- Only synchronous request/response backends. Kafka/PubSub are
  -- deliberately absent: they are append-only logs and cannot answer a
  -- point query ("the order for this phone number") without consuming a
  -- topic or maintaining a materialized view, which cannot meet the
  -- ~1-2s budget of an auto-reply. Event ingest is a separate feature —
  -- land events in a local table, then point a connection at that.
  kind             text NOT NULL CHECK (kind IN ('postgres', 'mysql', 'rest')),

  -- Connection string (postgres/mysql) or bearer/header value (rest),
  -- AES-256-GCM under ENCRYPTION_KEY. Write-only from the dashboard:
  -- API routes never select this back to a client.
  encrypted_secret text,

  -- REST only: allow-list prefix. Every request built from an operation
  -- must start with this, so a credential cannot be replayed elsewhere.
  base_url         text,

  -- Writes are OFF unless an admin deliberately turns them on. A
  -- write-mode operation is refused while this is true, so "enable
  -- writes" is a separate, auditable decision from "define an operation".
  read_only        boolean NOT NULL DEFAULT true,
  enabled          boolean NOT NULL DEFAULT true,

  last_tested_at   timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS integration_connections_account_id_idx
  ON integration_connections (account_id);

-- ------------------------------------------------------------
-- 2. Operations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_operations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id    uuid NOT NULL
                     REFERENCES integration_connections(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Stable identifier the model invokes, e.g. 'order_status'.
  name             text NOT NULL,
  -- Shown to the model so it can decide when this is relevant. This is
  -- the whole "tool description", so it matters for answer quality.
  description      text NOT NULL DEFAULT '',

  mode             text NOT NULL DEFAULT 'read'
                     CHECK (mode IN ('read', 'write')),

  -- Parameterised statement ($1..$n) for SQL kinds, or a path template
  -- for REST. Validated at DEFINITION time (single SELECT for reads; no
  -- multi-statement / DROP / TRUNCATE / unqualified UPDATE for writes)
  -- so a bad statement is rejected when saved, not when a customer is
  -- waiting on a reply.
  statement        text NOT NULL,

  -- Ordered parameter bindings. Each entry is
  --   { "param": 1, "source": "contact.phone" }
  -- and `source` must be one of the contact fields the engine knows how
  -- to resolve. The MODEL NEVER SUPPLIES A VALUE — see the header note.
  bindings         jsonb NOT NULL DEFAULT '[]'::jsonb
                     CHECK (jsonb_typeof(bindings) = 'array'),

  -- Whether the customer-facing auto-reply may use this for grounding.
  expose_to_autoreply boolean NOT NULL DEFAULT false,

  -- Belt-and-braces for the decision "auto-reply is read-only". Even if
  -- application code regressed, the database refuses to let a write
  -- operation be reachable from an untrusted customer message.
  CONSTRAINT integration_operations_autoreply_is_read_only
    CHECK (NOT (expose_to_autoreply AND mode = 'write')),

  -- Writes are confirmed by a human in the rep chat before executing.
  requires_confirmation boolean NOT NULL DEFAULT true,
  CONSTRAINT integration_operations_writes_need_confirmation
    CHECK (mode = 'read' OR requires_confirmation),

  -- Caps the rows handed back to the model; keeps prompts bounded and
  -- limits the blast radius of an over-broad statement.
  row_limit        integer NOT NULL DEFAULT 20
                     CHECK (row_limit > 0 AND row_limit <= 200),
  timeout_ms       integer NOT NULL DEFAULT 5000
                     CHECK (timeout_ms BETWEEN 500 AND 30000),

  enabled          boolean NOT NULL DEFAULT true,
  last_run_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS integration_operations_account_id_idx
  ON integration_operations (account_id);
CREATE INDEX IF NOT EXISTS integration_operations_connection_id_idx
  ON integration_operations (connection_id);

-- ------------------------------------------------------------
-- 3. RLS — settings-class, mirroring external_sources (058)
--
--   SELECT           any account member (viewer+), so a sales rep can
--                    discover and invoke operations.
--   INSERT/UPDATE/DELETE  admin+ only, so only an admin can decide what
--                    statements exist and where they point.
--
-- That split is what makes "sales can use it" safe: reps invoke,
-- admins define, and neither ever receives `encrypted_secret` because
-- client-facing routes do not select it.
-- ------------------------------------------------------------
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_connections_select ON integration_connections;
CREATE POLICY integration_connections_select ON integration_connections FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS integration_connections_insert ON integration_connections;
CREATE POLICY integration_connections_insert ON integration_connections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_connections_update ON integration_connections;
CREATE POLICY integration_connections_update ON integration_connections FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_connections_delete ON integration_connections;
CREATE POLICY integration_connections_delete ON integration_connections FOR DELETE
  USING (is_account_member(account_id, 'admin'));

ALTER TABLE integration_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_operations_select ON integration_operations;
CREATE POLICY integration_operations_select ON integration_operations FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS integration_operations_insert ON integration_operations;
CREATE POLICY integration_operations_insert ON integration_operations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_operations_update ON integration_operations;
CREATE POLICY integration_operations_update ON integration_operations FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_operations_delete ON integration_operations;
CREATE POLICY integration_operations_delete ON integration_operations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

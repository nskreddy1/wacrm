-- ============================================================
-- 20260816120000_assistant_sessions.sql — Mira chat history
--
-- The copilot widget was entirely ephemeral: `useChat` held the
-- transcript in React state, so closing the panel or reloading the
-- page destroyed the conversation. This adds durable, resumable
-- sessions so a user can reopen an earlier thread and keep going
-- with the model's full prior context.
--
-- Visibility: PRIVATE TO THE USER, scoped to the account.
--   Mira is presented as "your CRM copilot" and a transcript can
--   contain half-formed thinking about deals, people and pay — so a
--   workspace admin does not get to read a colleague's threads.
--   RLS therefore requires BOTH `is_account_member(account_id)` AND
--   `user_id = auth.uid()`. account_id stays on every row so the V2
--   multi-account switcher needs no destructive migration, and so a
--   thread never follows the user into a different workspace.
--
-- Shape: one row per UI message rather than a single jsonb blob on
--   the session. Messages are appended and individually rewritten as
--   tool parts resolve (pending → approval → output), and a blob
--   would mean read-modify-write of the entire transcript on every
--   token-stream completion.
--
--   `parts` holds the AI SDK `UIMessage.parts` array verbatim. That
--   is deliberately schemaless: it carries text, tool calls, tool
--   state and approval records whose shapes are owned by the SDK, and
--   mirroring that into columns would break on every SDK change.
--   `message_id` is the SDK's own id (text, not uuid), which is what
--   makes the per-turn upsert idempotent.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ------------------------------------------------------------------
-- Sessions
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- The owning user. ON DELETE CASCADE: a removed user's private
  -- threads have no other reader, so they go with them.
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Derived from the first user message (see title_from_text in
  -- src/features/assistant/lib/sessions.ts). Nullable so a session
  -- row can exist for the instant before the first turn lands.
  title           text,
  -- Distinct from updated_at: ordering the history list by "when did
  -- someone last say something" must not be perturbed by a rename.
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assistant_sessions ENABLE ROW LEVEL SECURITY;

-- The history list: newest thread first, for one user in one account.
CREATE INDEX IF NOT EXISTS idx_assistant_sessions_owner
  ON assistant_sessions (account_id, user_id, last_message_at DESC);

DROP POLICY IF EXISTS assistant_sessions_select ON assistant_sessions;
CREATE POLICY assistant_sessions_select ON assistant_sessions FOR SELECT
  USING (is_account_member(account_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS assistant_sessions_insert ON assistant_sessions;
CREATE POLICY assistant_sessions_insert ON assistant_sessions FOR INSERT
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS assistant_sessions_update ON assistant_sessions;
CREATE POLICY assistant_sessions_update ON assistant_sessions FOR UPDATE
  USING (is_account_member(account_id) AND user_id = auth.uid())
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS assistant_sessions_delete ON assistant_sessions;
CREATE POLICY assistant_sessions_delete ON assistant_sessions FOR DELETE
  USING (is_account_member(account_id) AND user_id = auth.uid());

-- ------------------------------------------------------------------
-- Messages
--
-- account_id / user_id are denormalised from the parent session so
-- RLS is a direct column comparison instead of a correlated subquery
-- on every row of a transcript read.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assistant_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The AI SDK's own message id. Text, because the SDK generates
  -- prefixed ids ("msg-…"), not uuids.
  message_id  text NOT NULL,
  role        text NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  -- Verbatim UIMessage.parts — see the header note.
  parts       jsonb NOT NULL DEFAULT '[]',
  -- Explicit ordering. Two messages in one turn can share a
  -- created_at at timestamptz resolution, and the transcript's order
  -- is load-bearing for the model, so we never rely on insertion
  -- order or a timestamp tie-break.
  seq         integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Makes the per-turn "upsert the whole merged transcript" idempotent
  -- and lets a message be rewritten in place as its tool parts settle.
  UNIQUE (session_id, message_id)
);

ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_assistant_messages_session
  ON assistant_messages (session_id, seq);

DROP POLICY IF EXISTS assistant_messages_select ON assistant_messages;
CREATE POLICY assistant_messages_select ON assistant_messages FOR SELECT
  USING (is_account_member(account_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS assistant_messages_insert ON assistant_messages;
CREATE POLICY assistant_messages_insert ON assistant_messages FOR INSERT
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS assistant_messages_update ON assistant_messages;
CREATE POLICY assistant_messages_update ON assistant_messages FOR UPDATE
  USING (is_account_member(account_id) AND user_id = auth.uid())
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS assistant_messages_delete ON assistant_messages;
CREATE POLICY assistant_messages_delete ON assistant_messages FOR DELETE
  USING (is_account_member(account_id) AND user_id = auth.uid());

-- ------------------------------------------------------------------
-- updated_at triggers (mirrors the ai_agents convention)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_assistant_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assistant_sessions_updated_at ON assistant_sessions;
CREATE TRIGGER assistant_sessions_updated_at
  BEFORE UPDATE ON assistant_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_assistant_updated_at();

DROP TRIGGER IF EXISTS assistant_messages_updated_at ON assistant_messages;
CREATE TRIGGER assistant_messages_updated_at
  BEFORE UPDATE ON assistant_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_assistant_updated_at();

-- ============================================================
-- Affective event history (ADR-002 §3, item 4).
--
-- APPEND-ONLY by design. The old model kept one overwritten
-- `ai_sentiment` column, which made trends unaskable: "was this
-- customer getting angrier over the last hour?" had no answer because
-- history was destroyed on every write. Reports, escalation-trend
-- detection, and the future learning loop all read from here.
--
-- One row per classified inbound turn. `emotions` is the multi-label
-- vector ({"frustration":0.8,"anxiety":0.4}), validated app-side
-- against the closed vocabulary before insert. `source` is the
-- modality invariant: 'lexical' from text turns today; a voice-note
-- sidecar later inserts 'prosodic' rows for the SAME conversation and
-- nothing else changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_affective_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- Multi-label emotion vector; keys restricted app-side to the closed
  -- vocabulary (AFFECT_EMOTIONS). Never {} — parse returns null instead,
  -- and null classifications are simply not recorded.
  emotions JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('lexical', 'prosodic', 'fused')),
  -- Detected language of the classified turn (e.g. 'hi-latn'), when
  -- known. Lets reports split emotion trends by language cohort.
  language TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The two read paths: a conversation's emotional arc over time, and
-- account-wide reporting windows.
CREATE INDEX IF NOT EXISTS idx_affective_events_conversation
  ON conversation_affective_events (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_affective_events_account_time
  ON conversation_affective_events (account_id, created_at DESC);

ALTER TABLE conversation_affective_events ENABLE ROW LEVEL SECURITY;

-- Same membership model as ai_knowledge (migrations 030/032): account
-- members may read, via the canonical `is_account_member()` helper —
-- this schema has no `account_members` table; membership lives in
-- `profiles` + `workspace_profiles` behind that function. Writes come
-- only from the service role (auto-reply pipeline), which bypasses
-- RLS, so no INSERT/UPDATE/DELETE policies exist — the table is
-- append-only for every authenticated user by construction.
CREATE POLICY "affective_events_select" ON conversation_affective_events
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

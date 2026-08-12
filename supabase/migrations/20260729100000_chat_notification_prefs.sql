-- ============================================================
-- 20260729100000_chat_notification_prefs.sql
--
-- Per-user notification preferences for team chat: a global popup
-- switch plus per-conversation mute, mirroring Teams/Slack.
--
-- Design
--
--   Mute is stored as `muted_until TIMESTAMPTZ` rather than a boolean.
--   One nullable column then expresses every case the UI needs:
--
--     NULL              -> not muted
--     now() + 1 hour    -> "mute for 1 hour" (expires by itself)
--     far future        -> muted indefinitely
--
--   A boolean would have needed a second column to support timed mutes,
--   and timed mutes would then need a sweeper job to flip it back. With a
--   timestamp, expiry is just a comparison at read time — no background
--   job, and no window where a mute outlives its intended duration.
--
--   Muting suppresses the POPUP ONLY. Unread badges still increment, so a
--   muted conversation can never silently swallow a message.
--
-- Visibility
--
--   Both tables are strictly private to their owner: every policy is
--   `user_id = auth.uid()`. Notification preferences are personal, so
--   unlike presence there is no account-wide read.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- global (per-user) preferences -------------------------
CREATE TABLE IF NOT EXISTS member_chat_prefs (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Master switch for message toasts. Unread badges are unaffected.
  popups_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Workspace-wide quiet period ("pause notifications"). See note above.
  muted_until    TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE member_chat_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_chat_prefs_rw ON member_chat_prefs;
CREATE POLICY member_chat_prefs_rw ON member_chat_prefs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- per-conversation mute ---------------------------------
CREATE TABLE IF NOT EXISTS team_conversation_prefs (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL
                    REFERENCES team_conversations(id) ON DELETE CASCADE,
  muted_until     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id)
);

-- The client loads "all of my muted conversations" in one shot on boot;
-- the PK is (user_id, conversation_id) so a user_id-leading lookup is
-- already covered by it. No extra index needed.

ALTER TABLE team_conversation_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_conversation_prefs_rw ON team_conversation_prefs;
CREATE POLICY team_conversation_prefs_rw ON team_conversation_prefs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- TEAM CHAT (internal workspace messaging, Slack/Atlassian-style)
-- ----------------------------------------------------------------------------
-- Adds 1:1 direct messages and team channels between workspace members.
-- Builds on existing infrastructure:
--   * accounts + profiles.account_id/account_role  (shared workspace + roles)
--   * is_account_member(account_id, min_role)      (RLS helper, migration 017)
--   * member_presence                              (online status, migration 024)
--
-- Tables:
--   1. team_conversations        - a DM or a channel (same row shape)
--   2. team_conversation_members - who participates in each conversation
--   3. team_messages             - append-only message log
--   4. team_read_cursors         - per-user read position (unread badges)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. team_conversations
--    kind = 'dm'      -> exactly two members, no name, dm_key dedupes the pair
--    kind = 'channel' -> named room, any number of members
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('dm', 'channel')),
  name TEXT CHECK (kind <> 'channel' OR (name IS NOT NULL AND length(trim(name)) > 0)),
  -- Sorted "userA:userB" pair for DMs so the same two people always share one DM.
  dm_key TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  last_message_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_conversations_dm_key
  ON team_conversations(account_id, dm_key)
  WHERE dm_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_conversations_account
  ON team_conversations(account_id, last_message_at DESC NULLS LAST);

-- ----------------------------------------------------------------------------
-- 2. team_conversation_members
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_conversation_members (
  conversation_id UUID NOT NULL REFERENCES team_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_conversation_members_user
  ON team_conversation_members(user_id);

-- ----------------------------------------------------------------------------
-- 3. team_messages (append-only; parent_id reserved for future threads)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES team_conversations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  parent_id UUID REFERENCES team_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_messages_conversation
  ON team_messages(conversation_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. team_read_cursors (one row per user per conversation -> unread badge =
--    messages newer than last_read_at; scales without per-message receipts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_read_cursors (
  conversation_id UUID NOT NULL REFERENCES team_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Membership helper (SECURITY DEFINER avoids recursive RLS when the members
-- table policy needs to consult itself).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_team_conversation_member(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM team_conversation_members m
    WHERE m.conversation_id = p_conversation_id
      AND m.user_id = auth.uid()
  );
$$;

ALTER FUNCTION is_team_conversation_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION is_team_conversation_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_team_conversation_member(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE team_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_read_cursors ENABLE ROW LEVEL SECURITY;

-- Conversations: participants can read; any workspace member (agent+) can
-- create DMs; admins+ can create channels; creator or admin can update/delete.
DROP POLICY IF EXISTS team_conversations_select ON team_conversations;
CREATE POLICY team_conversations_select ON team_conversations
  FOR SELECT USING (is_team_conversation_member(id));

DROP POLICY IF EXISTS team_conversations_insert ON team_conversations;
CREATE POLICY team_conversations_insert ON team_conversations
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND CASE kind
      WHEN 'channel' THEN is_account_member(account_id, 'admin')
      ELSE is_account_member(account_id, 'agent')
    END
  );

DROP POLICY IF EXISTS team_conversations_update ON team_conversations;
CREATE POLICY team_conversations_update ON team_conversations
  FOR UPDATE USING (
    is_team_conversation_member(id)
    AND (created_by = auth.uid() OR is_account_member(account_id, 'admin'))
  );

DROP POLICY IF EXISTS team_conversations_delete ON team_conversations;
CREATE POLICY team_conversations_delete ON team_conversations
  FOR DELETE USING (
    created_by = auth.uid() OR is_account_member(account_id, 'admin')
  );

-- Members: participants see the roster; conversation creator (or admin)
-- manages membership; users may always remove themselves (leave).
DROP POLICY IF EXISTS team_conversation_members_select ON team_conversation_members;
CREATE POLICY team_conversation_members_select ON team_conversation_members
  FOR SELECT USING (is_team_conversation_member(conversation_id));

DROP POLICY IF EXISTS team_conversation_members_insert ON team_conversation_members;
CREATE POLICY team_conversation_members_insert ON team_conversation_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_conversations c
      WHERE c.id = conversation_id
        AND (c.created_by = auth.uid() OR is_account_member(c.account_id, 'admin'))
        -- every added member must belong to the same workspace
        AND EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.user_id = team_conversation_members.user_id
            AND p.account_id = c.account_id
        )
    )
  );

DROP POLICY IF EXISTS team_conversation_members_delete ON team_conversation_members;
CREATE POLICY team_conversation_members_delete ON team_conversation_members
  FOR DELETE USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM team_conversations c
      WHERE c.id = conversation_id
        AND (c.created_by = auth.uid() OR is_account_member(c.account_id, 'admin'))
    )
  );

-- Messages: participants read; participants post as themselves.
DROP POLICY IF EXISTS team_messages_select ON team_messages;
CREATE POLICY team_messages_select ON team_messages
  FOR SELECT USING (is_team_conversation_member(conversation_id));

DROP POLICY IF EXISTS team_messages_insert ON team_messages;
CREATE POLICY team_messages_insert ON team_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND is_team_conversation_member(conversation_id)
    AND is_account_member(account_id, 'agent')
  );

-- Read cursors: strictly personal.
DROP POLICY IF EXISTS team_read_cursors_select ON team_read_cursors;
CREATE POLICY team_read_cursors_select ON team_read_cursors
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS team_read_cursors_upsert ON team_read_cursors;
CREATE POLICY team_read_cursors_upsert ON team_read_cursors
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND is_team_conversation_member(conversation_id)
  );

DROP POLICY IF EXISTS team_read_cursors_update ON team_read_cursors;
CREATE POLICY team_read_cursors_update ON team_read_cursors
  FOR UPDATE USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Denormalize the latest message onto the conversation for the chat list.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION team_messages_touch_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE team_conversations
  SET last_message_at = NEW.created_at,
      last_message_text = left(NEW.body, 140),
      updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_messages_touch ON team_messages;
CREATE TRIGGER trg_team_messages_touch
  AFTER INSERT ON team_messages
  FOR EACH ROW EXECUTE FUNCTION team_messages_touch_conversation();

-- ----------------------------------------------------------------------------
-- Realtime: broadcast new messages + conversation updates to participants.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'team_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = 'team_conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE team_conversations;
    END IF;
  END IF;
END $$;

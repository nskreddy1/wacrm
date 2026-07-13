-- 039_omnichannel_conversation_uniqueness.sql
-- A contact may have one thread per connected provider. Preserve the legacy
-- one-thread rule for rows that are not yet attached to a channel connection.

DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_legacy_account_contact
  ON conversations(account_id, contact_id)
  WHERE channel_connection_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_connection_contact_thread
  ON conversations(channel_connection_id, contact_id, external_thread_id)
  WHERE channel_connection_id IS NOT NULL AND external_thread_id IS NOT NULL;

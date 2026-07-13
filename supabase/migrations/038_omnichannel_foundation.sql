-- 038_omnichannel_foundation.sql
-- Provider-neutral V1 foundation for Meta, Twilio, Gmail, and Resend.

DO $$ BEGIN
  CREATE TYPE channel_kind AS ENUM ('whatsapp', 'email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE channel_provider AS ENUM ('meta', 'twilio', 'google', 'resend');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE channel_connection_status AS ENUM ('draft', 'connected', 'degraded', 'disconnected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS channel_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  channel channel_kind NOT NULL,
  provider channel_provider NOT NULL,
  display_name TEXT NOT NULL,
  external_account_id TEXT,
  external_identity TEXT,
  credentials_encrypted TEXT,
  webhook_secret_encrypted TEXT,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_cursor TEXT,
  sync_expires_at TIMESTAMPTZ,
  status channel_connection_status NOT NULL DEFAULT 'draft',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  last_connected_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_provider_pair CHECK (
    (channel = 'whatsapp' AND provider IN ('meta', 'twilio')) OR
    (channel = 'email' AND provider IN ('google', 'resend'))
  ),
  CONSTRAINT channel_enabled_connected CHECK (NOT is_enabled OR status IN ('connected', 'degraded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_connections_external
  ON channel_connections(account_id, provider, external_identity)
  WHERE external_identity IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_connections_primary
  ON channel_connections(account_id, channel)
  WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_channel_connections_account_enabled
  ON channel_connections(account_id, channel, is_enabled);
ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_connections_select ON channel_connections;
DROP POLICY IF EXISTS channel_connections_insert ON channel_connections;
DROP POLICY IF EXISTS channel_connections_update ON channel_connections;
DROP POLICY IF EXISTS channel_connections_delete ON channel_connections;
CREATE POLICY channel_connections_select ON channel_connections FOR SELECT USING (is_account_member(account_id));
CREATE POLICY channel_connections_insert ON channel_connections FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY channel_connections_update ON channel_connections FOR UPDATE USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY channel_connections_delete ON channel_connections FOR DELETE USING (is_account_member(account_id, 'admin'));
-- RLS filters rows, not columns. Remove the table-level SELECT grant and
-- explicitly expose only non-secret connection metadata to browser clients.
REVOKE SELECT ON channel_connections FROM anon, authenticated;
GRANT SELECT (
  id, account_id, created_by_user_id, channel, provider, display_name,
  external_account_id, external_identity, configuration, sync_expires_at,
  status, is_enabled, is_primary, last_connected_at, last_synced_at,
  last_error, created_at, updated_at
) ON channel_connections TO authenticated;
DROP TRIGGER IF EXISTS set_updated_at ON channel_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channel_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS contact_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel channel_kind NOT NULL,
  identity TEXT NOT NULL,
  normalized_identity TEXT NOT NULL,
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, channel, normalized_identity)
);
CREATE INDEX IF NOT EXISTS idx_contact_identities_contact ON contact_identities(contact_id);
ALTER TABLE contact_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_identities_select ON contact_identities;
DROP POLICY IF EXISTS contact_identities_insert ON contact_identities;
DROP POLICY IF EXISTS contact_identities_update ON contact_identities;
DROP POLICY IF EXISTS contact_identities_delete ON contact_identities;
CREATE POLICY contact_identities_select ON contact_identities FOR SELECT USING (is_account_member(account_id));
CREATE POLICY contact_identities_insert ON contact_identities FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_identities_update ON contact_identities FOR UPDATE USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_identities_delete ON contact_identities FOR DELETE USING (is_account_member(account_id, 'agent'));

-- The original contacts table already has `email`; make phone optional so
-- email-only customers are first-class while requiring at least one identity.
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_or_email_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_phone_or_email_check
  CHECK (NULLIF(BTRIM(phone), '') IS NOT NULL OR NULLIF(BTRIM(email), '') IS NOT NULL);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel channel_kind NOT NULL DEFAULT 'whatsapp';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel_connection_id UUID REFERENCES channel_connections(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS external_thread_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_external_thread
  ON conversations(channel_connection_id, external_thread_id)
  WHERE channel_connection_id IS NOT NULL AND external_thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_account_channel
  ON conversations(account_id, channel, last_message_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel_connection_id UUID REFERENCES channel_connections(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_message_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_thread_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_html TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_connection_external
  ON messages(channel_connection_id, external_message_id)
  WHERE channel_connection_id IS NOT NULL AND external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channel_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES channel_connections(id) ON DELETE CASCADE,
  provider channel_provider NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'ignored')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_webhook_events_pending
  ON channel_webhook_events(provider, status, received_at)
  WHERE status IN ('pending', 'failed');
ALTER TABLE channel_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_webhook_events_select ON channel_webhook_events;
CREATE POLICY channel_webhook_events_select ON channel_webhook_events FOR SELECT
  USING (account_id IS NOT NULL AND is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS oauth_connection_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider channel_provider NOT NULL CHECK (provider = 'google'),
  state_hash TEXT NOT NULL UNIQUE,
  code_verifier_encrypted TEXT,
  redirect_path TEXT NOT NULL DEFAULT '/settings',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE oauth_connection_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS oauth_states_select ON oauth_connection_states;
DROP POLICY IF EXISTS oauth_states_insert ON oauth_connection_states;
CREATE POLICY oauth_states_select ON oauth_connection_states FOR SELECT USING (auth.uid() = user_id AND is_account_member(account_id, 'admin'));
CREATE POLICY oauth_states_insert ON oauth_connection_states FOR INSERT WITH CHECK (auth.uid() = user_id AND is_account_member(account_id, 'admin'));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'conversation_assigned', 'conversation_mentioned', 'customer_replied',
  'provider_degraded', 'provider_disconnected', 'campaign_completed', 'sync_failed'
));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'not_requested'
  CHECK (email_status IN ('not_requested', 'pending', 'sent', 'failed', 'skipped'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS notification_preferences (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  event_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(account_id, user_id)
);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_preferences_select ON notification_preferences;
DROP POLICY IF EXISTS notification_preferences_insert ON notification_preferences;
DROP POLICY IF EXISTS notification_preferences_update ON notification_preferences;
CREATE POLICY notification_preferences_select ON notification_preferences FOR SELECT USING (auth.uid() = user_id AND is_account_member(account_id));
CREATE POLICY notification_preferences_insert ON notification_preferences FOR INSERT WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));
CREATE POLICY notification_preferences_update ON notification_preferences FOR UPDATE USING (auth.uid() = user_id AND is_account_member(account_id)) WITH CHECK (auth.uid() = user_id AND is_account_member(account_id));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'channel_connections') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE channel_connections;
  END IF;
END $$;

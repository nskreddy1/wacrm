-- ============================================================
-- 057_channel_configurations.sql — Encrypted channel credentials
--
-- Super-admin managed provider credentials (Twilio, WhatsApp
-- Business API, email/SMS providers) per account & channel.
--
-- Security model:
--   - `encrypted_credentials` is pgcrypto `pgp_sym_encrypt` output.
--     The symmetric key lives ONLY in the server environment
--     (CHANNEL_CREDENTIALS_KEY) and is passed per-statement by the
--     service-role API route. The key never touches the database
--     catalog, client bundles, or logs.
--   - No SELECT policy exposes the ciphertext to regular members:
--     members see only `masked_preview` + `is_active` through a
--     dedicated view. Even super admins read decrypted values only
--     transiently server-side for "test connection".
--   - All writes flow through /api/admin/* (service role + audit).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS channel_configurations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel               TEXT NOT NULL
                        CHECK (channel IN ('whatsapp','sms','email','voice')),
  -- Provider key, e.g. 'twilio', 'meta_cloud_api', 'resend'.
  provider              TEXT NOT NULL,
  -- pgp_sym_encrypt(credentials_json, key) — bytea ciphertext.
  encrypted_credentials BYTEA,
  -- Human-safe hint like 'AC••••••••4f2a' — never secret material.
  masked_preview        TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at           TIMESTAMPTZ,
  configured_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_configurations_account
  ON channel_configurations(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON channel_configurations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON channel_configurations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE channel_configurations ENABLE ROW LEVEL SECURITY;

-- Super admins manage rows (ciphertext included) via PostgREST;
-- regular members have NO direct access to this table at all.
DROP POLICY IF EXISTS "Super admins manage channel configurations" ON channel_configurations;
CREATE POLICY "Super admins manage channel configurations" ON channel_configurations
  FOR ALL USING (is_platform_super_admin())
  WITH CHECK (is_platform_super_admin());

-- Members get a safe projection (no ciphertext column) of their
-- own account's channels, e.g. to show "WhatsApp: configured".
CREATE OR REPLACE VIEW account_channel_status
WITH (security_invoker = false) AS
SELECT
  cc.account_id,
  cc.channel,
  cc.provider,
  cc.masked_preview,
  cc.is_active,
  cc.verified_at
FROM channel_configurations cc
WHERE is_account_member(cc.account_id, 'viewer')
   OR is_platform_super_admin();

GRANT SELECT ON account_channel_status TO authenticated;

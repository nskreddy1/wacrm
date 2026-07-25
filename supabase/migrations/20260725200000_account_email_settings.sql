-- ============================================================
-- Per-workspace email delivery settings (generic provider layer).
--
-- One row per account. The provider column selects the adapter:
--   * 'smtp'   — any SMTP server (Gmail, Zoho, Outlook, cPanel...)
--   * 'resend' — Resend REST API
--   * 'msg91'  — MSG91 transactional email API (low-cost, India)
-- More providers plug in by adding an adapter in
-- src/lib/email/mailer.ts — no schema change needed, since
-- credentials are stored as an encrypted JSON blob.
--
-- Security properties:
--   * credentials_encrypted holds an AES-256-GCM-encrypted JSON
--     string (same scheme as channel tokens). Never returned to
--     clients — the GET API masks it.
--   * RLS: admin+ only, both read and write. Regular agents never
--     see delivery config.
-- ============================================================

CREATE TABLE IF NOT EXISTS account_email_settings (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('smtp', 'resend', 'msg91')),
  from_email text NOT NULL,
  from_name text,
  -- AES-256-GCM encrypted JSON. Shape depends on provider:
  --   smtp:   { host, port, secure, username, password }
  --   resend: { apiKey }
  --   msg91:  { authKey, domain }
  credentials_encrypted text NOT NULL,
  -- Set by the test-send endpoint so the UI can show delivery health.
  last_test_at timestamptz,
  last_test_ok boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE account_email_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_email_settings_select ON account_email_settings;
CREATE POLICY account_email_settings_select ON account_email_settings
  FOR SELECT USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_email_settings_insert ON account_email_settings;
CREATE POLICY account_email_settings_insert ON account_email_settings
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_email_settings_update ON account_email_settings;
CREATE POLICY account_email_settings_update ON account_email_settings
  FOR UPDATE USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS account_email_settings_delete ON account_email_settings;
CREATE POLICY account_email_settings_delete ON account_email_settings
  FOR DELETE USING (is_account_member(account_id, 'admin'));

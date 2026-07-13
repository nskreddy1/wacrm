-- Add independently selectable SMTP and Microsoft email providers.
ALTER TYPE channel_provider ADD VALUE IF NOT EXISTS 'smtp';
ALTER TYPE channel_provider ADD VALUE IF NOT EXISTS 'microsoft';

ALTER TABLE channel_connections DROP CONSTRAINT IF EXISTS channel_provider_pair;
ALTER TABLE channel_connections ADD CONSTRAINT channel_provider_pair CHECK (
  (channel = 'whatsapp' AND provider IN ('meta', 'twilio')) OR
  (channel = 'email' AND provider IN ('google', 'microsoft', 'resend', 'smtp'))
);

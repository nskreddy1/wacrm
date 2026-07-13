-- Apply provider/channel validation only after migration 040's enum values
-- have committed. Keeping this in a separate transaction avoids PostgreSQL
-- SQLSTATE 55P04 (unsafe use of new enum value).
ALTER TABLE channel_connections
  DROP CONSTRAINT IF EXISTS channel_provider_pair;

ALTER TABLE channel_connections
  ADD CONSTRAINT channel_provider_pair CHECK (
    (channel = 'whatsapp' AND provider IN ('meta', 'twilio')) OR
    (channel = 'email' AND provider IN ('google', 'microsoft', 'resend', 'smtp'))
  );

-- ============================================================
-- 048: SMS as a first-class channel.
--
-- 1. Adds 'sms' to the channel_kind enum (conversations,
--    channel_connections, and messages all key off this type).
-- 2. Widens the channel/provider compatibility constraint so a
--    Twilio connection can power SMS alongside WhatsApp.
--
-- Additive only — existing rows are untouched.
-- ============================================================

ALTER TYPE channel_kind ADD VALUE IF NOT EXISTS 'sms';

-- Note: the constraint swap runs in a separate transaction from the
-- enum change (Postgres requires enum values to be committed before
-- use in constraints). Supabase runs each migration atomically, so
-- this file is safe as-is when applied after the enum commit above.
ALTER TABLE channel_connections
  DROP CONSTRAINT IF EXISTS channel_provider_compatible;
ALTER TABLE channel_connections
  ADD CONSTRAINT channel_provider_compatible CHECK (
    (channel = 'whatsapp' AND provider IN ('meta', 'twilio')) OR
    (channel = 'email' AND provider IN ('google', 'resend')) OR
    (channel = 'sms' AND provider = 'twilio')
  );

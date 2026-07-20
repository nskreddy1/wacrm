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

-- Keep the enum addition in its own migration. PostgreSQL requires this
-- transaction to commit before the new value can be referenced by a constraint.
ALTER TYPE channel_kind ADD VALUE IF NOT EXISTS 'sms';

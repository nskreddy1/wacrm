-- ============================================================
-- 049: Multi-channel broadcasts
--
-- Broadcasts can now target either WhatsApp (Meta / Twilio) or
-- SMS (Twilio). Existing rows predate SMS support and default
-- to 'whatsapp'.
-- ============================================================

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';

ALTER TABLE public.broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_channel_check;
ALTER TABLE public.broadcasts
  ADD CONSTRAINT broadcasts_channel_check
  CHECK (channel IN ('whatsapp', 'sms'));

CREATE INDEX IF NOT EXISTS broadcasts_channel_idx
  ON public.broadcasts (account_id, channel, created_at DESC);

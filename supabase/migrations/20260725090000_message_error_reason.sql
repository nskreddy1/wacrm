-- ============================================================
-- Message delivery error reason
--
-- Delivery failures reported by provider status callbacks
-- (Twilio StatusCallback, Meta statuses) previously only flipped
-- messages.status to 'failed' with no explanation. Store the
-- provider's reason so the inbox can show WHY an outbound message
-- never reached the customer (e.g. Twilio 63016 free-form outside
-- the 24h window, 21608 unverified number on trial).
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_message TEXT;

COMMENT ON COLUMN messages.error_message IS
  'Provider-reported delivery failure reason (set when status = failed).';

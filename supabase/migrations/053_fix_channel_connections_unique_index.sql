-- Fix: the unique index on (account_id, provider, external_identity)
-- ignored the channel, so one Twilio number couldn't be connected to
-- both WhatsApp and SMS — a fully supported Twilio setup (the same
-- number can serve both channels simultaneously). Recreate the index
-- with channel included so uniqueness is enforced per channel.
DROP INDEX IF EXISTS public.idx_channel_connections_external;
CREATE UNIQUE INDEX idx_channel_connections_external
  ON public.channel_connections (account_id, channel, provider, external_identity);

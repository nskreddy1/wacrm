-- Fix: SMS connections could never be saved.
-- The pre-SMS `channel_provider_pair` CHECK (whatsapp/email only) was
-- never dropped when the SMS channel was added, so any sms row
-- violated it (500 on save). Also align `channel_provider_compatible`
-- with the app's provider registry (smtp/microsoft email providers).
ALTER TABLE public.channel_connections
  DROP CONSTRAINT IF EXISTS channel_provider_pair;
ALTER TABLE public.channel_connections
  DROP CONSTRAINT IF EXISTS channel_provider_compatible;
ALTER TABLE public.channel_connections
  ADD CONSTRAINT channel_provider_compatible CHECK (
    (channel = 'whatsapp'::channel_kind AND provider = ANY (ARRAY['meta'::channel_provider, 'twilio'::channel_provider]))
    OR (channel = 'email'::channel_kind AND provider = ANY (ARRAY['google'::channel_provider, 'microsoft'::channel_provider, 'resend'::channel_provider, 'smtp'::channel_provider]))
    OR (channel = 'sms'::channel_kind AND provider = 'twilio'::channel_provider)
  );

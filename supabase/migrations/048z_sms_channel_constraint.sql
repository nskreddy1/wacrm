-- Apply after 048_sms_channel.sql has committed the new enum value.
ALTER TABLE public.channel_connections
  DROP CONSTRAINT IF EXISTS channel_provider_compatible;

ALTER TABLE public.channel_connections
  ADD CONSTRAINT channel_provider_compatible CHECK (
    (channel = 'whatsapp'::channel_kind AND provider IN ('meta'::channel_provider, 'twilio'::channel_provider)) OR
    (channel = 'email'::channel_kind AND provider IN ('google'::channel_provider, 'resend'::channel_provider)) OR
    (channel = 'sms'::channel_kind AND provider = 'twilio'::channel_provider)
  );

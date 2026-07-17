-- Provider-aware WhatsApp template catalog.
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta',
  ADD COLUMN IF NOT EXISTS twilio_content_sid text;

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_provider_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_provider_check
  CHECK (provider IN ('meta', 'twilio'));

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_provider_identifier_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_provider_identifier_check CHECK (
    (provider = 'meta' AND twilio_content_sid IS NULL)
    OR (provider = 'twilio' AND meta_template_id IS NULL)
  );

DROP INDEX IF EXISTS message_templates_user_id_name_language_key;
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_account_provider_name_language_key
  ON public.message_templates (account_id, provider, name, language);
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_twilio_content_sid_key
  ON public.message_templates (account_id, twilio_content_sid)
  WHERE twilio_content_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_templates_provider_status_idx
  ON public.message_templates (account_id, provider, status);

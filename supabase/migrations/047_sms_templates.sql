-- ============================================================
-- 047: Multi-channel template catalog — SMS alongside WhatsApp.
--
-- The Template Studio composes templates for BOTH channels:
--   * whatsapp — provider 'meta' (Cloud API) or 'twilio' (Content API),
--     approval lifecycle enforced by the provider.
--   * sms — provider 'twilio' (Programmable Messaging) or 'none'
--     (stored draft only). SMS has no provider approval step, but
--     marketing SMS must carry opt-out language (enforced in the API
--     layer; recorded here for auditability).
-- ============================================================

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp',
  -- Compliance audit trail written by the API layer on every save:
  -- { "optOutLanguage": bool, "segments": n, "encoding": "GSM-7"|"UCS-2", "checkedAt": iso }
  ADD COLUMN IF NOT EXISTS compliance jsonb;

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_channel_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_channel_check
  CHECK (channel IN ('whatsapp', 'sms'));

-- Provider set now includes 'none' for stored SMS drafts that are
-- sent through whatever messaging channel is connected at send time.
ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_provider_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_provider_check
  CHECK (provider IN ('meta', 'twilio', 'none'));

-- Identifier coherence per channel:
--   whatsapp+meta   -> meta_template_id only
--   whatsapp+twilio -> twilio_content_sid only
--   sms             -> neither provider id is required; twilio SMS
--                      content sids are allowed when registered.
ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_provider_identifier_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_provider_identifier_check CHECK (
    (channel = 'whatsapp' AND provider = 'meta' AND twilio_content_sid IS NULL)
    OR (channel = 'whatsapp' AND provider = 'twilio' AND meta_template_id IS NULL)
    OR (channel = 'sms' AND meta_template_id IS NULL)
  );

-- SMS categories mirror the studio: marketing | transactional | otp.
-- WhatsApp rows keep Meta's Marketing/Utility/Authentication set.
ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_category_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_category_check CHECK (
    (channel = 'whatsapp' AND category IN ('Marketing', 'Utility', 'Authentication'))
    OR (channel = 'sms' AND category IN ('marketing', 'transactional', 'otp'))
  );

-- List screens filter by channel first.
CREATE INDEX IF NOT EXISTS message_templates_channel_idx
  ON public.message_templates (account_id, channel, status);

-- ============================================================
-- Email template categories + constraint repair.
--
-- 20260725210000 allowed channel = 'email' but two older CHECKs
-- still rejected every email row:
--   * message_templates_category_check (047) had no email arm
--   * message_templates_provider_identifier_check (047) had no
--     email arm, and a CHECK with no matching arm fails the row
--
-- Email gets its own category set (distinct from WhatsApp's
-- Meta-mandated three and SMS's carrier-oriented three):
--   newsletter | promotional | transactional | onboarding | otp
--
-- Compliance mapping (enforced in the API, not the DB):
--   newsletter/promotional -> marketing rules (unsubscribe
--   required per CAN-SPAM / India DPDP consent norms)
--   transactional/onboarding -> transactional rules
--   otp -> otp rules (no marketing content)
-- ============================================================

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_category_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_category_check CHECK (
    (channel = 'whatsapp' AND category IN ('Marketing', 'Utility', 'Authentication'))
    OR (channel = 'sms' AND category IN ('marketing', 'transactional', 'otp'))
    OR (channel = 'email' AND category IN ('newsletter', 'promotional', 'transactional', 'onboarding', 'otp'))
  );

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_provider_identifier_check;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_provider_identifier_check CHECK (
    (channel = 'whatsapp' AND provider = 'meta' AND twilio_content_sid IS NULL)
    OR (channel = 'whatsapp' AND provider = 'twilio' AND meta_template_id IS NULL)
    OR (channel = 'sms' AND meta_template_id IS NULL)
    OR (channel = 'email' AND meta_template_id IS NULL AND twilio_content_sid IS NULL)
  );

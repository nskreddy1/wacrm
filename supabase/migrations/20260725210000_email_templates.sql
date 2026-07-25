-- ============================================================
-- Email templates in the Template Studio.
--
-- Extends message_templates to a third channel: 'email'.
--   * channel CHECK now allows 'whatsapp' | 'sms' | 'email'
--   * subject_text — the email subject line (email rows only;
--     WhatsApp/SMS leave it NULL). Body reuses body_text.
--
-- Emails need no carrier review (like SMS), so a compliant save
-- is immediately APPROVED/live. RLS is already enforced on
-- message_templates by earlier migrations (017) — no policy
-- changes are needed for a new channel value.
-- ============================================================

ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_channel_check;

ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_channel_check
  CHECK (channel IN ('whatsapp', 'sms', 'email'));

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS subject_text text
  CHECK (subject_text IS NULL OR char_length(subject_text) <= 300);

COMMENT ON COLUMN public.message_templates.subject_text IS
  'Email subject line. NULL for whatsapp/sms rows.';

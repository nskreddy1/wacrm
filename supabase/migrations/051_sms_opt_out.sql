-- SMS opt-out tracking (Twilio compliance).
-- Twilio auto-blocks sends to numbers that texted STOP (error 21610);
-- we mirror that state so broadcasts skip opted-out contacts up front
-- instead of burning failed sends and hurting sender reputation.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS sms_opted_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS sms_opted_out_at timestamptz;

CREATE INDEX IF NOT EXISTS contacts_sms_opted_out_idx
  ON public.contacts (account_id, sms_opted_out)
  WHERE sms_opted_out = true;

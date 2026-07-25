-- ============================================================
-- Email opt-out tracking on contacts.
--
-- Compliance: CAN-SPAM (US), CASL (Canada), GDPR/ePrivacy (EU),
-- and India DPDP all require honoring unsubscribe requests for
-- marketing email. Mirrors the existing sms_opted_out pattern so
-- the email broadcast fan-out can skip unsubscribed contacts
-- before wasting a send.
-- ============================================================

alter table public.contacts
  add column if not exists email_opted_out boolean not null default false;

alter table public.contacts
  add column if not exists email_opted_out_at timestamptz;

comment on column public.contacts.email_opted_out is
  'True when the contact unsubscribed from marketing email (CAN-SPAM / DPDP compliance). Broadcast sends skip these contacts.';

-- Partial index: the send loop filters on account + opted-out.
create index if not exists idx_contacts_email_opted_out
  on public.contacts (account_id)
  where email_opted_out = true;

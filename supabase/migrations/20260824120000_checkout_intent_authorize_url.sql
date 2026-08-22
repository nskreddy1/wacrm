-- ADR-009 Task 7.6 step 0 — persist the provider's authorize URL on the
-- intent so a RESUMED checkout can return the same provider handle.
--
-- Why this column has to exist:
--
-- The partial unique index `checkout_intents_one_open_per_account`
-- deliberately makes a second concurrent checkout LOSE (attack A7). The
-- loser is then required to "return that provider handle so the user
-- resumes the same journey" — it must not call the provider again, since
-- a second provider call is the exact double-subscription/double-charge
-- outcome the index exists to prevent.
--
-- Without this column the resume path has only `provider_ref`, and the
-- only ways to produce a URL from it are both unacceptable:
--   * string-concatenate the provider's URL shape in our code, which
--     leaks provider internals past the adapter boundary; or
--   * call the provider to re-fetch it, which reintroduces the very
--     round trip we are trying to avoid.
--
-- NOT a secret, and deliberately so: it is a payment link, and the only
-- thing a holder can do with it is PAY US. It is nonetheless server-side
-- and reachable only through the account-scoped SELECT policy already on
-- this table, so it is not broadcast either.
--
-- Nullable by construction: it is written in the same UPDATE that moves
-- the intent to `provider_attached`, so a `created` intent has no URL yet
-- and a NULL here is meaningful state rather than missing data.

alter table public.checkout_intents
  add column if not exists provider_authorize_url text;

comment on column public.checkout_intents.provider_authorize_url is
  'ADR-009 Task 7.6: the provider''s hosted authorize/payment URL, captured in the same UPDATE that sets provider_ref and status=provider_attached. Exists so the A7 race loser can resume the SAME journey without a second provider call. NULL while status=created.';

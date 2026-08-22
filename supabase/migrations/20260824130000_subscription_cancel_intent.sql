-- =====================================================================
-- ADR-009 Task 8.2 — cancellation INTENT, and nothing else.
--
-- WHY A FUNCTION, when the plan says the owner's request path writes
-- these columns "directly"?
--
-- `subscriptions` (20260822140000) enables RLS and declares exactly one
-- policy: `subscriptions_select`. There is no UPDATE policy. A
-- user-context UPDATE therefore matches zero rows and reports success —
-- supabase-js returns no error for an empty match. The cancel button
-- would appear to work and do nothing, forever, and no test that stubs
-- the DB would catch it. "Directly" in the plan means *the request path
-- owns these two columns* (as opposed to `process_payment_event`), not
-- "via a user-context UPDATE".
--
-- The alternatives were service role or a narrow definer function.
-- Service role was rejected: it would hand the request path a key that
-- can equally write `status`, `cancel_at_period_end` and `plan_id` — the
-- precise write the column split in 20260822140000 exists to make
-- impossible ("the defect the column split below exists to prevent").
-- With service role, the only thing standing between a future refactor
-- and a self-granted entitlement is code review. The two functions below
-- CANNOT express that write: their UPDATE column lists are fixed here,
-- in the schema, and reviewed once.
--
-- Owner-ness is enforced INSIDE the function via
-- `is_account_member(..., 'owner')` against `auth.uid()`. These are
-- therefore called with the CALLER's session — never service role, which
-- would make `auth.uid()` NULL and the check vacuous. The route's
-- `requireRole('owner')` is defence in depth, not the authority.
--
-- WHY THE SUBSCRIPTION ID IS NOT A PARAMETER (attack A5): the caller
-- cannot name a subscription. It is resolved from `p_account_id`, which
-- itself is proven to belong to the caller. There is no id to tamper
-- with, so "cancel someone else's subscription" is not a request this
-- API can represent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Open the cancellation request.
--
-- Intent-first, deliberately inverting the literal step order of plan
-- 8.2 (which calls the provider first). Razorpay's documented semantics
-- force this:
--
--   * "Once cancelled, you cannot renew or reactivate it." Cancellation
--     is IRREVERSIBLE — a provider call we fail to record can never be
--     compensated.
--   * Re-cancelling returns 400 "Subscription is not cancellable in
--     cancelled status", NOT 200. The API is not idempotent, so a blind
--     retry after a successful-but-unrecorded call errors out and we
--     cannot tell "already cancelled by us" from a real failure.
--
-- Provider-first + a crash between the call and the write therefore
-- leaves an irreversibly cancelling subscription with zero local trace.
-- Intent-first leaves an honest `requested` row that Task 10
-- reconciliation can settle. The deviation is recorded in the ADR.
-- ---------------------------------------------------------------------
create or replace function public.request_subscription_cancellation(
  p_account_id uuid
)
returns table (
  subscription_id uuid,
  provider text,
  environment text,
  provider_ref text,
  status text,
  current_period_end timestamptz,
  cancel_request_status text,
  cancel_requested_at timestamptz,
  outcome text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
begin
  -- Authorisation, in the database. Not a convenience re-check: this is
  -- the boundary. `auth.uid()` is NULL under service role, so a
  -- service-role caller fails closed here rather than bypassing it.
  if not public.is_account_member(
       p_account_id, 'owner'::public.account_role_enum
     ) then
    raise exception 'not authorised to cancel this subscription'
      using errcode = '42501';
  end if;

  -- Resolve AND lock the account's live subscription. FOR UPDATE
  -- serialises concurrent cancels: Razorpay rejects overlapping
  -- subscription operations with 400 "another subscription operation is
  -- in progress", so two racing requests must not both reach the API.
  -- Terminal rows are excluded — a canceled/expired subscription has
  -- nothing left to cancel.
  select *
    into v_sub
    from public.subscriptions s
   where s.account_id = p_account_id
     and s.status not in ('canceled', 'expired')
   order by s.created_at desc
   limit 1
     for update;

  if v_sub.id is null then
    return query select
      null::uuid, null::text, null::text, null::text, null::text,
      null::timestamptz, null::text, null::timestamptz,
      'no_subscription'::text;
    return;
  end if;

  -- `incomplete` never completed authorisation, so there is no live
  -- mandate at the provider to cancel. Abandon it via the intent sweep
  -- (Task 7.8) instead of calling the provider.
  if v_sub.status = 'incomplete' then
    return query select
      v_sub.id, v_sub.provider, v_sub.environment, v_sub.provider_ref,
      v_sub.status, v_sub.current_period_end, v_sub.cancel_request_status,
      v_sub.cancel_requested_at, 'not_cancellable'::text;
    return;
  end if;

  -- Already accepted by the provider: nothing more to ask for. Answer
  -- idempotently and — critically — tell the caller NOT to call the
  -- provider again, which would earn a 400 and log a false failure.
  if v_sub.cancel_request_status = 'provider_accepted' then
    return query select
      v_sub.id, v_sub.provider, v_sub.environment, v_sub.provider_ref,
      v_sub.status, v_sub.current_period_end, v_sub.cancel_request_status,
      v_sub.cancel_requested_at, 'already_accepted'::text;
    return;
  end if;

  -- Open (or re-open) the request. THE ONLY COLUMNS THIS FUNCTION MAY
  -- WRITE. `status`, `cancel_at_period_end` and `plan_id` are absent by
  -- construction, not by discipline — adding them here would be a
  -- schema change and a reviewable diff.
  --
  -- `cancel_requested_at` is preserved on a retry (coalesce) so the
  -- audit trail records when the customer FIRST asked, not when our
  -- last retry happened.
  update public.subscriptions
     set cancel_request_status = 'requested',
         cancel_requested_at = coalesce(cancel_requested_at, now()),
         updated_at = now()
   where id = v_sub.id
  returning * into v_sub;

  return query select
    v_sub.id, v_sub.provider, v_sub.environment, v_sub.provider_ref,
    v_sub.status, v_sub.current_period_end, v_sub.cancel_request_status,
    v_sub.cancel_requested_at, 'opened'::text;
end;
$$;

comment on function public.request_subscription_cancellation(uuid) is
  'ADR-009 Task 8.2: records a subscription cancellation REQUEST (intent) for the caller''s own account and returns the provider handle needed to action it. Owner-only, enforced in-function against auth.uid(); must be called with the caller''s session, never service role. Writes ONLY cancel_request_status/cancel_requested_at — it is structurally incapable of moving status, cancel_at_period_end or plan_id, which only process_payment_event() may write.';

-- ---------------------------------------------------------------------
-- 2. Settle the request once the provider has answered.
--
-- Still intent only. `provider_accepted` means "the provider
-- acknowledged our request", NOT "the subscription is cancelled".
-- Entitlement moves later, when the signed cancellation webhook flows
-- through process_payment_event() (or Task 10 reconciliation observes
-- the cancelled state) — exactly like every other entitlement change.
-- ---------------------------------------------------------------------
create or replace function public.settle_subscription_cancel_request(
  p_account_id uuid,
  p_subscription_id uuid,
  p_outcome text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
begin
  if not public.is_account_member(
       p_account_id, 'owner'::public.account_role_enum
     ) then
    raise exception 'not authorised to cancel this subscription'
      using errcode = '42501';
  end if;

  -- Closed vocabulary. A typo'd outcome must not silently become a NULL
  -- that reads as "never requested".
  if p_outcome not in ('provider_accepted', 'failed') then
    raise exception 'invalid cancel request outcome: %', p_outcome
      using errcode = '22023';
  end if;

  -- Re-derive the row from the ACCOUNT as well as the id, so a
  -- mismatched pair can never settle another tenant's subscription even
  -- though the id came from our own previous call.
  select cancel_request_status
    into v_current
    from public.subscriptions
   where id = p_subscription_id
     and account_id = p_account_id
     for update;

  if v_current is null then
    -- Either no such row for this account, or no request was ever
    -- opened. Nothing to settle; do not invent one.
    return 'not_requested';
  end if;

  -- Only an open request may be settled. Guards against a late/duplicate
  -- settle overwriting an already-accepted request back to `failed`.
  if v_current <> 'requested' then
    return v_current;
  end if;

  update public.subscriptions
     set cancel_request_status = p_outcome,
         updated_at = now()
   where id = p_subscription_id
     and account_id = p_account_id;

  return p_outcome;
end;
$$;

comment on function public.settle_subscription_cancel_request(uuid, uuid, text) is
  'ADR-009 Task 8.2: settles an open cancellation request to provider_accepted or failed. Owner-only, enforced in-function. Writes ONLY cancel_request_status. provider_accepted means the provider acknowledged the request, NOT that entitlement has changed — that remains process_payment_event()''s exclusive right.';

-- ---------------------------------------------------------------------
-- Grants. SECURITY DEFINER functions in `public` are EXECUTE-able by
-- PUBLIC by default, so `anon` would inherit them. These are
-- caller-session functions by design (see the header), so
-- `authenticated` keeps EXECUTE and `anon` is revoked — the in-function
-- is_account_member check is what actually constrains an authenticated
-- caller to their own account.
--
-- service_role is deliberately NOT granted: under service role
-- `auth.uid()` is NULL, the owner check fails closed, and any caller
-- reaching for it has misunderstood the trust boundary.
-- ---------------------------------------------------------------------
revoke execute on function public.request_subscription_cancellation(uuid)
  from public, anon;
grant execute on function public.request_subscription_cancellation(uuid)
  to authenticated;

revoke execute on function public.settle_subscription_cancel_request(uuid, uuid, text)
  from public, anon;
grant execute on function public.settle_subscription_cancel_request(uuid, uuid, text)
  to authenticated;

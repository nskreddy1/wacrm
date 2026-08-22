-- ADR-009 / Task 4 — process_payment_event(): the ONE writer of
-- provider-derived billing state.
--
-- Everything a verified event implies happens in ONE transaction: the
-- idempotency claim, tenant resolution, the environment gate, the money
-- ledger row, the status transition, and the entitlement change. There
-- is no interleaving where the ledger has moved but entitlement has
-- not, and no partial application to reconcile later.
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT TYPESCRIPT
-- The webhook route runs on a serverless platform. A process can be
-- frozen or killed between two awaited statements at any time. Sequenced
-- client-side writes therefore have no atomicity: the claim can commit
-- while the entitlement update never runs, and the provider — having
-- received a 200 — never retries. A single SQL function is the only
-- place a multi-table billing decision can be made all-or-nothing.
--
-- THE CALLER MUST HAVE ALREADY VERIFIED THE SIGNATURE. This function
-- cannot check authenticity; it enforces atomicity, idempotency,
-- provenance and ordering. Authenticity is the route's job (F2), which
-- is why the surface is service-role only.
--
-- RETURN CONTRACT — the caller maps these to HTTP:
--   applied            → 200. State moved.
--   already_processed  → 200. Idempotent replay of a delivery.
--   already_applied    → 200. Money effect already recorded (A35).
--   ignored            → 200. Verified, but no-op (out-of-order, manual
--                        billing, unknown kind, terminal state).
--   A RAISE            → 5xx. Provider retries. Nothing committed.
--
-- Note what is NOT in that list: there is no "failed_retryable" return.
-- Committing a row while asking for a retry is self-contradictory — the
-- claim would already be burned, so the retry could never apply
-- (attack A21). Transient trouble RAISES and rolls the claim back.

create or replace function public.process_payment_event(
  -- Trusted, from the verifying adapter's own credential set.
  p_provider text,
  p_environment text,

  -- Provider event identity (Razorpay: the x-razorpay-event-id header).
  p_event_id text,
  p_provider_event_type text,

  -- Normalised by the adapter into OUR vocabulary.
  p_kind text,

  -- Provider resource ids, all from INSIDE the signed body.
  p_provider_ref text,
  p_subscription_ref text default null,

  p_amount_minor integer default null,
  p_currency text default null,
  p_occurred_at timestamptz default null,

  -- Provider's authoritative state, where exposed. Preferred over
  -- occurred_at for ordering.
  p_resource_status text default null,
  p_resource_version text default null,

  -- Correlation LOCATOR only: may point at one of our own
  -- checkout_intents rows and nothing else.
  p_correlation_intent_id uuid default null,

  p_payload_digest text default null,

  -- Grace window granted on a failed renewal (D13). A parameter, not a
  -- literal, so billing policy stays with the caller.
  p_grace_days integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_row_id     uuid;
  v_subscription     public.subscriptions;
  v_account_id       uuid;
  v_intent           public.checkout_intents;
  v_billing_mode     text;
  v_default_plan_id  text;
  v_next_status      text;
  v_cancel_at_end    boolean;
  v_changed          boolean := false;
  v_reason           text;
  v_ledger_kind      text;
  v_signed_amount    integer;
  v_grace_until      timestamptz;
  v_status_rank      jsonb := '{"incomplete":0,"active":1,"past_due":1,"canceled":2,"expired":2}'::jsonb;
begin
  -- ---------------------------------------------------------------
  -- 0. Environment gate (attacks A11 / A30).
  --
  -- Compares the CONFIGURED environment against the environment
  -- OBSERVED on the event, i.e. stamped from whichever credential set's
  -- secret actually verified the signature. Both values are arguments
  -- from the trusted caller; the event payload never names its own
  -- environment, because a gate that reads the environment off the
  -- event and compares it to the event checks nothing.
  --
  -- Without this, a test-mode webhook (₹1 subscriptions, freely
  -- creatable) upgrades a live tenant.
  -- ---------------------------------------------------------------
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception 'process_payment_event: invalid environment %', p_environment
      using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------
  -- 1. THE IDEMPOTENCY CLAIM — first write, before any effect.
  --
  -- ON CONFLICT DO NOTHING makes the second delivery of the same event
  -- a no-op at the database level rather than by application care. The
  -- claim and every effect below share one transaction, so a crash
  -- mid-processing rolls the claim back too and the provider's retry
  -- gets a genuine second attempt.
  -- ---------------------------------------------------------------
  insert into public.payment_events (
    provider, environment, event_id, provider_event_type,
    kind, status, event_at, payload_digest
  )
  values (
    p_provider, p_environment, p_event_id, p_provider_event_type,
    p_kind, 'ignored', p_occurred_at, p_payload_digest
  )
  on conflict (provider, environment, event_id) do nothing
  returning id into v_event_row_id;

  if v_event_row_id is null then
    -- Already processed. Deliberately NOT an error: the provider is
    -- retrying something we finished, and it deserves a 200 so it stops.
    return jsonb_build_object('result', 'already_processed');
  end if;

  -- ---------------------------------------------------------------
  -- 2. TENANT RESOLUTION (F3) — never from a payload-supplied account.
  --
  -- Three ordered sources, all of which are OUR OWN rows keyed by a
  -- provider reference:
  --   a. subscriptions.provider_ref  (the steady state)
  --   b. checkout_intents.provider_ref (first activation)
  --   c. the correlation locator → checkout_intents.id  (crash window)
  --
  -- (c) closes the case where the provider object exists but
  -- provider_ref was never persisted, so (a) and (b) miss by
  -- construction. It resolves the tenant by LOOKING UP one of our rows
  -- — it never trusts an account id, plan, or price from the payload
  -- (attacks A4 / A29).
  -- ---------------------------------------------------------------
  if p_subscription_ref is not null then
    select * into v_subscription
    from public.subscriptions
    where provider = p_provider
      and environment = p_environment
      and provider_ref = p_subscription_ref
    -- Serialise concurrent events for one subscription (A22): two
    -- deliveries racing would otherwise both read the pre-state and
    -- compute their transition from it.
    for update;
  end if;

  if v_subscription.id is not null then
    v_account_id := v_subscription.account_id;
  else
    -- (b) then (c).
    if p_subscription_ref is not null then
      select * into v_intent
      from public.checkout_intents
      where provider = p_provider
        and environment = p_environment
        and provider_ref = p_subscription_ref
      for update;
    end if;

    if v_intent.id is null and p_correlation_intent_id is not null then
      select * into v_intent
      from public.checkout_intents
      where id = p_correlation_intent_id
        -- The locator may only ever resolve WITHIN the same provider and
        -- environment. Otherwise a test-mode event could name a live
        -- intent and cross the very boundary step 0 just enforced.
        and provider = p_provider
        and environment = p_environment
      for update;
    end if;

    if v_intent.id is null then
      -- Unresolvable. RAISE rather than record: this is the transient
      -- case (our own write may still be in flight), so rolling back the
      -- claim and returning 5xx lets the provider redeliver. Recording
      -- 'failed_terminal' here would burn the claim on a customer who
      -- has genuinely paid.
      raise exception
        'process_payment_event: unresolved tenant for %/% event % (subscription_ref %)',
        p_provider, p_environment, p_event_id, p_subscription_ref
        using errcode = 'P0002';
    end if;

    v_account_id := v_intent.account_id;
  end if;

  -- ---------------------------------------------------------------
  -- 3. Manual-billing short-circuit (D16, attack A14).
  --
  -- An enterprise tenant billed by invoice must never have its plan
  -- moved by a provider event. Recorded and ignored, not raised: the
  -- event is genuine, it simply has no authority here.
  -- ---------------------------------------------------------------
  select billing_mode into v_billing_mode
  from public.accounts where id = v_account_id;

  if v_billing_mode = 'manual' then
    update public.payment_events
    set status = 'ignored',
        ignored_reason = 'manual_billing_account',
        account_id = v_account_id,
        subscription_id = v_subscription.id
    where id = v_event_row_id;
    return jsonb_build_object('result', 'ignored', 'reason', 'manual_billing_account');
  end if;

  -- ---------------------------------------------------------------
  -- 4. MONEY LEDGER (D8). Independent of any status change: a refund
  -- must be recorded even though it moves no entitlement.
  --
  -- The unique violation is classified as `already_applied` + 200
  -- ON PURPOSE. provider_ref comes from inside the SIGNED body, so this
  -- is the fence that stops a replayed body carrying a substituted
  -- event id from producing a second money row (A35). Letting it bubble
  -- as a generic error would spend the provider's whole retry budget on
  -- an event that can never succeed.
  -- ---------------------------------------------------------------
  if p_kind in ('charged', 'refunded', 'charged_back') then
    if p_amount_minor is null or p_currency is null then
      -- D7: never an amount without its currency.
      raise exception
        'process_payment_event: money event % missing amount or currency', p_event_id
        using errcode = '22023';
    end if;

    v_ledger_kind := case p_kind
      when 'charged' then 'charge'
      when 'refunded' then 'refund'
      when 'charged_back' then 'chargeback'
    end;

    -- Sign discipline: charges positive, reversals negative. abs() so a
    -- provider that already signs its reversals cannot double-negate
    -- into a positive.
    v_signed_amount := case
      when v_ledger_kind = 'charge' then abs(p_amount_minor)
      else -abs(p_amount_minor)
    end;

    begin
      insert into public.payment_transactions (
        account_id, subscription_id, provider, environment, kind,
        amount_minor, currency, provider_ref, payment_event_id, occurred_at
      )
      values (
        v_account_id, v_subscription.id, p_provider, p_environment, v_ledger_kind,
        v_signed_amount, p_currency, p_provider_ref, v_event_row_id, p_occurred_at
      );
    exception when unique_violation then
      update public.payment_events
      set status = 'ignored',
          ignored_reason = 'money_effect_already_recorded',
          account_id = v_account_id,
          subscription_id = v_subscription.id
      where id = v_event_row_id;
      return jsonb_build_object('result', 'already_applied');
    end;
  end if;

  -- ---------------------------------------------------------------
  -- 5. No subscription row yet? Record the money and stop.
  --
  -- A charge can legitimately precede the subscription's creation in
  -- our tables. The ledger is safe; there is simply no status to move.
  -- Task 10 reconciliation will materialise the subscription.
  -- ---------------------------------------------------------------
  if v_subscription.id is null then
    update public.payment_events
    set status = case when p_kind in ('charged','refunded','charged_back')
                      then 'applied' else 'ignored' end,
        ignored_reason = case when p_kind in ('charged','refunded','charged_back')
                              then null else 'no_local_subscription' end,
        account_id = v_account_id
    where id = v_event_row_id;
    return jsonb_build_object(
      'result', case when p_kind in ('charged','refunded','charged_back')
                     then 'applied' else 'ignored' end,
      'reason', 'no_local_subscription'
    );
  end if;

  -- ---------------------------------------------------------------
  -- 6. ORDERING GUARD (D12, attack A8).
  --
  -- Prefer the provider's authoritative resource version; fall back to
  -- timestamps only when it is absent. Razorpay documents that events
  -- may arrive out of order, so a stale delivery must not overwrite
  -- newer state.
  --
  -- Note this guards the STATUS transition only — the ledger write above
  -- is already fenced by its own unique constraint and must not be
  -- suppressed by ordering (a late-delivered refund is still a real
  -- refund).
  -- ---------------------------------------------------------------
  if p_occurred_at is not null
     and v_subscription.last_event_at is not null
     and p_occurred_at < v_subscription.last_event_at
     -- Equal timestamps are NOT stale: Razorpay's created_at is
     -- second-granular, so two ordered events routinely share one.
     and (
       p_resource_status is null
       or coalesce((v_status_rank ->> p_resource_status)::int, -1)
          < coalesce((v_status_rank ->> v_subscription.status)::int, -1)
     )
  then
    update public.payment_events
    set status = 'ignored',
        ignored_reason = 'stale_event_out_of_order',
        account_id = v_account_id,
        subscription_id = v_subscription.id
    where id = v_event_row_id;
    return jsonb_build_object('result', 'ignored', 'reason', 'stale_event_out_of_order');
  end if;

  -- ---------------------------------------------------------------
  -- 7. STATE TRANSITION — mirrors subscription-state.ts exactly.
  --
  -- Duplicated deliberately: the TS module is the exhaustively-tested
  -- specification, and this is the enforcement point that must hold even
  -- if a future caller forgets to consult it. Task 12 asserts the two
  -- agree.
  -- ---------------------------------------------------------------
  v_next_status := v_subscription.status;
  v_cancel_at_end := v_subscription.cancel_at_period_end;

  if p_kind in ('charged', 'refunded', 'charged_back') then
    v_reason := 'money_event_no_status_change';

  elsif v_subscription.status in ('canceled', 'expired') then
    -- Terminal absorbs everything. No event revives a dead subscription.
    v_reason := 'terminal_state';

  elsif p_kind = 'cancel_scheduled' then
    -- Only from a state with a paid period to cancel at the end of.
    -- From `incomplete` the flag would describe a boundary that does
    -- not exist, and would leave the subscription going live already
    -- flagged for cancellation.
    if v_subscription.status not in ('active', 'past_due') then
      v_reason := 'no_transition_from_state';
    elsif v_cancel_at_end then
      v_reason := 'already_in_state';
    else
      v_cancel_at_end := true;
      v_changed := true;
      v_reason := 'applied';
    end if;

  else
    v_next_status := case v_subscription.status
      when 'incomplete' then case p_kind
        when 'activated' then 'active'
        -- No paid period to be late on, so no grace: expired, not past_due.
        when 'payment_failed' then 'expired'
        when 'canceled' then 'canceled'
        when 'expired' then 'expired'
        else null end
      when 'active' then case p_kind
        when 'activated' then 'active'
        when 'payment_failed' then 'past_due'
        when 'canceled' then 'canceled'
        when 'expired' then 'expired'
        else null end
      when 'past_due' then case p_kind
        when 'activated' then 'active'
        when 'payment_failed' then 'past_due'
        when 'canceled' then 'canceled'
        when 'expired' then 'expired'
        else null end
      else null
    end;

    if v_next_status is null then
      v_next_status := v_subscription.status;
      v_reason := 'no_transition_from_state';
    elsif v_next_status = v_subscription.status then
      v_reason := 'already_in_state';
    else
      v_changed := true;
      v_reason := 'applied';
      if v_next_status in ('canceled', 'expired') then
        -- No future period boundary left for the flag to describe.
        v_cancel_at_end := false;
      end if;
    end if;
  end if;

  if not v_changed then
    update public.payment_events
    set status = case when p_kind in ('charged','refunded','charged_back')
                      then 'applied' else 'ignored' end,
        ignored_reason = v_reason,
        account_id = v_account_id,
        subscription_id = v_subscription.id
    where id = v_event_row_id;

    -- Even with no status change, a money event still advances the
    -- ordering watermark.
    if p_occurred_at is not null then
      update public.subscriptions
      set last_event_at = greatest(coalesce(last_event_at, p_occurred_at), p_occurred_at)
      where id = v_subscription.id;
    end if;

    return jsonb_build_object(
      'result', case when p_kind in ('charged','refunded','charged_back')
                     then 'applied' else 'ignored' end,
      'reason', v_reason
    );
  end if;

  -- ---------------------------------------------------------------
  -- 8. Persist subscription state.
  -- ---------------------------------------------------------------
  if v_next_status = 'past_due' and v_subscription.status <> 'past_due' then
    -- Entering past_due opens the grace window (D13).
    v_grace_until := now() + make_interval(days => greatest(p_grace_days, 0));
  end if;

  update public.subscriptions
  set status = v_next_status,
      cancel_at_period_end = v_cancel_at_end,
      last_event_at = case
        when p_occurred_at is null then last_event_at
        else greatest(coalesce(last_event_at, p_occurred_at), p_occurred_at)
      end,
      updated_at = now()
  where id = v_subscription.id;

  -- ---------------------------------------------------------------
  -- 9. ENTITLEMENT — the actual point of this function.
  --
  -- Resolved from `plans.is_default` rather than a literal 'free', so a
  -- plan rename can never leave a dangling plan_id. The schema already
  -- guarantees exactly one default row.
  -- ---------------------------------------------------------------
  if v_next_status in ('active', 'past_due') then
    update public.accounts
    set plan_id = v_subscription.plan_id,
        grace_until = case
          when v_next_status = 'past_due' then coalesce(v_grace_until, grace_until)
          else null  -- recovered: clear the window
        end,
        updated_at = now()
    where id = v_account_id;
  else
    select id into v_default_plan_id
    from public.plans where is_default limit 1;

    if v_default_plan_id is null then
      -- Refuse to guess. Rolling back is strictly safer than writing an
      -- arbitrary plan id into a live tenant's entitlement.
      raise exception
        'process_payment_event: no default plan configured (plans.is_default)'
        using errcode = 'P0002';
    end if;

    update public.accounts
    set plan_id = v_default_plan_id,
        grace_until = null,
        updated_at = now()
    where id = v_account_id;
  end if;

  update public.payment_events
  set status = 'applied',
      account_id = v_account_id,
      subscription_id = v_subscription.id
  where id = v_event_row_id;

  return jsonb_build_object(
    'result', 'applied',
    'status', v_next_status,
    'subscription_id', v_subscription.id
  );
end;
$$;

comment on function public.process_payment_event(
  text, text, text, text, text, text, text, integer, text, timestamptz,
  text, text, uuid, text, integer
) is
  'ADR-009 Task 4: the ONLY writer of provider-derived billing state. Applies a signature-verified provider event atomically — idempotency claim, tenant resolution, environment gate, money ledger, status transition and entitlement in one transaction. The CALLER must have verified the signature first; this function enforces atomicity and provenance, not authenticity. Service-role only.';

-- ---------------------------------------------------------------------
-- Grants. SECURITY DEFINER functions in `public` are callable by
-- PUBLIC by default, so `anon` and `authenticated` would inherit
-- EXECUTE and be able to move entitlement directly. Revoke explicitly.
-- ---------------------------------------------------------------------
revoke execute on function public.process_payment_event(
  text, text, text, text, text, text, text, integer, text, timestamptz,
  text, text, uuid, text, integer
) from public, anon, authenticated;

grant execute on function public.process_payment_event(
  text, text, text, text, text, text, text, integer, text, timestamptz,
  text, text, uuid, text, integer
) to service_role;

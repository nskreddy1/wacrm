-- ADR-009 / Task 4 (corrective) — process_payment_event(), v2.
--
-- WHY THIS MIGRATION EXISTS
-- The v1 function (20260822150000) took a SINGLE `p_environment`
-- argument and then documented itself as comparing "configured" against
-- "observed". With one parameter there is nothing to compare: the gate
-- read the environment off the caller and checked it against itself,
-- which is a no-op that reads like a control (attacks A11 / A30 / A32).
-- Task 4.1c requires TWO values arriving at two different trust levels:
--
--   p_environment        TRUSTED  — the deployment's own configured mode,
--                                   from paymentsEnvironment() in env.ts.
--                                   Postgres cannot read PAYMENTS_ENVIRONMENT,
--                                   so the trusted server caller must pass it.
--   p_event_environment  OBSERVED — the credential set whose webhook secret
--                                   actually verified this signature, stamped
--                                   by the adapter (5.3b).
--
-- Three further Task 4 requirements were missing and are implemented here:
--   * 4.1b step 3 — RECONSTRUCT a missing `subscriptions` row from its
--     `checkout_intents` row. Without it the intent-first design resolved
--     the tenant and then died on the next line (attack A22).
--   * 4.1b step 2b — the SEVEN-condition correlation-locator bind, and the
--     `provider_ref` binding it implies (attacks A28 / A34).
--   * 4.2 step 9 — the audit row, and marking the intent `completed` on
--     first activation.
--
-- Plus `GRANT EXECUTE … TO service_role`, which v1 revoked from everyone
-- and then granted to nobody.
--
-- The signature changed, so the old overload is DROPPED rather than
-- replaced — two overloads resolving on argument count is exactly how a
-- caller silently keeps hitting the version without the gate.

-- ---------------------------------------------------------------------
-- Retire v1. `drop … if exists` keeps this migration idempotent; the
-- explicit argument list makes sure we drop the ungated overload and
-- nothing else.
-- ---------------------------------------------------------------------
drop function if exists public.process_payment_event(
  text, text, text, text, text, text, text, integer, text, timestamptz,
  text, text, uuid, text, integer
);

create or replace function public.process_payment_event(
  p_provider text,

  -- TRUSTED: the caller's own configured deployment mode. Never read
  -- from the event. A caller that cannot state its mode is a
  -- misconfiguration, not a 200.
  p_environment text,

  -- OBSERVED: the environment of the credential set that verified this
  -- delivery's signature. Compared against p_environment below.
  p_event_environment text,

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
-- SECURITY DEFINER is written explicitly on every re-creation: `create
-- or replace` does NOT inherit it, and Postgres silently downgrades the
-- function to INVOKER, which then fails only for real users on exactly
-- the paths that needed elevation (AGENTS.md; enforced by
-- scripts/push-supabase-schema.mjs).
security definer
-- Empty search_path + fully schema-qualified objects everywhere below.
-- A definer function is the one place a resolution surprise executes
-- with elevated rights.
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
  v_prev_status      text;
  v_status_rank      jsonb := '{"incomplete":0,"active":1,"past_due":1,"canceled":2,"expired":2}'::jsonb;
begin
  -- ---------------------------------------------------------------
  -- 0. Validate the TRUSTED environment parameter (Task 4.2 step 1).
  --
  -- Ordered before the claim purely for clarity: a RAISE rolls the whole
  -- transaction back regardless, so nothing is recorded either way. What
  -- matters is that an absent or garbage trusted value is an EXCEPTION
  -- (5xx, provider retries) and never a silent default to 'test' or
  -- 'live' — guessing either way is a fail-open (attack A25).
  -- ---------------------------------------------------------------
  if p_environment is null or p_environment not in ('test', 'live') then
    raise exception 'process_payment_event: invalid configured environment %', p_environment
      using errcode = '22023';
  end if;

  -- The observed value comes from our own adapter, so a bad one is a
  -- code defect rather than hostile input — but it is still never
  -- allowed to become the stored environment by default.
  if p_event_environment is null or p_event_environment not in ('test', 'live') then
    raise exception 'process_payment_event: invalid observed environment %', p_event_environment
      using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------
  -- 1. THE IDEMPOTENCY CLAIM — first write, before any effect.
  --
  -- Stored `environment` is the OBSERVED one, so forensics can still
  -- show a rejected test-mode delivery to a live deployment (4.1c).
  -- ON CONFLICT DO NOTHING makes a redelivery a database-level no-op
  -- rather than a matter of application care, and the claim shares this
  -- transaction with every effect below: a crash mid-processing rolls
  -- the claim back too, so the provider's retry gets a genuine second
  -- attempt (attack A21).
  -- ---------------------------------------------------------------
  insert into public.payment_events (
    provider, environment, event_id, provider_event_type,
    kind, status, event_at, payload_digest
  )
  values (
    p_provider, p_event_environment, p_event_id, p_provider_event_type,
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
  -- 2. ENVIRONMENT GATE (attacks A11 / A30 / A32).
  --
  -- Ahead of tenant resolution and reconstruction ON PURPOSE. With the
  -- gate downstream, a test-mode delivery to a live deployment would
  -- claim the event, find a checkout_intent, INSERT a `subscriptions`
  -- row and only then be ignored — committing a billing-state mutation
  -- it had no authority to make. Here the rejection is total:
  --
  --   wrong environment → ignored (committed, 200)
  --     → NO subscription reconstruction
  --     → NO plan lookup
  --     → NO ledger row
  --     → NO entitlement mutation
  --
  -- Only the payment_events claim row survives, which is forensics and
  -- not billing state.
  -- ---------------------------------------------------------------
  if p_event_environment <> p_environment then
    update public.payment_events
    set status = 'ignored',
        ignored_reason = 'wrong_environment'
    where id = v_event_row_id;
    return jsonb_build_object('result', 'ignored', 'reason', 'wrong_environment');
  end if;

  -- ---------------------------------------------------------------
  -- 3. TENANT RESOLUTION (F3) — never from a payload-supplied account.
  --
  -- Three ordered sources, ALL of which are our own rows:
  --   a. subscriptions.provider_ref     (the steady state)
  --   b. checkout_intents.provider_ref  (first activation)
  --   c. the correlation locator → checkout_intents.id (crash window)
  --
  -- (c) closes the case where the provider object exists but
  -- provider_ref was never persisted, so (a) and (b) miss BY
  -- CONSTRUCTION. It resolves the tenant by LOOKING UP one of our rows;
  -- it never trusts an account id, plan, price or interval from the
  -- payload (attacks A4 / A29). A note that matches nothing is worth
  -- nothing.
  -- ---------------------------------------------------------------
  if p_subscription_ref is not null then
    select * into v_subscription
    from public.subscriptions
    where provider = p_provider
      and environment = p_environment
      and provider_ref = p_subscription_ref
    -- Serialise concurrent deliveries for one subscription (A6): two
    -- would otherwise both read the pre-state and compute their
    -- transition from it.
    for update;
  end if;

  if v_subscription.id is not null then
    v_account_id := v_subscription.account_id;
  else
    -- (b)
    if p_subscription_ref is not null then
      select * into v_intent
      from public.checkout_intents
      where provider = p_provider
        and environment = p_environment
        and provider_ref = p_subscription_ref
      for update;
    end if;

    -- (c) The seven-condition locator bind (Task 4.1b step 2b). Every
    -- condition is load-bearing; anything short of all seven is treated
    -- as "no intent" and raises.
    --   1. signature already verified — guaranteed, the RPC is
    --      service-role only and unreachable otherwise;
    --   2. a locator was supplied;
    --   3. the intent EXISTS (locked);
    --   4. same provider;
    --   5. same environment — redundant after the gate above, and kept
    --      deliberately so it is never the only thing standing between a
    --      test-mode delivery and a live insert;
    --   6. the journey is still OPEN;
    --   7. provider_ref is unset or already equal — a bound intent is
    --      NEVER re-pointed at a different provider resource (A28).
    if v_intent.id is null and p_correlation_intent_id is not null then
      select * into v_intent
      from public.checkout_intents
      where id = p_correlation_intent_id
        and provider = p_provider
        and environment = p_environment
        and status in ('created', 'provider_attached')
        and (
          provider_ref is null
          or p_subscription_ref is null
          or provider_ref = p_subscription_ref
        )
      for update;

      -- Bind the ref we just learned, so the NEXT delivery resolves by
      -- path (b) and never depends on the locator again.
      if v_intent.id is not null and p_subscription_ref is not null
         and v_intent.provider_ref is null then
        update public.checkout_intents
        set provider_ref = p_subscription_ref,
            status = 'provider_attached',
            updated_at = now()
        where id = v_intent.id;
        v_intent.provider_ref := p_subscription_ref;
        v_intent.status := 'provider_attached';
      end if;
    end if;

    if v_intent.id is null then
      -- Unresolvable. RAISE rather than record: this is the transient
      -- case (our own checkout write may still be in flight), so rolling
      -- the claim back and returning 5xx lets the provider redeliver.
      -- Recording 'failed_terminal' here would burn the claim on a
      -- customer who has genuinely paid (Task 9.4a).
      raise exception
        'process_payment_event: unresolved tenant for %/% event % (subscription_ref %)',
        p_provider, p_environment, p_event_id, p_subscription_ref
        using errcode = 'P0002';
    end if;

    v_account_id := v_intent.account_id;
  end if;

  -- ---------------------------------------------------------------
  -- 4. Manual-billing short-circuit (D16, attack A14).
  --
  -- An enterprise tenant billed by invoice must never have its plan
  -- moved by a provider event. Recorded and ignored rather than raised:
  -- the event is genuine, it simply has no authority here. Placed ahead
  -- of the ledger so a manual account accrues no self-serve money rows
  -- either.
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
  -- 5. RECONSTRUCT a missing subscription from its intent
  --    (Task 4.1b step 3 — `ensure_subscription_for_event`).
  --
  -- The crash this exists for:
  --
  --   checkout_intent exists         ✅
  --   provider subscription exists   ✅
  --   our process died before the `subscriptions` insert
  --   webhook arrives
  --     → tenant resolves via the intent   ✅
  --     → SELECT subscription FOR UPDATE   ❌ no row → stuck
  --
  -- It runs INSIDE this transaction, never as a step a caller could skip
  -- or die between, and it is a REPAIR path, not an ADOPTION path: it
  -- fires only when one of OUR OWN intent rows already names the
  -- account. A provider resource with no local intent is Task 10.6's
  -- orphan incident, never a new mapping (attack A23).
  --
  -- Every business field comes from the INTENT — our server-resolved
  -- plan, interval, amount and currency — and never from the payload
  -- (F1/F3). The provider only contributes lifecycle facts.
  -- ---------------------------------------------------------------
  if v_subscription.id is null and p_subscription_ref is not null then
    insert into public.subscriptions (
      account_id, plan_id, provider, environment, provider_ref,
      status, interval, amount_minor, currency,
      checkout_intent_id
    )
    values (
      v_intent.account_id, v_intent.plan_id, p_provider, p_environment,
      p_subscription_ref,
      -- Always `incomplete`: reconstruction records that the journey
      -- exists, it does not grant anything. The transition below is what
      -- moves entitlement, from the event's own lifecycle kind.
      'incomplete', v_intent.interval, v_intent.amount_minor, v_intent.currency,
      v_intent.id
    )
    -- Two concurrent first-deliveries must not fork the row.
    on conflict (provider, environment, provider_ref) do nothing;

    select * into v_subscription
    from public.subscriptions
    where provider = p_provider
      and environment = p_environment
      and provider_ref = p_subscription_ref
    for update;

    if v_subscription.id is not null then
      v_account_id := v_subscription.account_id;
    end if;
  end if;

  -- ---------------------------------------------------------------
  -- 6. MONEY LEDGER (D8). Independent of any status change: a refund
  -- must be recorded even though it moves no entitlement.
  --
  -- The unique violation is classified `already_applied` + 200 ON
  -- PURPOSE. provider_ref comes from inside the SIGNED body, so this is
  -- the fence that stops a replayed body carrying a substituted event id
  -- from producing a second money row (A35). Letting it bubble as a
  -- generic error would spend the provider's entire 24h retry budget on
  -- an event that can never succeed. Caught NARROWLY — this one
  -- constraint — never as a bare handler that would also swallow a real
  -- fault.
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
  -- 7. Still no subscription row? Record the money and stop.
  --
  -- Only reachable when the event carries no subscription reference at
  -- all (a bare payment), so there was nothing to reconstruct from. The
  -- ledger is safe; there is simply no status to move, and Task 10
  -- reconciliation materialises the rest.
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
  -- 8. ORDERING GUARD (D12, attack A8).
  --
  -- A defensive backstop, not the ordering mechanism. Prefer the
  -- provider's authoritative resource state where the adapter supplied
  -- one; fall back to timestamps only otherwise. Razorpay documents that
  -- events may arrive out of order, so a stale delivery must not
  -- overwrite newer state.
  --
  -- Guards the STATUS transition only — the ledger write above is
  -- already fenced by its own unique constraint and must not be
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
  -- 9. STATE TRANSITION — mirrors subscription-state.ts exactly.
  --
  -- Duplicated deliberately: the TS module is the exhaustively-tested
  -- specification, and this is the enforcement point that must hold even
  -- if a future caller forgets to consult it. Task 12 asserts the two
  -- agree.
  -- ---------------------------------------------------------------
  v_prev_status := v_subscription.status;
  v_next_status := v_subscription.status;
  v_cancel_at_end := v_subscription.cancel_at_period_end;

  if p_kind in ('charged', 'refunded', 'charged_back') then
    v_reason := 'money_event_no_status_change';

  elsif v_subscription.status in ('canceled', 'expired') then
    -- Terminal absorbs everything. No event revives a dead subscription
    -- (attack A9).
    v_reason := 'terminal_state';

  elsif p_kind = 'cancel_scheduled' then
    -- Only from a state with a paid period to cancel at the end of. From
    -- `incomplete` the flag would describe a boundary that does not
    -- exist, and would leave the subscription going live already flagged
    -- for cancellation.
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
        -- Recovery. `halted` maps to past_due, not to a terminal state,
        -- precisely so a later successful debit can come back here
        -- (5.3d).
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
  -- 10. Persist subscription state.
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
  -- 11. ENTITLEMENT — the actual point of this function.
  --
  -- Resolved from `plans.is_default` rather than a literal 'free', so a
  -- plan rename can never leave a dangling plan_id. The schema already
  -- guarantees exactly one default row.
  --
  -- Note what is NOT touched here: account_limit_overrides (F5). An
  -- override always wins over a plan, so a downgrade cannot revoke one
  -- (attack A15).
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

  -- ---------------------------------------------------------------
  -- 12. Close the intent on first activation (Task 4.2 step 9).
  --
  -- This is what releases the `checkout_intents (account_id) WHERE
  -- status IN ('created','provider_attached')` partial unique index, so
  -- the customer can start a NEW journey later. Leaving the intent open
  -- forever would make every future checkout a 409.
  -- ---------------------------------------------------------------
  if v_next_status = 'active' and v_subscription.checkout_intent_id is not null then
    update public.checkout_intents
    set status = 'completed',
        updated_at = now()
    where id = v_subscription.checkout_intent_id
      and status in ('created', 'provider_attached');
  end if;

  -- ---------------------------------------------------------------
  -- 13. Audit row. actor_id is NULL because there is no human actor: the
  -- provider caused this. The column is nullable precisely for system
  -- actions, and `meta` carries only ids and statuses — never a payload,
  -- an amount's provenance, or any instrument data (F7).
  -- ---------------------------------------------------------------
  insert into public.audit_events (account_id, actor_id, actor_label, action, entity, meta)
  values (
    v_account_id,
    null,
    'billing:' || p_provider,
    'billing.subscription.' || v_next_status,
    'subscription:' || v_subscription.id::text,
    jsonb_build_object(
      'from_status', v_prev_status,
      'to_status', v_next_status,
      'kind', p_kind,
      'provider_event_type', p_provider_event_type,
      'payment_event_id', v_event_row_id,
      'environment', p_environment,
      'cancel_at_period_end', v_cancel_at_end
    )
  );

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
  text, text, text, text, text, text, text, text, integer, text, timestamptz,
  text, text, uuid, text, integer
) is
  'ADR-009 Task 4 (v2): the ONLY writer of provider-derived billing state. Applies a signature-verified provider event atomically — idempotency claim, environment gate, tenant resolution, subscription reconstruction, money ledger, status transition, entitlement and audit in ONE transaction. p_environment is the caller''s TRUSTED configured mode; p_event_environment is what the verifying credential set OBSERVED. The caller must have verified the signature first; this function enforces atomicity, idempotency, provenance and ordering, not authenticity. Service-role only.';

-- ---------------------------------------------------------------------
-- Grants. SECURITY DEFINER functions in `public` are callable by PUBLIC
-- by default, so `anon` and `authenticated` would INHERIT EXECUTE and be
-- able to move their own entitlement directly. Revoking from PUBLIC
-- already removes the inherited privilege; the explicit anon/authenticated
-- revoke is written anyway so the intent is unmissable in review.
--
-- The matching GRANT was missing in v1, which left the function callable
-- by nobody.
-- ---------------------------------------------------------------------
revoke execute on function public.process_payment_event(
  text, text, text, text, text, text, text, text, integer, text, timestamptz,
  text, text, uuid, text, integer
) from public, anon, authenticated;

grant execute on function public.process_payment_event(
  text, text, text, text, text, text, text, text, integer, text, timestamptz,
  text, text, uuid, text, integer
) to service_role;

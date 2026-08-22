-- =====================================================================
-- ADR-009 / Task 12 — Red team, DATABASE half.
--
-- WHY THIS FILE EXISTS SEPARATELY FROM attacks.test.ts
-- Vitest can only attack the TypeScript surface. Roughly half of the
-- attack tree is defended by objects that live in Postgres and are
-- unreachable from a mocked client:
--
--   * the UNIQUE (provider, environment, event_id) idempotency claim
--   * the partial unique indexes that make double-billing impossible
--   * the single transaction shared by claim + apply
--   * the environment gate's POSITION inside process_payment_event()
--   * the append-only ledger trigger
--   * RLS on the billing tables and the EXECUTE grant on the RPC
--
-- Asserting those with a fake supabase-js client would prove only that
-- the mock agrees with itself. This suite runs against a real database
-- with the migrations applied.
--
-- HOW TO RUN
--   psql "$POSTGRES_URL" -f supabase/tests/billing_attacks.sql
--
-- The whole file is ONE transaction ending in ROLLBACK: it writes
-- fixtures into real tables and must never leave them behind. Run it
-- against a branch/staging database, never production — a ROLLBACK is
-- not a substitute for that rule, because a crashed session mid-run
-- still leaves locks and burned sequence values.
--
-- pgTAP is required:
--   create extension if not exists pgtap with schema extensions;
--
-- Attack ids (A1..A35) refer to the table in
-- .agents/plans/2026-08-22-payments-subscriptions.md, Task 12.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- pgTAP lives in `extensions` on Supabase; put it on the path rather
-- than schema-qualifying several hundred call sites.
set local search_path to public, extensions;

-- no_plan() rather than plan(n): a hard count is a maintenance tax that
-- fails the suite for the wrong reason the moment a test is added.
select no_plan();

-- ---------------------------------------------------------------------
-- FIXTURES
--
-- Fixed uuids so a failure message points at an identifiable actor.
-- Three tenants because the attacks need three DIFFERENT billing
-- postures, and one account cannot hold all of them at once:
--   A1  self-serve, the storyline account
--   A2  billing_mode = 'manual'      (A14)
--   A3  holds an unlimited override  (A15)
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000b1', 'owner-a@billing.test'),
  ('00000000-0000-4000-8000-0000000000b2', 'owner-b@billing.test'),
  ('00000000-0000-4000-8000-0000000000b3', 'owner-c@billing.test'),
  ('00000000-0000-4000-8000-0000000000b4', 'outsider@billing.test');

-- A paid tier and a deliberately unbuyable one (inactive + unpriced),
-- which is A13's target on the HTTP side and is here so the DB half can
-- prove the RPC never resurrects it either.
insert into public.plans (id, display_name, price_monthly, currency, is_active, is_default, sort_order)
values
  ('zz_test_pro',    'ZZ Test Pro',    49900, 'INR', true,  false, 900),
  ('zz_test_hidden', 'ZZ Test Hidden', null,  'INR', false, false, 901);

-- The default plan is resolved, never hardcoded to 'free': the RPC
-- resolves entitlement through plans.is_default, so the test must ask
-- the same question the code asks.
create temp table t_fix as
select (select id from public.plans where is_default) as default_plan_id;

insert into public.accounts (id, name, owner_user_id, plan_id, billing_mode)
select
  x.id, x.name, x.owner, coalesce(x.plan, f.default_plan_id), x.mode
from t_fix f,
  (values
    ('00000000-0000-4000-8000-0000000000a1'::uuid, 'Billing Test A', '00000000-0000-4000-8000-0000000000b1'::uuid, null::text,          'self_serve'),
    ('00000000-0000-4000-8000-0000000000a2'::uuid, 'Billing Test B', '00000000-0000-4000-8000-0000000000b2'::uuid, 'zz_test_pro'::text, 'manual'),
    ('00000000-0000-4000-8000-0000000000a3'::uuid, 'Billing Test C', '00000000-0000-4000-8000-0000000000b3'::uuid, 'zz_test_pro'::text, 'self_serve')
  ) as x(id, name, owner, plan, mode);

insert into public.account_members (account_id, user_id, role, status) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'owner', 'active'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2', 'owner', 'active'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000b3', 'owner', 'active');

-- The override that A15 tries to strip. unlimited_all is the strongest
-- form, so if a downgrade cannot touch this it cannot touch any.
insert into public.account_limit_overrides (account_id, unlimited_all, reason)
values ('00000000-0000-4000-8000-0000000000a3', true, 'ADR-009 Task 12 fixture');

-- =====================================================================
-- SECTION 0 — the RPC's own attack surface
-- =====================================================================

-- A single overload. Two overloads resolving on argument count is
-- exactly how a caller keeps silently hitting the version WITHOUT the
-- environment gate, which is the defect 20260823120000 exists to fix.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'process_payment_event'),
  1,
  'process_payment_event has exactly ONE overload (the ungated v1 is dropped)'
);

-- `create or replace function` does NOT inherit SECURITY DEFINER. A
-- silent downgrade to INVOKER only fails for real users, on exactly the
-- paths that needed elevation.
select ok(
  (select p.prosecdef
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'process_payment_event'),
  'process_payment_event is SECURITY DEFINER'
);

select ok(
  (select p.proconfig::text like '%search_path=%'
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'process_payment_event'),
  'process_payment_event pins search_path (a SECURITY DEFINER without one is hijackable)'
);

-- SECURITY DEFINER functions in `public` are callable by PUBLIC unless
-- revoked, so a logged-in attacker would otherwise be able to move
-- their own entitlement by calling this directly.
select ok(
  not has_function_privilege(
    'authenticated',
    'public.process_payment_event(text,text,text,text,text,text,text,text,integer,text,timestamptz,text,text,uuid,text,integer)',
    'EXECUTE'),
  'authenticated cannot EXECUTE process_payment_event'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.process_payment_event(text,text,text,text,text,text,text,text,integer,text,timestamptz,text,text,uuid,text,integer)',
    'EXECUTE'),
  'anon cannot EXECUTE process_payment_event'
);

-- The mirror image of the above, and the bug v1 actually shipped:
-- revoked from everyone and granted to nobody, so the webhook could not
-- apply anything at all.
select ok(
  has_function_privilege(
    'service_role',
    'public.process_payment_event(text,text,text,text,text,text,text,text,integer,text,timestamptz,text,text,uuid,text,integer)',
    'EXECUTE'),
  'service_role CAN EXECUTE process_payment_event'
);

-- =====================================================================
-- SECTION 1 — A25 / A30: the trusted environment parameter
--
-- An absent or garbage CONFIGURED environment must be an exception
-- (5xx, provider retries), never a default. Defaulting to 'test' or to
-- 'live' are both fail-open: one ignores real money, the other applies
-- rehearsal money.
-- =====================================================================

select throws_ok(
  $$ select public.process_payment_event(
       p_provider => 'razorpay', p_environment => null,
       p_event_environment => 'live', p_event_id => 'evt_env_null',
       p_provider_event_type => 'subscription.activated', p_kind => 'activated',
       p_provider_ref => 'sub_x', p_subscription_ref => 'sub_x') $$,
  '22023', null,
  'A30 rpc_refuses_missing_configured_environment — null p_environment raises, never defaults'
);

select throws_ok(
  $$ select public.process_payment_event(
       p_provider => 'razorpay', p_environment => 'prod',
       p_event_environment => 'live', p_event_id => 'evt_env_garbage',
       p_provider_event_type => 'subscription.activated', p_kind => 'activated',
       p_provider_ref => 'sub_x', p_subscription_ref => 'sub_x') $$,
  '22023', null,
  'A25 invalid_environment_rejected — "prod" is not a valid environment, and is not coerced to live'
);

-- =====================================================================
-- SECTION 2 — A11 / A30 / A32: the environment gate, and its POSITION
--
-- The gate is step 2, ahead of tenant resolution. With it downstream a
-- test-mode delivery to a live deployment would claim the event, find
-- the intent, INSERT a subscriptions row and only then be ignored — a
-- billing-state write made by an event with no authority.
-- =====================================================================

-- An intent that a wrongly-gated event could reconstruct from. Its
-- existence is the whole point: the gate must reject BEFORE using it.
insert into public.checkout_intents
  (id, account_id, plan_id, interval, provider, environment, amount_minor, currency, status, provider_ref)
values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1',
   'zz_test_pro', 'monthly', 'razorpay', 'live', 49900, 'INR', 'created', 'sub_live_1');

select is(
  public.process_payment_event(
    p_provider => 'razorpay',
    p_environment => 'live',          -- TRUSTED: what we are configured as
    p_event_environment => 'test',    -- OBSERVED: which secret verified it
    p_event_id => 'evt_testmode_1',
    p_provider_event_type => 'subscription.activated',
    p_kind => 'activated',
    p_provider_ref => 'sub_live_1',
    p_subscription_ref => 'sub_live_1'
  ) ->> 'reason',
  'wrong_environment',
  'A11/A30 rpc_rejects_event_environment_mismatch + test_mode_event_rejected_in_prod — observed <> configured is ignored'
);

select is(
  (select count(*)::int from public.subscriptions
    where provider_ref = 'sub_live_1'),
  0,
  'A32 wrong_environment_event_creates_no_subscription_row — no reconstruction happened'
);

select is(
  (select status from public.payment_events where event_id = 'evt_testmode_1'),
  'ignored',
  'A32 the rejected delivery still leaves a forensic payment_events row'
);

select is(
  (select plan_id from public.accounts where id = '00000000-0000-4000-8000-0000000000a1'),
  (select default_plan_id from t_fix),
  'A11 a wrong-environment event moved no entitlement'
);

-- =====================================================================
-- SECTION 3 — A4 / A23 / A27: tenant resolution is never adoption
-- =====================================================================

-- No subscriptions row, no intent with that ref, no locator: the only
-- safe answer is "I cannot tell whose this is". It RAISES rather than
-- recording, because a burned claim on a customer who genuinely paid is
-- worse than a redelivery.
select throws_ok(
  $$ select public.process_payment_event(
       p_provider => 'razorpay', p_environment => 'live',
       p_event_environment => 'live', p_event_id => 'evt_orphan_1',
       p_provider_event_type => 'subscription.activated', p_kind => 'activated',
       p_provider_ref => 'sub_unknown_9', p_subscription_ref => 'sub_unknown_9') $$,
  'P0002', null,
  'A23 orphan_is_never_adopted — an unknown provider subscription raises, it is not adopted'
);

select is(
  (select count(*)::int from public.subscriptions where provider_ref = 'sub_unknown_9'),
  0,
  'A23 no tenant mapping was invented from the unknown provider resource'
);

-- The same raise proves A20/A27: the claim and every effect share one
-- transaction, so a failure leaves ZERO payment_events rows. Two
-- supabase-js calls (claim, then apply) could not produce this.
select is(
  (select count(*)::int from public.payment_events where event_id = 'evt_orphan_1'),
  0,
  'A27 claim_and_apply_share_one_transaction — the rolled-back apply left no claim behind'
);

-- A21 is the consequence, and it needs its own assertion because the
-- failure mode is silent: if the claim had survived its own rollback,
-- the provider's retry would be answered 'already_processed' — a 200 for
-- an event we never applied, and the customer never gets what they paid
-- for. The SECOND attempt must therefore raise exactly like the first,
-- not report success.
select throws_ok(
  $$ select public.process_payment_event(
       p_provider => 'razorpay', p_environment => 'live',
       p_event_environment => 'live', p_event_id => 'evt_orphan_1',
       p_provider_event_type => 'subscription.activated', p_kind => 'activated',
       p_provider_ref => 'sub_unknown_9', p_subscription_ref => 'sub_unknown_9') $$,
  'P0002', null,
  'A21 retryable_failure_releases_claim — the redelivery gets a genuine second attempt, not a false 200'
);

-- =====================================================================
-- SECTION 4 — A28 / A29: the correlation locator
--
-- It may LOCATE one of our own intents and nothing else. Note what is
-- NOT under test, because it cannot be: naming an account. There is no
-- p_account_id parameter to attack (A29 is structural, and the TS suite
-- asserts the adapter never sends one).
-- =====================================================================

select throws_ok(
  $$ select public.process_payment_event(
       p_provider => 'razorpay', p_environment => 'live',
       p_event_environment => 'live', p_event_id => 'evt_locator_unknown',
       p_provider_event_type => 'subscription.activated', p_kind => 'activated',
       p_provider_ref => 'sub_ghost', p_subscription_ref => 'sub_ghost',
       p_correlation_intent_id => '00000000-0000-4000-8000-00000000dead') $$,
  'P0002', null,
  'A28 correlation_note_for_unknown_intent_is_rejected — a forged locator points at nothing'
);

-- A bound intent: provider_ref already set to a DIFFERENT resource.
insert into public.checkout_intents
  (id, account_id, plan_id, interval, provider, environment, amount_minor, currency, status, provider_ref)
values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a3',
   'zz_test_pro', 'monthly', 'razorpay', 'live', 49900, 'INR', 'provider_attached', 'sub_bound_real');

select throws_ok(
  $$ select public.process_payment_event(
       p_provider => 'razorpay', p_environment => 'live',
       p_event_environment => 'live', p_event_id => 'evt_rebind_attempt',
       p_provider_event_type => 'subscription.activated', p_kind => 'activated',
       p_provider_ref => 'sub_attacker', p_subscription_ref => 'sub_attacker',
       p_correlation_intent_id => '00000000-0000-4000-8000-0000000000c2') $$,
  'P0002', null,
  'A28 correlation_note_cannot_rebind_a_bound_intent — provider_ref is never re-pointed'
);

select is(
  (select provider_ref from public.checkout_intents
    where id = '00000000-0000-4000-8000-0000000000c2'),
  'sub_bound_real',
  'A28 the victim intent still points at its original provider resource'
);

-- The legitimate mirror image, which is why the locator exists at all:
-- our process died before writing provider_ref, so paths (a) and (b)
-- miss BY CONSTRUCTION and only the locator can recover it.
insert into public.checkout_intents
  (id, account_id, plan_id, interval, provider, environment, amount_minor, currency, status, provider_ref)
values
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000a1',
   'zz_test_pro', 'monthly', 'razorpay', 'live', 49900, 'INR', 'created', null);

select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_recovered_1',
    p_provider_event_type => 'subscription.activated', p_kind => 'activated',
    p_provider_ref => 'sub_recovered', p_subscription_ref => 'sub_recovered',
    p_correlation_intent_id => '00000000-0000-4000-8000-0000000000c3',
    p_occurred_at => now() - interval '10 minutes'
  ) ->> 'result',
  'applied',
  'A22/A34 subscription_reconstructed_from_intent — the crash window is recoverable'
);

select is(
  (select account_id from public.subscriptions where provider_ref = 'sub_recovered'),
  '00000000-0000-4000-8000-0000000000a1'::uuid,
  'A22 the reconstructed subscription belongs to the intent OWNER, not to anything in the payload'
);

select is(
  (select amount_minor from public.subscriptions where provider_ref = 'sub_recovered'),
  49900,
  'F1 the reconstructed amount came from OUR intent row, never from the event'
);

select is(
  (select provider_ref from public.checkout_intents
    where id = '00000000-0000-4000-8000-0000000000c3'),
  'sub_recovered',
  'A22 the learned provider_ref is bound, so the next delivery resolves without the locator'
);

select is(
  (select status from public.checkout_intents
    where id = '00000000-0000-4000-8000-0000000000c3'),
  'completed',
  'Task 4.2.12 first activation closes the intent, releasing the one-open-intent index'
);

select is(
  (select plan_id from public.accounts where id = '00000000-0000-4000-8000-0000000000a1'),
  'zz_test_pro',
  'entitlement moved to the paid plan on activation'
);

-- =====================================================================
-- SECTION 5 — A6 / A35: idempotency at two different levels
--
-- These are DIFFERENT defenses and the plan is explicit that mislabelling
-- them is a real risk: if the event claim were the only fence, A35 would
-- walk straight through it, because the event id is OUTSIDE the HMAC.
-- =====================================================================

-- A real charge on the storyline subscription.
select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_charge_1',
    p_provider_event_type => 'subscription.charged', p_kind => 'charged',
    p_provider_ref => 'pay_1', p_subscription_ref => 'sub_recovered',
    p_amount_minor => 49900, p_currency => 'INR',
    p_occurred_at => now() - interval '9 minutes'
  ) ->> 'result',
  'applied',
  'a charge is recorded'
);

-- EVENT level: same event id, replayed.
select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_charge_1',
    p_provider_event_type => 'subscription.charged', p_kind => 'charged',
    p_provider_ref => 'pay_1', p_subscription_ref => 'sub_recovered',
    p_amount_minor => 49900, p_currency => 'INR'
  ) ->> 'result',
  'already_processed',
  'A6 duplicate_event_applies_once — the UNIQUE (provider, environment, event_id) claim absorbs the replay'
);

-- EFFECT level: same signed body, SUBSTITUTED event id. Verification
-- passes; the money fence is what stops it.
select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_charge_1_forged_id',
    p_provider_event_type => 'subscription.charged', p_kind => 'charged',
    p_provider_ref => 'pay_1', p_subscription_ref => 'sub_recovered',
    p_amount_minor => 49900, p_currency => 'INR'
  ) ->> 'result',
  'already_applied',
  'A35 replayed_body_with_new_event_id_has_no_duplicate_money_effect'
);

select is(
  (select count(*)::int from public.payment_transactions where provider_ref = 'pay_1'),
  1,
  'A35 the ledger still holds exactly ONE row for that provider payment'
);

select is(
  (select ignored_reason from public.payment_events where event_id = 'evt_charge_1_forged_id'),
  'money_effect_already_recorded',
  'A35 ledger_conflict_is_already_applied_not_5xx — classified, so the retry budget is not burned'
);

select is(
  (select sum(amount_minor)::int from public.payment_transactions
    where subscription_id = (select id from public.subscriptions where provider_ref = 'sub_recovered')),
  49900,
  'A35 no double revenue: the ledger total is one charge'
);

-- =====================================================================
-- SECTION 6 — the ledger is append-only (F6)
--
-- Money history that can be edited is not evidence. The trigger is the
-- reason a compromised service role cannot quietly rewrite a total.
-- =====================================================================

select throws_ok(
  $$ update public.payment_transactions set amount_minor = 1 where provider_ref = 'pay_1' $$,
  null, null,
  'F6 ledger rows cannot be UPDATEd'
);

select throws_ok(
  $$ delete from public.payment_transactions where provider_ref = 'pay_1' $$,
  null, null,
  'F6 ledger rows cannot be DELETEd'
);

-- =====================================================================
-- SECTION 7 — D13 grace, A8 ordering, A9 illegal transitions
-- =====================================================================

select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_failed_1',
    p_provider_event_type => 'subscription.pending', p_kind => 'payment_failed',
    p_provider_ref => 'sub_recovered', p_subscription_ref => 'sub_recovered',
    p_occurred_at => now() - interval '8 minutes',
    p_grace_days => 3
  ) ->> 'status',
  'past_due',
  'D13 a failed renewal moves to past_due, not straight to revoked'
);

select ok(
  (select grace_until > now() from public.accounts
    where id = '00000000-0000-4000-8000-0000000000a1'),
  'D13 entering past_due opens the grace window'
);

select is(
  (select plan_id from public.accounts where id = '00000000-0000-4000-8000-0000000000a1'),
  'zz_test_pro',
  'D13 a past_due account KEEPS its plan during grace — no data or access is deleted'
);

-- A8: an old `activated` replayed after the failure. Last-write-wins
-- would silently restore full entitlement.
select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_stale_activated',
    p_provider_event_type => 'subscription.activated', p_kind => 'activated',
    p_provider_ref => 'sub_recovered', p_subscription_ref => 'sub_recovered',
    p_occurred_at => now() - interval '60 minutes'
  ) ->> 'reason',
  'stale_event_out_of_order',
  'A8 stale_event_is_ignored — an older delivery cannot overwrite newer state'
);

select is(
  (select status from public.subscriptions where provider_ref = 'sub_recovered'),
  'past_due',
  'A8 the stale replay left the status where it was'
);

-- Recovery: a genuinely newer successful debit must be able to come
-- back. `halted -> past_due` (not a terminal state) exists precisely so
-- this path is reachable.
select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_recover_1',
    p_provider_event_type => 'subscription.activated', p_kind => 'activated',
    p_provider_ref => 'sub_recovered', p_subscription_ref => 'sub_recovered',
    p_occurred_at => now() - interval '5 minutes'
  ) ->> 'status',
  'active',
  '5.3d past_due recovers to active on a later successful debit'
);

select ok(
  (select grace_until is null from public.accounts
    where id = '00000000-0000-4000-8000-0000000000a1'),
  'D13 recovery clears the grace window'
);

-- A12: a chargeback is money, not a lifecycle decision. Conflating the
-- two is how a dispute silently revokes (or silently preserves) access.
select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_chargeback_1',
    p_provider_event_type => 'payment.dispute.created', p_kind => 'charged_back',
    p_provider_ref => 'disp_1', p_subscription_ref => 'sub_recovered',
    p_amount_minor => 49900, p_currency => 'INR',
    p_occurred_at => now() - interval '4 minutes'
  ) ->> 'reason',
  'money_event_no_status_change',
  'A12 chargeback_is_recorded_without_implicit_entitlement_change'
);

select is(
  (select amount_minor from public.payment_transactions where provider_ref = 'disp_1'),
  -49900,
  'D8 a chargeback is a NEGATIVE ledger row (sign discipline, never a deletion)'
);

select is(
  (select status from public.subscriptions where provider_ref = 'sub_recovered'),
  'active',
  'A12 the dispute alone did not move the subscription status'
);

-- A26: the OTHER half of A12 — the provider's lifecycle event is what
-- revokes, through the same RPC.
select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_halted_1',
    p_provider_event_type => 'subscription.halted', p_kind => 'payment_failed',
    p_provider_ref => 'sub_recovered', p_subscription_ref => 'sub_recovered',
    p_occurred_at => now() - interval '3 minutes'
  ) ->> 'status',
  'past_due',
  'A26 provider_halted_after_chargeback_revokes_entitlement — via the same RPC, not a side channel'
);

select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_cancelled_1',
    p_provider_event_type => 'subscription.cancelled', p_kind => 'canceled',
    p_provider_ref => 'sub_recovered', p_subscription_ref => 'sub_recovered',
    p_occurred_at => now() - interval '2 minutes'
  ) ->> 'status',
  'canceled',
  'cancellation is applied'
);

select is(
  (select plan_id from public.accounts where id = '00000000-0000-4000-8000-0000000000a1'),
  (select default_plan_id from t_fix),
  'entitlement falls back to the is_default plan — resolved, never a hardcoded literal'
);

-- A9: terminal states absorb everything. A permissive default branch
-- here is a free upgrade.
select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_resurrect_1',
    p_provider_event_type => 'subscription.activated', p_kind => 'activated',
    p_provider_ref => 'sub_recovered', p_subscription_ref => 'sub_recovered',
    p_occurred_at => now()
  ) ->> 'reason',
  'terminal_state',
  'A9 illegal_transition_rejected — no event revives a canceled subscription'
);

select is(
  (select plan_id from public.accounts where id = '00000000-0000-4000-8000-0000000000a1'),
  (select default_plan_id from t_fix),
  'A9 the resurrection attempt granted nothing'
);

select is(
  (select status from public.payment_events where event_id = 'evt_resurrect_1'),
  'ignored',
  'A9 the illegal transition is RECORDED and ignored, never silently dropped'
);

-- =====================================================================
-- SECTION 8 — A20: rollback on a mid-apply failure
--
-- Removing the default plan makes the entitlement step raise. Nothing —
-- not the claim, not the status change — may survive.
-- =====================================================================

insert into public.checkout_intents
  (id, account_id, plan_id, interval, provider, environment, amount_minor, currency, status, provider_ref)
values
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000a1',
   'zz_test_pro', 'monthly', 'razorpay', 'live', 49900, 'INR', 'created', 'sub_rollback');

select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_rb_activate',
    p_provider_event_type => 'subscription.activated', p_kind => 'activated',
    p_provider_ref => 'sub_rollback', p_subscription_ref => 'sub_rollback',
    p_correlation_intent_id => '00000000-0000-4000-8000-0000000000c4',
    p_occurred_at => now()
  ) ->> 'status',
  'active',
  'fixture: a second subscription is live before the rollback test'
);

-- Not a DELETE: accounts.plan_id references plans, so unsetting the
-- flag is the minimal way to produce "no default configured".
update public.plans set is_default = false where is_default;

select throws_ok(
  $$ select public.process_payment_event(
       p_provider => 'razorpay', p_environment => 'live',
       p_event_environment => 'live', p_event_id => 'evt_rb_cancel',
       p_provider_event_type => 'subscription.cancelled', p_kind => 'canceled',
       p_provider_ref => 'sub_rollback', p_subscription_ref => 'sub_rollback',
       p_occurred_at => now()) $$,
  'P0002', null,
  'A20 with no default plan the RPC REFUSES to guess an entitlement'
);

select is(
  (select count(*)::int from public.payment_events where event_id = 'evt_rb_cancel'),
  0,
  'A20 partial_apply_rolls_back — the claim rolled back with the failed apply'
);

select is(
  (select status from public.subscriptions where provider_ref = 'sub_rollback'),
  'active',
  'A20 no half-applied state: the subscription was not left canceled with a paid plan'
);

update public.plans set is_default = true
where id = (select default_plan_id from t_fix);

-- =====================================================================
-- SECTION 9 — A14 / A15: entitlement inputs payments may NOT own
-- =====================================================================

insert into public.checkout_intents
  (id, account_id, plan_id, interval, provider, environment, amount_minor, currency, status, provider_ref)
values
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000a2',
   'zz_test_pro', 'monthly', 'razorpay', 'live', 49900, 'INR', 'created', 'sub_manual');

select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_manual_1',
    p_provider_event_type => 'subscription.cancelled', p_kind => 'canceled',
    p_provider_ref => 'sub_manual', p_subscription_ref => 'sub_manual',
    p_correlation_intent_id => '00000000-0000-4000-8000-0000000000c5',
    p_occurred_at => now()
  ) ->> 'reason',
  'manual_billing_account',
  'A14 manual_account_never_auto_downgraded'
);

select is(
  (select plan_id from public.accounts where id = '00000000-0000-4000-8000-0000000000a2'),
  'zz_test_pro',
  'A14 the invoice-billed tenant kept its plan'
);

select is(
  (select count(*)::int from public.payment_transactions
    where account_id = '00000000-0000-4000-8000-0000000000a2'),
  0,
  'D16 a manual account accrues no self-serve money rows either'
);

-- A15: the override is the strongest entitlement we grant. A downgrade
-- must not be able to launder it away.
insert into public.subscriptions
  (account_id, plan_id, provider, environment, provider_ref, status, interval, amount_minor, currency)
values
  ('00000000-0000-4000-8000-0000000000a3', 'zz_test_pro', 'razorpay', 'live',
   'sub_override', 'active', 'monthly', 49900, 'INR');

select is(
  public.process_payment_event(
    p_provider => 'razorpay', p_environment => 'live',
    p_event_environment => 'live', p_event_id => 'evt_override_cancel',
    p_provider_event_type => 'subscription.cancelled', p_kind => 'canceled',
    p_provider_ref => 'sub_override', p_subscription_ref => 'sub_override',
    p_occurred_at => now()
  ) ->> 'status',
  'canceled',
  'the override account is downgraded at the PLAN level'
);

select ok(
  (select unlimited_all from public.account_limit_overrides
    where account_id = '00000000-0000-4000-8000-0000000000a3'),
  'A15 override_survives_downgrade — payments never write account_limit_overrides'
);

-- =====================================================================
-- SECTION 10 — A7: one live subscription, one open intent
--
-- The primary defense is the INTENT index, because it fires before the
-- provider is ever called. The subscriptions index is the backstop that
-- only fires after money has already moved — useful, but too late to be
-- the only one.
-- =====================================================================

select has_index('public', 'checkout_intents', 'checkout_intents_one_open_per_account',
  'A7 primary: partial unique index on open checkout_intents exists');
select index_is_unique('public', 'checkout_intents', 'checkout_intents_one_open_per_account',
  'A7 primary: and it is UNIQUE');

select has_index('public', 'subscriptions', 'subscriptions_one_live_per_account',
  'A7 backstop: partial unique index on live subscriptions exists');
select index_is_unique('public', 'subscriptions', 'subscriptions_one_live_per_account',
  'A7 backstop: and it is UNIQUE');

insert into public.checkout_intents
  (id, account_id, plan_id, interval, provider, environment, amount_minor, currency, status)
values
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000a3',
   'zz_test_pro', 'monthly', 'razorpay', 'live', 49900, 'INR', 'created');

select throws_ok(
  $$ insert into public.checkout_intents
       (account_id, plan_id, interval, provider, environment, amount_minor, currency, status)
     values ('00000000-0000-4000-8000-0000000000a3', 'zz_test_pro', 'monthly',
             'razorpay', 'live', 49900, 'INR', 'created') $$,
  '23505', null,
  'A7 concurrent_checkouts_create_one_provider_subscription — the loser cannot open a second intent'
);

insert into public.subscriptions
  (account_id, plan_id, provider, environment, provider_ref, status, interval, amount_minor, currency)
values
  ('00000000-0000-4000-8000-0000000000a3', 'zz_test_pro', 'razorpay', 'live',
   'sub_live_dup_a', 'active', 'monthly', 49900, 'INR');

select throws_ok(
  $$ insert into public.subscriptions
       (account_id, plan_id, provider, environment, provider_ref, status, interval, amount_minor, currency)
     values ('00000000-0000-4000-8000-0000000000a3', 'zz_test_pro', 'razorpay', 'live',
             'sub_live_dup_b', 'past_due', 'monthly', 49900, 'INR') $$,
  '23505', null,
  'A7 one_live_subscription_per_account — active and past_due both count as live'
);

-- =====================================================================
-- SECTION 11 — A24: reconciliation cursors are per environment
--
-- One cursor row per provider would let a test-mode run drag the live
-- cursor past unprocessed live subscriptions.
-- =====================================================================

insert into public.billing_reconciliation_state (provider, environment, cursor)
values ('razorpay', 'live', 'cursor_live_1'), ('razorpay', 'test', 'cursor_test_1');

select is(
  (select count(*)::int from public.billing_reconciliation_state where provider = 'razorpay'),
  2,
  'A24 reconcile_cursor_is_per_environment — live and test cursors coexist'
);

select throws_ok(
  $$ insert into public.billing_reconciliation_state (provider, environment, cursor)
     values ('razorpay', 'live', 'cursor_live_2') $$,
  '23505', null,
  'A24 (provider, environment) is the primary key, so a cursor cannot fork'
);

-- =====================================================================
-- SECTION 12 — A19: cross-tenant reads
--
-- Asserted through the POLICY and the membership helper rather than by
-- switching roles: pgTAP keeps its bookkeeping in temp objects owned by
-- the test role, so a `set role authenticated` mid-suite fails for
-- reasons that have nothing to do with billing.
-- =====================================================================

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'payment_transactions'
      and cmd = 'SELECT' and qual like '%is_account_member%'),
  1,
  'A19 payment_transactions SELECT is gated by is_account_member'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'payment_transactions'
      and cmd <> 'SELECT'),
  0,
  'F6/F9 the ledger is SELECT-only through RLS — no client INSERT/UPDATE/DELETE policy exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.payment_transactions'::regclass),
  'A19 RLS is enabled on payment_transactions'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass),
  'A19 RLS is enabled on subscriptions'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.payment_events'::regclass),
  'A19 RLS is enabled on payment_events'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'payment_events'),
  0,
  'F7 payment_events has NO client-facing policy at all — raw provider forensics are service-role only'
);

-- The helper itself, under an impersonated session. auth.uid() reads a
-- GUC, so this needs no role switch.
set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-0000000000b4"}';

select ok(
  not public.is_account_member('00000000-0000-4000-8000-0000000000a1'::uuid),
  'A19 cross_tenant_ledger_read_blocked — an outsider is not a member of the paying account'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-0000000000b1"}';

select ok(
  public.is_account_member('00000000-0000-4000-8000-0000000000a1'::uuid),
  'A19 control: the real owner IS a member (the policy is not blanket-false)'
);

select ok(
  not public.is_account_member('00000000-0000-4000-8000-0000000000a3'::uuid),
  'A19 and that owner still cannot reach another tenant'
);

reset "request.jwt.claims";

-- =====================================================================
-- SECTION 13 — F7: the audit trail carries ids, never payloads
-- =====================================================================

select ok(
  (select count(*) > 0 from public.audit_events
    where account_id = '00000000-0000-4000-8000-0000000000a1'
      and action like 'billing.subscription.%'),
  'every applied transition wrote an audit row'
);

select ok(
  (select bool_and(actor_id is null and actor_label like 'billing:%')
     from public.audit_events
    where account_id = '00000000-0000-4000-8000-0000000000a1'
      and action like 'billing.subscription.%'),
  'F7 provider-caused rows have no human actor, and say who caused them'
);

select ok(
  (select bool_and(
            not (meta ? 'payload')
            and not (meta ? 'card')
            and not (meta ? 'vpa')
            and not (meta ? 'signature'))
     from public.audit_events
    where account_id = '00000000-0000-4000-8000-0000000000a1'
      and action like 'billing.subscription.%'),
  'F7 audit meta carries ids and statuses only — no payload, no instrument data'
);

select * from finish();

-- Fixtures are never committed. See the header: this is hygiene, not a
-- safety mechanism.
rollback;

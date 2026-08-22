// ============================================================
// GET /api/cron/billing-reconcile — ADR-009 Task 10 (D13, D14).
//
// The SECOND and last trusted caller of `process_payment_event`, and the
// only repair path for a webhook that never arrived. Everything the
// webhook route is careful about applies here verbatim:
//
//   - entitlement moves ONLY through the RPC (no table write here);
//   - the environment gate gets a real two-trust-level pair — the
//     configured value from `paymentsEnvironment()` and the observed one
//     stamped on the provider read (4.1c, attack A30);
//   - a tenant is never invented from provider data (F3): this sweep
//     only ever re-reads subscriptions WE already own.
//
// AUTH IS THE ENTIRE PERIMETER. `authorizeCronRequest` is the same
// matrix `/api/flows/cron` uses and it fails CLOSED (503) when no secret
// is configured. An unauthenticated caller here could drive provider
// reads and entitlement transitions at will.
//
// BUDGETS ARE A CORRECTNESS PROPERTY, NOT A PERFORMANCE ONE. Workers
// allow ~50 subrequests per invocation, so an unbounded loop does not
// reconcile "everything slowly" — it gets killed mid-flight with the
// cursor unsaved and reconciles NOTHING, every run, forever. Hence the
// hard per-run cap plus the DURABLE cursor in
// `billing_reconciliation_state` (a module-level cursor would reset on
// every cold start and re-scan the head for eternity).
//
// All decision logic lives in `reconcile.ts` as pure functions over
// injected dependencies; this file is wiring plus SQL and holds no
// policy of its own.
// ============================================================

import { NextResponse } from 'next/server';

import { authorizeCronRequest } from '@/features/flows/lib/cron-auth';
import { processPaymentEvent } from '@/features/billing/lib/process-payment-event';
import {
  getPaymentProvider,
  parsePaymentEnvironment,
} from '@/features/billing/lib/provider-factory';
import {
  RECONCILABLE_STATUSES,
  RECONCILE_MAX_PROVIDER_CALLS,
  reconcileOnce,
  type ReconcileCandidate,
} from '@/features/billing/lib/reconcile';
import { billingAdminDb } from '@/features/billing/repositories/client';
import { cronAuthEnv, paymentsEnvironment, paymentsProvider } from '@/lib/env';
import type {
  PaymentEnvironment,
  SubscriptionStatus,
} from '@/lib/ports/payment-provider';

/**
 * How long an intent may stay open before the sweep closes it (7.8).
 *
 * TWO WINDOWS, DELIBERATELY DIFFERENT — and this is a safety decision,
 * not a tuning knob:
 *
 *  - `created` has NO provider_ref, so no provider object exists that
 *    could ever resolve through it. A day is plenty.
 *
 *  - `provider_attached` DOES have a provider object behind it, and the
 *    provider retries a failed delivery for up to 24 hours. Closing
 *    such an intent at the 24-hour mark races the provider's own last
 *    retry, and the loser is a paying customer whose tenant can no
 *    longer be resolved. So it is held well clear of that window.
 *
 * (ADR-009 7.8 states 24 h for both; the split is the same rule applied
 * with the provider's documented retry budget accounted for. Recorded in
 * the progress log for the ADR follow-up.)
 */
const ABANDON_CREATED_AFTER_HOURS = 24;
const ABANDON_ATTACHED_AFTER_HOURS = 24 * 7;

/** Hard cap on rows touched by the intent sweep, for the same reason
 *  the reconcile loop is capped: a bounded run beats a killed one. */
const ABANDON_SWEEP_LIMIT = 100;

/** Row shape of the candidate query, with the joined account fields. */
interface CandidateRow {
  id: string;
  account_id: string;
  provider: string;
  environment: string;
  provider_ref: string;
  status: string;
  accounts:
    | { billing_mode: string | null; grace_until: string | null }
    | { billing_mode: string | null; grace_until: string | null }[]
    | null;
}

export async function GET(request: Request) {
  // 10.1 — same auth matrix as the flow-engine scheduler, unit-tested in
  // `cron-auth.ts`. Fails closed when unconfigured.
  const auth = authorizeCronRequest(
    {
      authorization: request.headers.get('authorization'),
      xCronSecret: request.headers.get('x-cron-secret'),
    },
    cronAuthEnv()
  );
  if (auth.status !== 200) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const configuredProvider = paymentsProvider();
  const configuredEnvironment = parsePaymentEnvironment(paymentsEnvironment());

  // Payments dormant ⇒ nothing to reconcile, and that is a correct,
  // quiet 200. Unlike the webhook endpoint (which alerts, because real
  // provider traffic reaching an unconfigured deployment means money is
  // being dropped), a cron tick on a dormant deployment is expected and
  // carries no signal.
  if (!configuredProvider || !configuredEnvironment) {
    return NextResponse.json({ skipped: 'payments_dormant' });
  }

  const admin = billingAdminDb();

  // The cron never creates a checkout, so it has no legitimate use for a
  // plan-ref resolver. Supplying one that throws keeps that structural
  // rather than conventional.
  const provider = getPaymentProvider({
    resolveProviderPlanRef: async () => {
      throw new Error(
        'reconciliation must never create a checkout — no plan ref resolution here'
      );
    },
  });

  // A Noop provider (partial credentials) would throw on the first read.
  // Detect it by id rather than by catching, so a misconfiguration is a
  // clean signal instead of an exception storm.
  if (provider.id !== configuredProvider) {
    console.error(
      '[billing/reconcile] payments are configured but the provider could not be constructed',
      JSON.stringify({
        alert: 'BILLING_RECONCILE_PROVIDER_UNAVAILABLE',
        configuredProvider,
        environment: configuredEnvironment,
      })
    );
    return NextResponse.json(
      { error: 'payments_unavailable' },
      { status: 503 }
    );
  }

  // Durable cursor (1.3). Keyed per (provider, environment) so a
  // test-mode run can never drag the live cursor into a different id
  // space (attack A24).
  const { data: stateRow, error: stateError } = await admin
    .from('billing_reconciliation_state')
    .select('cursor')
    .eq('provider', provider.id)
    .eq('environment', configuredEnvironment)
    .maybeSingle();

  if (stateError) {
    console.error(
      '[billing/reconcile] cursor read failed',
      JSON.stringify({ reason: stateError.message })
    );
    return NextResponse.json({ error: 'cursor_unavailable' }, { status: 500 });
  }

  const startedAt = Date.now();

  try {
    const summary = await reconcileOnce({
      configuredEnvironment: configuredEnvironment as PaymentEnvironment,
      provider: provider.id,
      initialCursor: stateRow?.cursor ?? null,

      loadCandidates: async (cursor, limit) => {
        let query = admin
          .from('subscriptions')
          .select(
            'id, account_id, provider, environment, provider_ref, status, accounts!inner ( billing_mode, grace_until )'
          )
          .eq('provider', provider.id)
          // Scoped to the configured environment: a live run must not
          // read test-mode refs with live credentials, which would 404
          // at best and match an unrelated subscription at worst.
          .eq('environment', configuredEnvironment)
          .in('status', RECONCILABLE_STATUSES as unknown as string[])
          .order('id', { ascending: true })
          .limit(limit);

        // Keyset pagination on the primary key. `offset` would drift as
        // rows change status underneath a paging run and silently skip
        // subscriptions.
        if (cursor) query = query.gt('id', cursor);

        const { data, error } = await query;
        if (error) {
          throw new Error(`candidate page failed: ${error.message}`);
        }

        return (data ?? []).map((row) => toCandidate(row as CandidateRow));
      },

      fetchSubscription: (providerRef) => provider.fetchSubscription(providerRef),

      applyEvent: (event) =>
        processPaymentEvent(admin, {
          provider: provider.id,
          // TRUSTED: this deployment's configured mode, from env.
          configuredEnvironment: configuredEnvironment as PaymentEnvironment,
          // OBSERVED: the credential set the provider read used, stamped
          // by the adapter. Two independently-sourced facts, which is
          // the only reason the gate inside the RPC checks anything.
          event,
        }),

      saveCursor: async ({ cursor, lastStatus, orphansSeen }) => {
        const { error } = await admin.from('billing_reconciliation_state').upsert(
          {
            provider: provider.id,
            environment: configuredEnvironment,
            cursor,
            last_run_at: new Date().toISOString(),
            last_status: lastStatus,
            orphans_seen: orphansSeen,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'provider,environment' }
        );
        if (error) {
          // Losing the cursor is not cosmetic: the next run re-scans from
          // the same place and the tail is never reached. Surface it.
          throw new Error(`cursor write failed: ${error.message}`);
        }
      },

      log: (message, details) => {
        console.warn(`[billing/reconcile] ${message}`, JSON.stringify(details));
      },
    });

    const abandoned = await sweepAbandonedIntents(
      admin,
      provider.id,
      configuredEnvironment
    );

    console.log(
      '[billing/reconcile] run complete',
      JSON.stringify({
        provider: provider.id,
        environment: configuredEnvironment,
        examined: summary.examined,
        providerCalls: summary.providerCalls,
        driftApplied: summary.driftApplied,
        graceExpired: summary.graceExpired,
        skippedManual: summary.skippedManual,
        unreadable: summary.unreadable,
        abandonedIntents: abandoned,
        cursor: summary.cursor,
        ms: Date.now() - startedAt,
      })
    );

    return NextResponse.json({
      examined: summary.examined,
      providerCalls: summary.providerCalls,
      driftApplied: summary.driftApplied,
      graceExpired: summary.graceExpired,
      skippedManual: summary.skippedManual,
      unreadable: summary.unreadable,
      abandonedIntents: abandoned,
      cursor: summary.cursor,
      cap: RECONCILE_MAX_PROVIDER_CALLS,
    });
  } catch (err) {
    // Fail closed and LOUD. A silently-failing reconciliation is the
    // worst outcome available: the webhook path already lost the event,
    // and this was the safety net. The next tick retries from the same
    // cursor.
    console.error(
      '[billing/reconcile] run failed',
      JSON.stringify({
        alert: 'BILLING_RECONCILE_FAILED',
        provider: provider.id,
        environment: configuredEnvironment,
        // Message only. Never a payload, never a credential (F7).
        reason: err instanceof Error ? err.message : 'unknown',
      })
    );
    return NextResponse.json({ error: 'reconcile_failed' }, { status: 500 });
  }
}

/**
 * Map the joined row into the pure module's candidate shape.
 *
 * `billing_mode` defaults to `manual` when the join produced nothing
 * readable. That is the FAIL-CLOSED direction here: `manual` means "skip
 * this subscription entirely", so an unreadable account can only ever
 * cost us a reconcile pass — never an entitlement change made on
 * incomplete information. (Note the opposite polarity to the quota
 * engine, which fails open on purpose; see `src/lib/quotas/index.ts`.)
 */
function toCandidate(row: CandidateRow): ReconcileCandidate {
  const account = Array.isArray(row.accounts) ? row.accounts[0] : row.accounts;

  return {
    id: row.id,
    accountId: row.account_id,
    provider: row.provider,
    environment: row.environment as PaymentEnvironment,
    providerRef: row.provider_ref,
    status: row.status as SubscriptionStatus,
    graceUntil: account?.grace_until ?? null,
    billingMode: account?.billing_mode ?? 'manual',
  };
}

/**
 * 7.8 — close intents nobody is going to finish.
 *
 * These rows are EVIDENCE, not garbage: they are the audit trail proving
 * the amount we quoted came from our own `plans` table. The sweep only
 * moves `status`; it never deletes, and it never touches `provider_ref`
 * (which is what a late webhook resolves a tenant through).
 *
 * Returns the number of rows closed. A failure here is logged and
 * swallowed on purpose — housekeeping must not fail a run whose actual
 * job (entitlement repair) already succeeded.
 */
async function sweepAbandonedIntents(
  admin: ReturnType<typeof billingAdminDb>,
  provider: string,
  environment: string
): Promise<number> {
  const now = Date.now();
  const hoursAgo = (hours: number) =>
    new Date(now - hours * 60 * 60 * 1000).toISOString();

  let closed = 0;

  for (const [status, cutoff] of [
    ['created', hoursAgo(ABANDON_CREATED_AFTER_HOURS)],
    ['provider_attached', hoursAgo(ABANDON_ATTACHED_AFTER_HOURS)],
  ] as const) {
    // Two statements rather than one `update … limit`, because
    // supabase-js cannot bound an update. Selecting the ids first keeps
    // the write set explicitly capped.
    const { data, error } = await admin
      .from('checkout_intents')
      .select('id')
      .eq('provider', provider)
      .eq('environment', environment)
      .eq('status', status)
      .lt('created_at', cutoff)
      .limit(ABANDON_SWEEP_LIMIT);

    if (error) {
      console.warn(
        '[billing/reconcile] abandoned-intent scan failed',
        JSON.stringify({ status, reason: error.message })
      );
      continue;
    }

    const ids = (data ?? []).map((row) => row.id as string);
    if (ids.length === 0) continue;

    const { data: updated, error: updateError } = await admin
      .from('checkout_intents')
      .update({ status: 'abandoned', updated_at: new Date().toISOString() })
      .in('id', ids)
      // Re-assert the status in the WHERE clause so a checkout that
      // completed between the scan and this write is not clobbered.
      .eq('status', status)
      .select('id');

    if (updateError) {
      console.warn(
        '[billing/reconcile] abandoned-intent sweep failed',
        JSON.stringify({ status, reason: updateError.message })
      );
      continue;
    }

    closed += updated?.length ?? 0;
  }

  return closed;
}

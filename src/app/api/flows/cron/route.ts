import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/features/flows/lib/admin-client';
import { resolveFallbackPolicy } from '@/features/flows/lib/fallback';
import {
  resumeWaitingRuns,
  startScheduledFlows,
} from '@/features/flows/lib/engine';

/**
 * Sweep abandoned active flow runs.
 *
 * Reads each active run's parent-flow `fallback_policy.on_timeout_hours`
 * to compute the staleness cutoff (default 24h), then marks any run
 * past its cutoff as `timed_out`. Writes a matching `flow_run_events`
 * row for the audit trail.
 *
 * Without this sweep, a customer who abandons a flow mid-conversation
 * keeps a row in `idx_one_active_run_per_contact` (the partial unique
 * index on `flow_runs WHERE status='active'`) forever — blocking any
 * new triggers for them. The cron is therefore not optional.
 *
 * Auth: `AUTOMATION_CRON_SECRET` (name kept for operator continuity
 * after the legacy automations module was absorbed into flows). This
 * is the single cron endpoint for the workflow engine: it resumes
 * waits, starts scheduled flows, and sweeps stale runs in one tick.
 *
 * Hosting: hit on a schedule (Vercel Cron / GitHub Actions / external
 * pinger). A 5-minute interval is more than enough for a 24h timeout
 * default; once per hour would also be acceptable for low-volume
 * tenants.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  // Constant-time compare so an attacker who can hit the endpoint
  // can't recover the secret byte-by-byte from response-time deltas.
  // Length pre-check is required by timingSafeEqual (throws otherwise)
  // and leaks only the length itself, which isn't sensitive.
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Wake `wait`-parked runs first — a run that both woke late AND
  // aged past the stale cutoff should get its chance to advance
  // before the stale sweep times it out.
  const { resumed } = await resumeWaitingRuns();

  // Then start any scheduled flows whose HH:mm window covers this
  // tick (dedupe inside guarantees one run per contact per period).
  const { started: scheduled } = await startScheduledFlows();

  const admin = supabaseAdmin();
  const now = new Date();

  // Pull all currently-active runs along with their parent flow's
  // fallback_policy. Joined in one query — the small set of active
  // runs per tenant keeps this cheap.
  const { data: runs, error } = await admin
    .from('flow_runs')
    .select(
      'id, flow_id, user_id, contact_id, last_advanced_at, flows ( fallback_policy )'
    )
    .eq('status', 'active');

  if (error) {
    console.error('[flows-cron] active-run scan failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!runs?.length) {
    return NextResponse.json({ swept: 0, resumed, scheduled });
  }

  type Row = {
    id: string;
    flow_id: string;
    user_id: string;
    contact_id: string | null;
    last_advanced_at: string;
    flows: { fallback_policy: unknown } | { fallback_policy: unknown }[] | null;
  };

  let swept = 0;
  for (const r of runs as Row[]) {
    const flowsField = Array.isArray(r.flows) ? r.flows[0] : r.flows;
    const policy = resolveFallbackPolicy(flowsField?.fallback_policy ?? null);
    const lastAdvanced = new Date(r.last_advanced_at);
    const ageHours =
      (now.getTime() - lastAdvanced.getTime()) / (1000 * 60 * 60);
    if (ageHours < policy.on_timeout_hours) continue;

    // Mark timed_out — guarded by the precondition `status='active'`
    // so concurrent advance from a late inbound doesn't overwrite a
    // legitimate update.
    const { data: updated } = await admin
      .from('flow_runs')
      .update({
        status: 'timed_out',
        ended_at: now.toISOString(),
        end_reason: 'stale_sweep',
      })
      .eq('id', r.id)
      .eq('status', 'active')
      .select('id');

    if (Array.isArray(updated) && updated.length > 0) {
      await admin.from('flow_run_events').insert({
        flow_run_id: r.id,
        event_type: 'timeout',
        payload: {
          age_hours: Math.round(ageHours * 10) / 10,
          policy_hours: policy.on_timeout_hours,
        },
      });
      swept += 1;
    }
  }

  return NextResponse.json({ swept, resumed, scheduled });
}

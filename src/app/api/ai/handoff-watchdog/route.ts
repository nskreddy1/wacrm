import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeCronRequest } from '@/features/flows/lib/cron-auth';
import { cronAuthEnv } from '@/lib/env';
import { sweepOverdueHandoffs } from '@/features/assistant/lib/ai/handoff-watchdog';

/**
 * Unattended-handoff watchdog tick.
 *
 * The caretaker holds the *customer*; this closes the *internal* half of
 * the loop by nudging humans when an escalated thread goes unanswered,
 * then pulling in the wider team if the assignee stays silent.
 *
 * Auth: reuses the flows cron matrix, which accepts two transports —
 * a Bearer `CRON_SECRET` (Vercel Cron) or an `x-cron-secret` header
 * (`AUTOMATION_CRON_SECRET`). The second one matters here: Vercel's
 * Hobby plan only allows once-daily crons, which is useless for a
 * 10-minute SLA, so the intended driver is Supabase `pg_cron` +
 * `pg_net` posting this endpoint every minute with that header. The
 * endpoint is deliberately transport-agnostic so either can drive it.
 *
 * Idempotent by construction: the SQL side enforces a re-notify
 * cool-off, so a 1-minute schedule cannot spam anybody.
 */
export async function GET(request: Request) {
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

  try {
    const result = await sweepOverdueHandoffs(supabaseAdmin());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Never 500 at a scheduler: pg_cron has no retry/backoff, and a
    // failing job just fills `cron.job_run_details` with noise. Log and
    // report so the next tick simply tries again.
    console.error('[handoff-watchdog] sweep threw:', err);
    return NextResponse.json(
      { ok: false, error: 'sweep failed' },
      { status: 200 }
    );
  }
}

/** pg_net's `http_post` is easier to schedule than a GET; same work. */
export const POST = GET;

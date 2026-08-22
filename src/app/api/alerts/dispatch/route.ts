import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeCronRequest } from '@/features/flows/lib/cron-auth';
import { cronAuthEnv } from '@/lib/env';
import { dispatchPendingAlerts } from '@/features/alerts/lib/dispatcher';

/**
 * Outbox dispatcher tick — drains `alert_deliveries` to the provider
 * adapters (team chat, Slack, ...).
 *
 * Same transport-agnostic cron auth as the handoff watchdog: Bearer
 * `CRON_SECRET` (Vercel Cron) or `x-cron-secret` header
 * (`AUTOMATION_CRON_SECRET`, used by Supabase pg_cron + pg_net on a
 * 1-minute schedule).
 *
 * Safe under overlap and at scale by construction:
 *  - each row is claimed with an optimistic CAS on `attempts`
 *  - UNIQUE(notification_id, destination_id) makes duplicate enqueues
 *    impossible upstream
 *  - BATCH_LIMIT bounds a tick; a backlog drains across ticks instead of
 *    melting one invocation
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
    const result = await dispatchPendingAlerts(supabaseAdmin());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Never 500 at a scheduler: pg_cron has no retry/backoff — log and
    // let the next tick pick the queue back up.
    console.error('[alerts dispatch] tick threw:', err);
    return NextResponse.json(
      { ok: false, error: 'dispatch failed' },
      { status: 200 }
    );
  }
}

/** pg_net's `http_post` is easier to schedule than a GET; same work. */
export const POST = GET;

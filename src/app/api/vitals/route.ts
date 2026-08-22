/**
 * /api/vitals — OUR custom Web Vitals telemetry (plan Task 6 Step 8).
 *
 * Two separate systems, deliberately (review §15):
 *   Cloudflare Web Analytics = third-party browser analytics
 *                              (analytics-provider.tsx, env-gated token)
 *   /api/vitals              = THIS route: web-vitals POSTs
 *                              (LCP/CLS/INP/TTFB/FCP) → logger → Loki
 * Either can be disabled without touching the other.
 *
 * Cost posture: rides the existing free Loki quota (50 GB/mo); no new
 * vendor, no new spend. Payload is validated and size-capped so the
 * endpoint cannot be used to pump arbitrary data into the logs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

const ALLOWED_METRICS = new Set(['LCP', 'CLS', 'INP', 'TTFB', 'FCP']);
const ALLOWED_RATINGS = new Set(['good', 'needs-improvement', 'poor']);
const MAX_BODY_BYTES = 2_048;

export async function POST(request: NextRequest) {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const metric = body as {
    name?: unknown;
    value?: unknown;
    rating?: unknown;
    path?: unknown;
    navigationType?: unknown;
  };

  if (
    typeof metric.name !== 'string' ||
    !ALLOWED_METRICS.has(metric.name) ||
    typeof metric.value !== 'number' ||
    !Number.isFinite(metric.value)
  ) {
    return NextResponse.json({ ok: false }, { status: 422 });
  }

  logger.info({
    msg: 'web-vital',
    metric: metric.name,
    value: Math.round(metric.value * 1000) / 1000,
    rating:
      typeof metric.rating === 'string' && ALLOWED_RATINGS.has(metric.rating)
        ? metric.rating
        : undefined,
    path:
      typeof metric.path === 'string' ? metric.path.slice(0, 200) : undefined,
    navigation_type:
      typeof metric.navigationType === 'string'
        ? metric.navigationType.slice(0, 40)
        : undefined,
  });

  // 204: nothing for the client to read; keepalive/sendBeacon friendly.
  return new NextResponse(null, { status: 204 });
}

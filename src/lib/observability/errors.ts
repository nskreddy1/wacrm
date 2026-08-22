/**
 * Error capture adapter (plan Task 6 Step 3, ADR-INFRA-001 §6).
 *
 * Feature code calls `captureError(err, context)` — never a vendor SDK
 * (ARCH-004). Behavior:
 *
 *   SENTRY_DSN absent → structured error log only (free, always on).
 *   SENTRY_DSN set    → ALSO fire-and-forget POST to Sentry's store
 *                       endpoint (Developer free tier: 5k errors/mo).
 *
 * DELIBERATE DEVIATION from the plan's "@sentry/nextjs" wording,
 * recorded in the execution log: the full SDK bundles Node transports
 * and OpenTelemetry weight that are unnecessary — and historically
 * fragile — inside Cloudflare Workers isolates, and it is not currently
 * installed. This adapter speaks Sentry's public store protocol over
 * plain fetch instead: zero dependencies, Workers-native, and because
 * ALL callers go through this facade, swapping in the official SDK
 * later is a one-file change (the point of the Facade pattern).
 */
import { logger } from './logger';
import { currentCorrelation, type Correlation } from './correlation';

function parseDsn(dsn: string): { endpoint: string; key: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    if (!u.username || !projectId) return null;
    return {
      endpoint: `${u.protocol}//${u.host}/api/${projectId}/store/`,
      key: u.username,
    };
  } catch {
    return null;
  }
}

export function captureError(
  err: unknown,
  context: Partial<Correlation> & Record<string, unknown> = {}
): void {
  const correlation = { ...currentCorrelation(), ...context };
  const error = err instanceof Error ? err : new Error(String(err));

  // Always: structured log (console + Loki when configured).
  logger.error(
    { ...correlation, error_name: error.name, stack: error.stack },
    error.message
  );

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  // Fire-and-forget (NFR-003): the request path never waits on Sentry.
  void fetch(parsed.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=auxelon-adapter/1.0`,
    },
    body: JSON.stringify({
      event_id: crypto.randomUUID().replaceAll('-', ''),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      release: process.env.RELEASE_VERSION ?? 'dev',
      environment: process.env.RELEASE_VERSION ? 'production' : 'development',
      exception: {
        values: [
          {
            type: error.name,
            value: error.message,
            stacktrace: error.stack
              ? { frames: [{ filename: 'see-log', function: error.stack.split('\n')[1]?.trim() ?? '' }] }
              : undefined,
          },
        ],
      },
      tags: {
        request_id: correlation.request_id ?? 'none',
        operation: correlation.operation ?? 'none',
        route: correlation.route ?? 'none',
      },
      extra: { account_id: correlation.account_id },
    }),
  }).catch(() => {
    // Already logged above; Sentry delivery is best-effort.
  });
}

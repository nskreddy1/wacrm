import { timingSafeEqual } from 'node:crypto';

/**
 * Authorization for the flow-engine scheduler endpoint.
 *
 * Extracted from the route handler so the auth matrix is unit-testable
 * without booting Next.js — this endpoint is the only thing standing
 * between the public internet and the workflow engine's admin-client
 * writes, so it gets real test coverage.
 */

export type CronAuthOutcome =
  | { status: 200 }
  | { status: 401; error: string }
  | { status: 503; error: string };

/**
 * Constant-time secret compare, so an attacker who can hit the endpoint
 * can't recover the secret byte-by-byte from response-time deltas.
 *
 * The length pre-check is required by `timingSafeEqual` (it throws on a
 * length mismatch) and leaks only the length, which isn't sensitive.
 */
export function secretMatches(supplied: string, expected: string): boolean {
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  return (
    suppliedBuf.length === expectedBuf.length &&
    timingSafeEqual(suppliedBuf, expectedBuf)
  );
}

/**
 * Two accepted callers, because **Vercel Cron cannot send custom headers**:
 *
 *  1. Vercel Cron → `Authorization: Bearer $CRON_SECRET`
 *  2. External pinger (GitHub Actions / uptime robot / curl)
 *     → `x-cron-secret: $AUTOMATION_CRON_SECRET`
 *
 * Either is sufficient. Each secret is only valid in its own transport —
 * presenting `AUTOMATION_CRON_SECRET` as a Bearer token is rejected, so a
 * leak in one channel doesn't silently authorize the other.
 *
 * If neither secret is configured we fail **closed** (503), never open.
 */
export function authorizeCronRequest(
  headers: { authorization?: string | null; xCronSecret?: string | null },
  env: {
    automationCronSecret?: string;
    vercelCronSecret?: string;
  }
): CronAuthOutcome {
  const automationSecret = env.automationCronSecret;
  const vercelCronSecret = env.vercelCronSecret;

  if (!automationSecret && !vercelCronSecret) {
    return { status: 503, error: 'cron not configured' };
  }

  const bearer = (headers.authorization ?? '').replace(/^Bearer\s+/i, '');

  const authorized =
    (!!vercelCronSecret && secretMatches(bearer, vercelCronSecret)) ||
    (!!automationSecret &&
      secretMatches(headers.xCronSecret ?? '', automationSecret));

  return authorized ? { status: 200 } : { status: 401, error: 'Unauthorized' };
}

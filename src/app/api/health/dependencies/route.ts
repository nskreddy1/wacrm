// READINESS (plan Task 5, ADR-INFRA-001 §6).
// Checks critical dependencies with short timeouts; degraded ≠ dead.
// Public payload is SANITIZED (review §12): name + ok + ms ONLY. Raw
// dependency errors go to the observability logger, never over the wire —
// error messages are implementation-detail leaks.
export const dynamic = 'force-dynamic';

type CheckResult = { name: string; ok: boolean; ms: number };

async function check(
  name: string,
  fn: () => Promise<unknown>,
  timeoutMs = 1500
): Promise<CheckResult> {
  const start = performance.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), timeoutMs)
      ),
    ]);
    return { name, ok: true, ms: Math.round(performance.now() - start) };
  } catch (err) {
    // Raw error → logger only (sanitized wire output).
    const { logger } = await import('@/lib/observability/logger');
    logger.warn(
      { operation: 'health.readiness', dependency: name },
      `readiness check failed: ${err instanceof Error ? err.message : 'unknown'}`
    );
    return { name, ok: false, ms: Math.round(performance.now() - start) };
  }
}

export async function GET() {
  const results = await Promise.all([
    check('database', async () => {
      const { sql } = await import('@/lib/db/sql');
      await sql`SELECT 1`;
    }),
    check('redis', async () => {
      // Redis is an OPTIONAL dependency (rate limiting / cache degrade to
      // in-memory fallbacks). Unconfigured = healthy-by-absence, so local
      // dev and minimal deploys don't read as degraded.
      if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
        return;
      }
      const { Redis } = await import('@upstash/redis');
      const redis = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
      await redis.ping();
    }),
  ]);
  const ok = results.every((r) => r.ok);
  return Response.json({ ok, checks: results }, { status: ok ? 200 : 503 });
}

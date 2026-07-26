/**
 * Tests run WITHOUT `KV_REST_API_URL`/`KV_REST_API_TOKEN`, exercising
 * the in-memory fallback — identical window semantics to the Redis
 * path. The outage suite proves that a Redis failure (network blip or
 * Upstash free-tier quota exhaustion) never throws into the request
 * path: the breaker trips once and enforcement continues in memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRateLimitForTests,
  checkRateLimit,
  rateLimitResponse,
} from './rate-limit';

const OPTS = { limit: 3, windowMs: 60_000 };

describe('checkRateLimit', () => {
  beforeEach(() => {
    // The dev environment has real Upstash credentials; without this
    // stub the tests would hit live Redis, where counters persist
    // across runs (shared 60s windows) and pollute each other.
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    __resetRateLimitForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('permits the first request and decrements remaining', async () => {
    const result = await checkRateLimit('user:1', OPTS);
    expect(result).toMatchObject({
      success: true,
      remaining: 2,
      limit: 3,
    });
    expect(result.reset).toBeGreaterThan(Date.now());
  });

  it('permits exactly `limit` requests then rejects the next', async () => {
    expect((await checkRateLimit('user:1', OPTS)).success).toBe(true);
    expect((await checkRateLimit('user:1', OPTS)).success).toBe(true);
    expect((await checkRateLimit('user:1', OPTS)).success).toBe(true);
    const over = await checkRateLimit('user:1', OPTS);
    expect(over.success).toBe(false);
    expect(over.remaining).toBe(0);
  });

  it('keeps separate counters per key', async () => {
    await checkRateLimit('user:1', OPTS);
    await checkRateLimit('user:1', OPTS);
    await checkRateLimit('user:1', OPTS);
    // user:1 is at the cap, user:2 should still be unaffected.
    const other = await checkRateLimit('user:2', OPTS);
    expect(other.success).toBe(true);
    expect(other.remaining).toBe(2);
  });

  it('opens a fresh window after `windowMs` elapses', async () => {
    vi.useFakeTimers();
    try {
      const t0 = new Date('2026-05-01T00:00:00Z').getTime();
      vi.setSystemTime(t0);
      __resetRateLimitForTests();

      await checkRateLimit('user:1', OPTS);
      await checkRateLimit('user:1', OPTS);
      await checkRateLimit('user:1', OPTS);
      expect((await checkRateLimit('user:1', OPTS)).success).toBe(false);

      // Jump just past the window.
      vi.setSystemTime(t0 + OPTS.windowMs + 1);
      const refreshed = await checkRateLimit('user:1', OPTS);
      expect(refreshed.success).toBe(true);
      expect(refreshed.remaining).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('redis outage / free-tier quota exhaustion', () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('never throws and keeps enforcing in memory when redis fails', async () => {
    // Env set so getRedis() constructs a client; every REST call then
    // fails — exactly what an exhausted Upstash free-tier quota does.
    vi.stubEnv('KV_REST_API_URL', 'https://fake.upstash.example');
    vi.stubEnv('KV_REST_API_TOKEN', 'fake-token');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('quota exceeded'));

    // Must not throw; request is served.
    const r1 = await checkRateLimit('user:q', OPTS);
    expect(r1.success).toBe(true);

    // Breaker tripped: redis not retried, counting continues in memory
    // and the limit is still enforced.
    const callsAfterTrip = fetchSpy.mock.calls.length;
    await checkRateLimit('user:q', OPTS);
    await checkRateLimit('user:q', OPTS);
    const over = await checkRateLimit('user:q', OPTS);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterTrip);
    expect(over.success).toBe(false);

    // One warning per trip — not one per request (no log spam).
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('rateLimitResponse', () => {
  it('returns a 429 with retry / X-RateLimit headers', async () => {
    const reset = Date.now() + 30_000;
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset,
      limit: 60,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rate limit/i);
  });

  it('clamps Retry-After to a minimum of 1 second', () => {
    // Reset already in the past — the ceiling math would otherwise give 0.
    const res = rateLimitResponse({
      success: false,
      remaining: 0,
      reset: Date.now() - 5_000,
      limit: 10,
    });
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });
});

describe('RATE_LIMITS presets', () => {
  it('send and broadcast budgets are independent', async () => {
    __resetRateLimitForTests();
    // Importing here so the presets stay close to their assertions.
    const { RATE_LIMITS } = await import('./rate-limit');
    expect(RATE_LIMITS.send.limit).toBeGreaterThan(RATE_LIMITS.broadcast.limit);
    expect(RATE_LIMITS.send.windowMs).toBe(60_000);
    expect(RATE_LIMITS.broadcast.windowMs).toBe(60_000);
  });
});

afterEach(() => {
  __resetRateLimitForTests();
});

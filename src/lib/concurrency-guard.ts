/**
 * Redis-backed ConcurrencyGuard adapter (Bulkhead, NFR-005) —
 * in-memory fallback, circuit breaker. Implements the port in
 * `src/lib/ports/concurrency-guard.ts`.
 *
 * Mirrors `src/lib/rate-limit.ts` deliberately: same Upstash client
 * config (retries: 1 so a dead Redis can't stall the hot path), same
 * breaker (one warning per cooldown, then quiet in-memory
 * enforcement), same free-tier posture (a pipeline = ONE REST call =
 * one command-quota unit of latency).
 *
 * SEMANTICS — a distributed counting semaphore:
 *   acquire: INCR per-key counter + INCR global counter (one
 *            pipeline). Either over its limit → undo (DECR both) and
 *            return false. A safety TTL is stamped on every acquire so
 *            a crashed invocation's leaked slot self-heals instead of
 *            wedging the bulkhead shut forever.
 *   release: DECR both (never throws — a failed release is healed by
 *            the TTL).
 *
 * FAILURE MODE — fails OPEN: this guard protects CAPACITY (provider
 * rate limits, spend), not authorization. If Redis is down, blocking
 * every AI reply platform-wide is strictly worse than briefly running
 * unguarded; per-account reply caps and rate limits still apply.
 *
 * COST (free-tier justification): the guard is wired around the AI
 * auto-reply generation call ONLY — 2 REST calls per actual LLM
 * generation (acquire pipeline + release pipeline), which is noise
 * next to the generation itself and bounded by the aiAutoReplyAccount
 * rate limit (30/min/account) upstream. No cost is added to non-AI
 * webhook traffic.
 */

import { Redis } from '@upstash/redis';
import type {
  ConcurrencyGuard,
  ConcurrencyLimits,
} from '@/lib/ports/concurrency-guard';

/**
 * Bulkhead limits for the AI auto-reply path.
 *
 * perAccount: an LLM generation takes 2–10 s; 3 IN FLIGHT at once per
 * account comfortably serves organic inbound (the 30/min rate limit
 * gates arrival rate) while stopping a marketing-blast stampede of one
 * tenant from queueing everyone else's replies behind its own.
 *
 * global: 25 concurrent generations across all tenants keeps the
 * platform far below any provider's concurrent-request ceiling and
 * bounds worst-case simultaneous spend. Raise when measured (scale
 * ladder §F) — it's a constant, not a rewrite.
 */
export const AI_GUARD_LIMITS: ConcurrencyLimits = {
  global: 25,
  perAccount: 3,
};

const PREFIX = 'cg:';
const GLOBAL_KEY = `${PREFIX}__global__`;

/** Safety TTL: far above any sane operation duration (LLM calls are
 *  seconds; the webhook route's maxDuration is 60 s), so it only ever
 *  fires to heal slots leaked by a crashed/frozen invocation. PEXPIRE
 *  on every acquire refreshes it while traffic flows. */
const SLOT_SAFETY_TTL_MS = 120_000;

/* ------------------------------------------------------------------ */
/* Redis backend                                                       */
/* ------------------------------------------------------------------ */

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  redisClient =
    url && token
      ? new Redis({ url, token, retry: { retries: 1, backoff: () => 100 } })
      : null;
  return redisClient;
}

const REDIS_COOLDOWN_MS = 60_000;
let redisDownUntil = 0;

async function acquireWithRedis(
  redis: Redis,
  key: string,
  limits: ConcurrencyLimits
): Promise<boolean> {
  const acctKey = PREFIX + key;
  // One REST round-trip: bump both counters and refresh both safety
  // TTLs. INCR is atomic, so concurrent acquires can't both sneak
  // under the limit the way a read-then-write would.
  const [acctCount, globalCount] = (await redis
    .pipeline()
    .incr(acctKey)
    .incr(GLOBAL_KEY)
    .pexpire(acctKey, SLOT_SAFETY_TTL_MS)
    .pexpire(GLOBAL_KEY, SLOT_SAFETY_TTL_MS)
    .exec()) as [number, number, number, number];

  if (acctCount > limits.perAccount || globalCount > limits.global) {
    // Over a bulkhead — undo our increments so we don't hold phantom
    // slots. Best-effort: if this DECR fails the TTL heals it.
    await redis.pipeline().decr(acctKey).decr(GLOBAL_KEY).exec();
    return false;
  }
  return true;
}

async function releaseWithRedis(redis: Redis, key: string): Promise<void> {
  const acctKey = PREFIX + key;
  const [acctLeft] = (await redis
    .pipeline()
    .decr(acctKey)
    .decr(GLOBAL_KEY)
    .exec()) as [number, number];
  // A negative counter means the safety TTL expired mid-operation and
  // our DECR undershot zero. Left alone it would make the bulkhead
  // over-permissive; deleting resets it cleanly (best-effort).
  if (acctLeft < 0) {
    await redis.del(acctKey).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* In-memory fallback (dev / tests / Redis outage)                     */
/* ------------------------------------------------------------------ */

interface Slot {
  count: number;
  /** Heals leaked slots in-process, same role as the Redis TTL. */
  staleAt: number;
}

const memSlots = new Map<string, Slot>();
let memGlobal: Slot = { count: 0, staleAt: 0 };

function memTake(slot: Slot, now: number): Slot {
  if (slot.staleAt <= now) return { count: 1, staleAt: now + SLOT_SAFETY_TTL_MS };
  return { count: slot.count + 1, staleAt: now + SLOT_SAFETY_TTL_MS };
}

function acquireInMemory(key: string, limits: ConcurrencyLimits): boolean {
  const now = Date.now();
  const acct = memTake(
    memSlots.get(key) ?? { count: 0, staleAt: 0 },
    now
  );
  const globalNext = memTake(memGlobal, now);
  if (acct.count > limits.perAccount || globalNext.count > limits.global) {
    return false;
  }
  memSlots.set(key, acct);
  memGlobal = globalNext;
  return true;
}

function releaseInMemory(key: string): void {
  const acct = memSlots.get(key);
  if (acct && acct.count > 0) acct.count -= 1;
  if (acct && acct.count === 0) memSlots.delete(key);
  if (memGlobal.count > 0) memGlobal.count -= 1;
}

/* ------------------------------------------------------------------ */
/* Public adapter                                                      */
/* ------------------------------------------------------------------ */

class RedisBackedConcurrencyGuard implements ConcurrencyGuard {
  /** Tracks which backend each acquired key used, so release always
   *  goes to the same backend even if the breaker trips in between. */
  private readonly memAcquired = new Set<string>();

  async acquire(key: string, limits: ConcurrencyLimits): Promise<boolean> {
    const redis = getRedis();
    if (!redis || Date.now() < redisDownUntil) {
      const ok = acquireInMemory(key, limits);
      if (ok) this.memAcquired.add(key);
      return ok;
    }
    try {
      return await acquireWithRedis(redis, key, limits);
    } catch (error) {
      redisDownUntil = Date.now() + REDIS_COOLDOWN_MS;
      console.warn(
        `[concurrency-guard] redis unavailable, using in-memory bulkhead for ${REDIS_COOLDOWN_MS / 1000}s`,
        error
      );
      const ok = acquireInMemory(key, limits);
      if (ok) this.memAcquired.add(key);
      return ok;
    }
  }

  async release(key: string): Promise<void> {
    // Slot taken from the in-memory fallback → release it there, even
    // if Redis has recovered since (otherwise we'd DECR a counter we
    // never INCRed and skew the shared bulkhead).
    if (this.memAcquired.has(key)) {
      this.memAcquired.delete(key);
      releaseInMemory(key);
      return;
    }
    const redis = getRedis();
    if (!redis) {
      releaseInMemory(key);
      return;
    }
    try {
      await releaseWithRedis(redis, key);
    } catch {
      // Swallowed by contract (release never throws). The safety TTL
      // heals the leaked slot within SLOT_SAFETY_TTL_MS.
    }
  }
}

/** Process-wide singleton, one per runtime instance (same lifecycle
 *  as the rate limiter's client). */
export const aiConcurrencyGuard: ConcurrencyGuard =
  new RedisBackedConcurrencyGuard();

/** Test-only helper — clears in-memory state between test files. */
export function __resetConcurrencyGuardForTests() {
  memSlots.clear();
  memGlobal = { count: 0, staleAt: 0 };
  redisClient = undefined;
  redisDownUntil = 0;
}

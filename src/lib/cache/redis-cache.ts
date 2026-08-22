/**
 * Redis-backed read-through cache (plan Task 6, ADR-INFRA-001 §6).
 *
 * TENANT ISOLATION BY CONSTRUCTION: the only accepted key shape is the
 * tuple produced by `cacheKeys` (src/lib/cache/keys.ts), whose every
 * entry starts with ['account', accountId, ...]. Free-form string keys
 * are rejected at the type level — a cache key that can't express a
 * cross-tenant read can't leak one.
 *
 * FALLBACK: KV_REST_API_URL / KV_REST_API_TOKEN absent → every call is
 * a transparent miss (compute() runs). Redis errors are swallowed after
 * capture — cache failure degrades to origin reads, never to a 500.
 * This mirrors the rate limiter's stance: nothing correctness-critical
 * may live only in cache.
 *
 * COST: Upstash free tier (500k commands/mo). Short TTLs keep the
 * working set small; this cache is for read-heavy snapshots (pipeline
 * boards, contact lists), not a write-through data store.
 */
import { Redis } from '@upstash/redis';
import { captureError } from '@/lib/observability/errors';
import type { cacheKeys } from './keys';

/** Any tuple produced by the cacheKeys allowlist. */
type CacheKey = ReturnType<(typeof cacheKeys)[keyof typeof cacheKeys]>;

let client: Redis | null | undefined;

function getClient(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

function serializeKey(key: CacheKey): string {
  return `cache:${key.join(':')}`;
}

/**
 * Read-through: return the cached value when present, otherwise run
 * `compute`, store the result with `ttlSeconds`, and return it.
 */
export async function cached<T>(
  key: CacheKey,
  ttlSeconds: number,
  compute: () => Promise<T>
): Promise<T> {
  const redis = getClient();
  if (!redis) return compute();
  const k = serializeKey(key);
  try {
    const hit = await redis.get<T>(k);
    if (hit !== null && hit !== undefined) return hit;
  } catch (err) {
    captureError(err, { operation: 'cache.get' });
    return compute();
  }
  const value = await compute();
  try {
    await redis.set(k, value, { ex: ttlSeconds });
  } catch (err) {
    captureError(err, { operation: 'cache.set' });
  }
  return value;
}

/** Explicit invalidation after writes that make a snapshot stale. */
export async function invalidate(key: CacheKey): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  try {
    await redis.del(serializeKey(key));
  } catch (err) {
    captureError(err, { operation: 'cache.invalidate' });
  }
}

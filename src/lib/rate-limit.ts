/**
 * Per-key rate limiter — Redis-backed (Upstash), in-memory fallback.
 *
 * Fixed-window counter: every identifier gets a fresh N-request budget
 * each window.
 *
 * WHY REDIS: on serverless (Vercel), each concurrent invocation is its
 * own process with its own memory. An in-memory Map therefore gives
 * every invocation a fresh budget, which silently DEFEATS the limit
 * exactly when it matters (a burst of parallel requests). Upstash
 * Redis via REST gives one shared counter across all instances.
 * This was RISK-1 in `.agents/context/report-inbound-scale.md`.
 *
 * FALLBACK: when `KV_REST_API_URL` / `KV_REST_API_TOKEN` are absent
 * (local dev, unit tests, single-instance VPS deploys of this
 * template), we degrade to the previous in-memory fixed window. Same
 * semantics, per-process scope.
 *
 * FAILURE MODE: if Redis errors at runtime (network blip, or the
 * Upstash FREE-TIER monthly command quota running out), we do NOT
 * throw and do NOT fail fully open. A circuit breaker trips: for the
 * next `REDIS_COOLDOWN_MS` all checks go to the in-memory fallback —
 * limits stay enforced per-process, requests keep flowing, and we
 * stop hammering (and paying latency on) a dead Redis. One warning is
 * logged per trip, not per request. Rate limiting is an abuse bound,
 * not an authz control; nothing security-critical may rely on this
 * module to deny access.
 *
 * ATOMICITY: the Redis path uses INCR (atomic) + PEXPIRE on first hit
 * of the window. Concurrent requests can't overshoot the count the way
 * a read-modify-write would; the worst race is an extra PEXPIRE, which
 * is idempotent.
 */

import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export interface RateLimitOptions {
  /** Max requests allowed in `windowMs`. */
  limit: number;
  /** Window size, milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** Unix ms when the bucket refills. */
  reset: number;
  limit: number;
}

/* ------------------------------------------------------------------ */
/* Redis backend                                                       */
/* ------------------------------------------------------------------ */

let redisClient: Redis | null | undefined;

/** Lazily construct the client; `null` means "not configured". */
function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  // retries: 1 (not the default 5-with-backoff) — a rate-limit check
  // sits on the hot request path, so when Upstash is down or its
  // free-tier quota is exhausted we want to trip the circuit breaker
  // in ~100ms, not stall requests for seconds of retry backoff.
  redisClient =
    url && token
      ? new Redis({ url, token, retry: { retries: 1, backoff: () => 100 } })
      : null;
  return redisClient;
}

const REDIS_PREFIX = 'rl:';

/**
 * Circuit breaker for the free-tier / outage case. While tripped, all
 * checks use the in-memory fallback and Redis isn't touched at all —
 * no per-request errors, no added latency, no log spam.
 */
const REDIS_COOLDOWN_MS = 60_000;
let redisDownUntil = 0;

async function checkWithRedis(
  redis: Redis,
  key: string,
  { limit, windowMs }: RateLimitOptions
): Promise<RateLimitResult> {
  const redisKey = REDIS_PREFIX + key;

  // INCR is atomic across all serverless instances. A real pipeline
  // sends both commands in ONE REST request — halves both latency and
  // Upstash command-quota burn versus two parallel calls.
  const [count, ttlMs] = (await redis
    .pipeline()
    .incr(redisKey)
    .pttl(redisKey)
    .exec()) as [number, number];

  let resetAt: number;
  if (count === 1 || ttlMs < 0) {
    // First hit of a window (or key existed without expiry after a
    // crash between INCR and PEXPIRE) — stamp the window now.
    await redis.pexpire(redisKey, windowMs);
    resetAt = Date.now() + windowMs;
  } else {
    resetAt = Date.now() + ttlMs;
  }

  if (count > limit) {
    return { success: false, remaining: 0, reset: resetAt, limit };
  }
  return { success: true, remaining: limit - count, reset: resetAt, limit };
}

/* ------------------------------------------------------------------ */
/* In-memory fallback (dev / tests / single-instance deploys)          */
/* ------------------------------------------------------------------ */

interface Entry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Entry>();

// Opportunistic cleanup. Running a sweep on every call would be
// quadratic; running it 1-in-N lets the Map self-drain without a
// background timer.
const LIGHT_SWEEP_EVERY = 1000;
let callsSinceSweep = 0;

function sweepExpired(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

function checkInMemory(
  key: string,
  { limit, windowMs }: RateLimitOptions
): RateLimitResult {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= LIGHT_SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweepExpired(now);
  }

  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      success: true,
      remaining: limit - 1,
      reset: now + windowMs,
      limit,
    };
  }

  if (entry.count >= limit) {
    return { success: false, remaining: 0, reset: entry.resetAt, limit };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: limit - entry.count,
    reset: entry.resetAt,
    limit,
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const redis = getRedis();
  // Not configured, or breaker tripped (outage / free-tier quota
  // exhausted): enforce per-process in memory. Requests never fail
  // because the limiter's backend is down.
  if (!redis || Date.now() < redisDownUntil) {
    return checkInMemory(key, options);
  }

  try {
    return await checkWithRedis(redis, key, options);
  } catch (error) {
    // Trip the breaker: one warning per cooldown, then quiet in-memory
    // enforcement until Redis is worth retrying.
    redisDownUntil = Date.now() + REDIS_COOLDOWN_MS;
    console.warn(
      `[rate-limit] redis unavailable (quota or outage), using in-memory fallback for ${REDIS_COOLDOWN_MS / 1000}s`,
      error
    );
    return checkInMemory(key, options);
  }
}

/**
 * Standard 429 response with the headers clients expect (RFC 6585 +
 * draft-ietf-httpapi-ratelimit-headers). Callers just `return` this.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSec = Math.max(
    1,
    Math.ceil((result.reset - Date.now()) / 1000)
  );
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      retry_after_seconds: retryAfterSec,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
      },
    }
  );
}

/** Preconfigured budgets, tweak here not at call sites. */
export const RATE_LIMITS = {
  /** Individual message send. 60/min per user = one per second
   *  sustained, comfortable for a live human typing. */
  send: { limit: 60, windowMs: 60_000 },
  /** Broadcast dispatch. 5/min per user — even a 1 000-recipient
   *  broadcast is one call; this caps the rate at which a single user
   *  can launch campaigns, not the messages inside one. */
  broadcast: { limit: 5, windowMs: 60_000 },
  /** Reaction add/swap/remove. More permissive than send — users
   *  fidget with reactions and a single "swap" is actually two calls
   *  (remove + add) under the hood. */
  react: { limit: 120, windowMs: 60_000 },
  /** Invitation peek (public, per-IP). 30/min lets a forwarded link
   *  retry a handful of times under flaky connectivity without
   *  enabling brute-force token enumeration. With 256-bit tokens the
   *  enumeration risk is theoretical; this is belt-and-braces. */
  invitationPeek: { limit: 30, windowMs: 60_000 },
  /** Invitation redeem (authed, per-IP+user). Tighter than peek —
   *  successful redemption mutates two profiles and an invite row, so
   *  the abuse surface is "spam join attempts." */
  invitationRedeem: { limit: 10, windowMs: 60_000 },
  /** Admin-only account / member-management actions: create/revoke
   *  invitation, rename account, change member role, remove member,
   *  transfer ownership. 30/min per user is comfortably above any
   *  realistic legitimate use (the Members tab is a clicks-only UI)
   *  while still bounding accidental abuse from a script run in a
   *  loop or a compromised admin session spamming role flips. */
  adminAction: { limit: 30, windowMs: 60_000 },
  /** Public REST API (`/api/v1/*`), keyed per API key. 120/min ≈ 2
   *  req/s sustained — comfortable for a polling integration or an
   *  automation firing on inbound events, while bounding a runaway
   *  script. With the Redis backend this budget is now enforced
   *  globally across all serverless instances. */
  publicApi: { limit: 120, windowMs: 60_000 },
  /** AI draft-reply generation, per user. 20/min is generous for an
   *  agent clicking "Draft with AI" while working a thread, and bounds
   *  spend on the account's own LLM key against an accidental
   *  hold-down / script. */
  aiDraft: { limit: 20, windowMs: 60_000 },
  /** AI draft-reply generation, per account. Caps the WHOLE team's
   *  draws on the one shared BYO provider key — without this, N agents
   *  each under their per-user limit could still stampede the account's
   *  key past the provider's own rate limit. 60/min ≈ three busy agents
   *  drafting flat-out. */
  aiDraftAccount: { limit: 60, windowMs: 60_000 },
  /** AI auto-reply generation, per account. The per-conversation cap
   *  (`auto_reply_max_per_conversation`) bounds one thread; this bounds
   *  the whole account across threads, so a burst of inbound from many
   *  customers at once can't run the BYO key past the provider's limit
   *  or the owner's budget. 30/min is generous for organic inbound while
   *  capping a stampede; excess inbounds simply don't get an auto-reply
   *  (they still land in the inbox for a human). */
  aiAutoReplyAccount: { limit: 30, windowMs: 60_000 },
  /** Provider/channel configuration mutations: saving WhatsApp config,
   *  creating/updating/testing channel connections. These verify
   *  credentials against external provider APIs (Meta, Twilio) on
   *  every call, so beyond ordinary abuse-bounding this also protects
   *  our standing with the provider — a loop hammering a bad token
   *  looks like credential stuffing from THEIR side. 10/min per user
   *  is ample for a human working through a setup form. */
  configMutation: { limit: 10, windowMs: 60_000 },
  /** Support ticket creation, per user. 5/min is far above any
   *  legitimate human filing rate while stopping a stuck retry loop
   *  or a compromised session from flooding the platform queue that
   *  every super admin triages. Replies use `supportReply` below. */
  supportTicketCreate: { limit: 5, windowMs: 60_000 },
  /** Support ticket replies (user or admin side), per user. A live
   *  back-and-forth conversation tops out well under one message per
   *  two seconds sustained. */
  supportReply: { limit: 30, windowMs: 60_000 },
} as const;

/** Test-only helper. Clears the in-memory state so unit tests don't
 *  leak buckets across files. Not wired up in production code. */
export function __resetRateLimitForTests() {
  buckets.clear();
  callsSinceSweep = 0;
  redisClient = undefined;
  redisDownUntil = 0;
}

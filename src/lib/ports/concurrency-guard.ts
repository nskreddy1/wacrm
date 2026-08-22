/**
 * ConcurrencyGuard port — Bulkhead pattern (plan addendum §B/§C,
 * NFR-005: one tenant cannot exhaust shared AI/Redis/DB capacity).
 *
 * A guard bounds how many operations run AT THE SAME TIME, per key and
 * globally — orthogonal to rate limits (`src/lib/rate-limit.ts`),
 * which bound how many START per window. The existing per-account
 * reply caps and rate limits remain; this adds concurrency isolation
 * so one noisy tenant's burst cannot monopolize the provider while
 * other tenants' replies queue behind it.
 *
 * Dependency Rule (addendum §A): this is a port — no vendor imports.
 * The Redis-backed adapter lives in `src/lib/concurrency-guard.ts`.
 * Business code calls the guard, never Redis INCRBY directly.
 */

export interface ConcurrencyLimits {
  /** Max in-flight operations across ALL keys (platform bulkhead). */
  global: number;
  /** Max in-flight operations for one key (tenant bulkhead). */
  perAccount: number;
}

export interface ConcurrencyGuard {
  /**
   * Try to take a slot for `key`. false = bulkhead full (caller skips
   * the operation; it must degrade gracefully, never queue-and-wait).
   * A successful acquire MUST be paired with `release(key)` in a
   * `finally` block.
   */
  acquire(key: string, limits: ConcurrencyLimits): Promise<boolean>;
  /** Return a slot taken by a successful `acquire`. Never throws. */
  release(key: string): Promise<void>;
}

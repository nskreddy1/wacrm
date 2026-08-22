/**
 * Correlation vocabulary (plan Task 6 Step 1, ADR-INFRA-001 §6).
 *
 * The ONE shared vocabulary propagated HTTP → webhook → cron → AI call
 * → DB. Every log line, captured error, and trace carries these fields
 * so a single request can be followed across systems.
 *
 * Vendor-free by design (Dependency Rule, addendum §A): this module
 * imports nothing — it is the type + an AsyncLocalStorage carrier that
 * every observability adapter reads from.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type Correlation = {
  request_id: string;
  trace_id?: string;
  account_id?: string;
  user_id?: string;
  operation?: string;
  route?: string;
  release_version?: string;
  git_sha?: string;
};

const storage = new AsyncLocalStorage<Correlation>();

/** Create a fresh correlation for an entrypoint (route/webhook/cron). */
export function newCorrelation(
  seed: Partial<Correlation> = {}
): Correlation {
  return {
    request_id: seed.request_id ?? crypto.randomUUID(),
    release_version: process.env.RELEASE_VERSION ?? 'dev',
    git_sha: process.env.GIT_SHA ?? 'dev',
    ...seed,
  };
}

/** Run `fn` with `correlation` visible to every adapter beneath it. */
export function runWithCorrelation<T>(
  correlation: Correlation,
  fn: () => T
): T {
  return storage.run(correlation, fn);
}

/** The current correlation, if any entrypoint established one. */
export function currentCorrelation(): Correlation | undefined {
  return storage.getStore();
}

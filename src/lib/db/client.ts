/**
 * src/lib/db/client.ts
 *
 * The ONLY place that knows how to reach Postgres (ADR-001 §7.2, ADR-002 §3.2).
 *
 * Connection resolution:
 *   Cloudflare production → HYPERDRIVE.connectionString (Hyperdrive pools;
 *     it is given Supabase's DIRECT connection string — provisioned in
 *     Task 11 of the production-infrastructure plan). Postgres.js against
 *     Hyperdrive supports prepared statements.
 *   Local dev / CI → DATABASE_URL. If that URL is the Supavisor transaction
 *     pooler (port 6543), prepared statements MUST be disabled
 *     (`prepare: false`) — transaction-mode pooling does not support them.
 *
 * `prepare` is therefore a per-connection-source compatibility decision,
 * NOT a blanket requirement.
 *
 * This module is deliberately boring: connection management only. No query
 * builders, no ORM ambitions, and NO observability side effects — the
 * instrumentation decorators (src/lib/observability/instrument.ts) wrap the
 * sql adapter from the outside.
 */
import postgres from 'postgres';

type HyperdriveBinding = { connectionString: string };

let client: ReturnType<typeof postgres> | null = null;

function getHyperdrive(): HyperdriveBinding | undefined {
  // In the Workers runtime the binding arrives via the Cloudflare request
  // context. @opennextjs/cloudflare exposes bindings on the global env once
  // the worker initializes; access defensively so local dev never trips.
  const g = globalThis as {
    HYPERDRIVE?: HyperdriveBinding;
    __env__?: { HYPERDRIVE?: HyperdriveBinding };
  };
  return g.HYPERDRIVE ?? g.__env__?.HYPERDRIVE;
}

function resolveConnection(): { url: string; prepare: boolean } {
  const hd = getHyperdrive();
  if (hd?.connectionString) {
    return { url: hd.connectionString, prepare: true };
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'No database connection configured: neither a HYPERDRIVE binding nor DATABASE_URL is present.'
    );
  }
  // Supavisor transaction pooler (port 6543) does not support prepared
  // statements; session pooler / direct connections do.
  const isTransactionPooler = url.includes(':6543');
  return { url, prepare: !isTransactionPooler };
}

/**
 * Lazily-initialized singleton postgres.js client.
 * `max: 5` keeps per-isolate connection pressure low; Hyperdrive owns the
 * real pooling in production (NFR-010).
 */
export function db() {
  if (!client) {
    const { url, prepare } = resolveConnection();
    client = postgres(url, { prepare, max: 5 });
  }
  return client;
}

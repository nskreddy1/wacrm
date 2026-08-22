/**
 * Canonical Postgres connection resolution for standalone scripts.
 *
 * WHY THIS FILE EXISTS
 * `src/lib/env.ts` is the env contract for application code, but it cannot
 * serve scripts: ARCH-010 forbids the production DB secret names anywhere
 * under `src/`, precisely so a runtime bundle can never reach a superuser
 * connection string. Scripts still need those names, so they get their own
 * resolver here — one file, outside `src/`, that the fitness checker allows
 * to spell them out.
 *
 * Before this existed, four scripts each rolled their own resolution and
 * drifted apart:
 *   - three different precedence orders, so the same shell could send
 *     `db:push` and `db:doc` to two different databases;
 *   - `push-supabase-schema` omitted POSTGRES_URL_NON_POOLING entirely,
 *     so migrations preferred the *pooled* URL (see POOLING below);
 *   - three different TLS setups for the same Supabase certificate quirk.
 *
 * POOLING — the part that actually breaks things
 * Supabase's pooler (port 6543 / `*.pooler.supabase.com`) runs in
 * transaction mode. Under transaction pooling a "session" is only yours for
 * the length of one statement, which silently breaks the two things schema
 * work depends on:
 *   - `pg_advisory_lock` — the migration mutex is released the moment the
 *     statement ends, so two concurrent `db:push` runs both think they hold
 *     it and interleave DDL;
 *   - multi-statement transactions — `BEGIN`/`COMMIT` spanning several
 *     statements can land on different backends, so a migration that should
 *     roll back atomically half-applies.
 * Neither fails loudly. You get a corrupt schema, not an error. So anything
 * doing DDL must demand a direct connection; read-only catalog queries are
 * happy either way.
 */

import process from 'node:process';

/**
 * Precedence, highest first. SUPABASE_DB_URL wins because it is the
 * explicit, human-set override; the POSTGRES_* pair is what Vercel and
 * Supabase inject automatically, and `_NON_POOLING` precedes the pooled
 * form so DDL callers get a usable connection by default rather than by
 * luck. DATABASE_URL is last: it is the generic fallback most likely to
 * point at something unintended.
 */
const CANDIDATES = [
  'SUPABASE_DB_URL',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL',
  'DATABASE_URL',
];

/** Which candidates are guaranteed NOT to be transaction-pooled. */
const DIRECT_ONLY = new Set(['SUPABASE_DB_URL', 'POSTGRES_URL_NON_POOLING']);

/** Blank and whitespace-only values are absent, matching src/lib/env.ts. */
function read(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

const isLocalHost = (host) =>
  host === 'localhost' || host === '127.0.0.1' || host === '::1';

/**
 * Does this URL point at a transaction pooler? Port 6543 is Supabase's
 * pooler port and `pooler.` appears in the hostname of its regional
 * poolers; either is disqualifying for DDL.
 */
function looksPooled(url) {
  return url.port === '6543' || url.hostname.includes('pooler.');
}

/**
 * Resolve a connection string plus the matching `pg` TLS options.
 *
 * @param {object}  [options]
 * @param {boolean} [options.requireDirect=false]
 *   Set for DDL/migration work. Fails when the only connection available
 *   is transaction-pooled, rather than letting the caller corrupt a schema
 *   through a pooler (see POOLING above).
 * @returns {{ connectionString: string, ssl: object|undefined, source: string, pooled: boolean }}
 *   Spread straight into `new pg.Client({ ... })`.
 */
export function resolveDbUrl({ requireDirect = false } = {}) {
  const source = CANDIDATES.find((name) => read(name));

  if (!source) {
    throw new Error(
      `No Postgres connection string found. Set one of: ${CANDIDATES.join(', ')}.\n` +
        'For local runs: set -a && source .env.local && set +a'
    );
  }

  const raw = read(source);

  let url;
  try {
    url = new URL(raw);
  } catch {
    // Never echo the value: it carries the database password.
    throw new Error(`${source} is not a valid URL.`);
  }

  const local = isLocalHost(url.hostname);
  const pooled = !local && !DIRECT_ONLY.has(source) && looksPooled(url);

  if (requireDirect && pooled) {
    throw new Error(
      `${source} points at a transaction pooler (${url.host}), which cannot ` +
        'safely run DDL: advisory locks do not hold across statements and ' +
        'multi-statement transactions may not stay on one backend.\n' +
        'Set POSTGRES_URL_NON_POOLING (or SUPABASE_DB_URL) to the direct ' +
        'connection — Supabase Dashboard → Project Settings → Database → ' +
        'Connection string → URI, port 5432.'
    );
  }

  // Supabase serves a managed, self-signed certificate chain that Node
  // cannot build a path to, so a URL-level `sslmode=require` aborts the
  // handshake before we can weigh in. Strip it and configure TLS through
  // pg instead: encryption stays on, only CA/hostname verification is
  // skipped. Local Postgres speaks plaintext, so it gets no TLS at all.
  if (!local) url.searchParams.delete('sslmode');

  return {
    connectionString: url.toString(),
    ssl: local ? undefined : { rejectUnauthorized: false },
    source,
    pooled,
  };
}

/**
 * `resolveDbUrl` for top-level script use: prints the failure and exits
 * non-zero instead of dumping a stack trace at an operator mid-deploy.
 */
export function resolveDbUrlOrExit(options) {
  try {
    return resolveDbUrl(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

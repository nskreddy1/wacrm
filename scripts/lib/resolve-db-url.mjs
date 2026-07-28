/**
 * Resolve WHICH database the db:* scripts talk to — and say so out loud.
 *
 * This exists because of a real, costly confusion: `pnpm db:doctor` reported
 * `ap-south-1` for the developer but `us-east-1` inside the v0 VM, from the
 * same command and the same repo. Cause: node's `--env-file-if-exists` does
 * NOT override variables that are already present in the environment. The VM
 * injects `POSTGRES_URL`, so the ambient value silently won over the
 * project's own `.env.development.local`. Every script then reported a
 * confident, green, meaningless result about the wrong database.
 *
 * Precedence, most explicit first:
 *
 *   1. `--url=<conn>` on the command line — an unmistakable instruction,
 *      used for one-off targets like production.
 *   2. `.env.development.local` — the target this project DECLARES for
 *      itself. It beats ambient variables on purpose: a file committed to
 *      the developer's machine is intent, an injected platform variable is
 *      an accident of where the shell happens to run.
 *   3. `process.env` — last-resort fallback (CI, containers, `set -a`).
 *
 * Every caller must print `describeTarget()` so a human can confirm the host
 * before trusting a pass or authorising a write. A green check against the
 * wrong database is worse than no check at all: it ends the investigation.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const KEYS = ['SUPABASE_DB_URL', 'POSTGRES_URL', 'DATABASE_URL'];
const ENV_FILE = '.env.development.local';

/**
 * Minimal `KEY=VALUE` parser — deliberately dependency-free so the database
 * scripts stay runnable before/without an install step.
 */
function parseEnvFile(contents) {
  const found = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) found[key] = value;
  }
  return found;
}

/**
 * A candidate is only usable if it parses AND looks like Postgres. This
 * matters because placeholder junk really does end up in env vars — a
 * documented example (`SUPABASE_DB_URL='<url>' pnpm db:doctor`) was once
 * pasted verbatim into this project's variables, and the scripts then
 * crashed with `ERR_INVALID_URL` instead of falling through to the real
 * connection string sitting right below it. Skip and warn; never crash.
 */
function isUsable(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'postgres:' || protocol === 'postgresql:';
  } catch {
    return false;
  }
}

const skipped = [];

/** Names of candidates that were present but unusable, for reporting. */
export function getSkippedSources() {
  return skipped;
}

/**
 * @returns {Promise<{connectionString: string, origin: string} | null>}
 */
export async function resolveDbUrl({ argv = process.argv } = {}) {
  // 1. Explicit CLI flag wins over everything.
  const flag = argv.find((arg) => arg.startsWith('--url='));
  if (flag) {
    const value = flag.slice('--url='.length);
    // An explicit flag that is malformed is a hard error, never a silent
    // fallback: the operator clearly intended THIS database.
    if (value && !isUsable(value)) {
      throw new Error(
        `--url is not a valid Postgres connection string.\n` +
          `Expected it to start with postgresql:// — got: ${value.slice(0, 30)}…`
      );
    }
    if (value) return { connectionString: value, origin: '--url flag' };
  }

  // 2. The project's declared target.
  try {
    const contents = await readFile(path.join(process.cwd(), ENV_FILE), 'utf8');
    const fromFile = parseEnvFile(contents);
    for (const key of KEYS) {
      const value = fromFile[key];
      if (!value) continue;
      if (!isUsable(value)) {
        skipped.push(`${key} in ${ENV_FILE}`);
        continue;
      }
      return { connectionString: value, origin: `${key} in ${ENV_FILE}` };
    }
  } catch {
    // No env file (CI, fresh clone) — fall through to the ambient values.
  }

  // 3. Ambient environment.
  for (const key of KEYS) {
    const value = process.env[key];
    if (!value) continue;
    if (!isUsable(value)) {
      skipped.push(`${key} (ambient environment)`);
      continue;
    }
    return { connectionString: value, origin: `${key} (ambient environment)` };
  }

  return null;
}

/**
 * Supabase's pooler rejects `sslmode` inside the URL, so strip it and let the
 * caller set SSL on the client instead. Returns the safe-to-print host too —
 * never log the connection string itself, it carries the password.
 */
export function normalizeDbUrl(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return { url, host: url.host, connectionString: url.toString() };
}

export function describeTarget({ host, origin }) {
  let text = `${host}  (from ${origin})`;
  if (skipped.length > 0) {
    // Surface junk variables rather than silently routing around them —
    // an unusable SUPABASE_DB_URL sitting in project settings will keep
    // confusing every future run until someone deletes it.
    text +=
      `\n  ignored (not a valid postgres:// URL): ${skipped.join(', ')}` +
      `\n  → delete these from the project's environment variables.`;
  }
  return text;
}

export const MISSING_URL_MESSAGE =
  `No database URL found. Provide one of:\n` +
  `  --url='postgresql://...'        (explicit, recommended for production)\n` +
  `  ${KEYS.join(' / ')} in ${ENV_FILE}\n` +
  `  ${KEYS.join(' / ')} exported in the environment`;

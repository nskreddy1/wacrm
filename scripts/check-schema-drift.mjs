/**
 * Read-only schema preflight ("doctor").
 *
 * WHY THIS EXISTS: auto-reply died in production while every test
 * passed, because the AI pipeline SELECTs a column list spanning several
 * migrations and Postgres fails the WHOLE statement on one missing
 * column (42703). The failure surfaced as "the AI just stopped
 * replying" — no error, no clue. Tests can never catch this: they mock
 * the database, so they validate the code against the schema we THINK
 * production has.
 *
 * This script validates the schema production ACTUALLY has. It writes
 * nothing, so it is safe to run against production, and it exits
 * non-zero so it can gate a deploy.
 *
 * Usage (production):
 *   SUPABASE_DB_URL='postgresql://...' node scripts/check-schema-drift.mjs
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import {
  MISSING_URL_MESSAGE,
  describeTarget,
  resolveDbUrl,
} from './lib/resolve-db-url.mjs';

const { Client } = pg;
const projectRoot = process.cwd();
const migrationsDirectory = path.join(projectRoot, 'supabase', 'migrations');

// Shared resolver — reports WHICH source won, not just the host. Falling
// back silently is how you confidently check the wrong database: this
// exact script reported ap-south-1 for the developer and us-east-1 in
// the VM, and a green result on the wrong database is worse than none.
const resolved = await resolveDbUrl();

if (!resolved) {
  console.error(MISSING_URL_MESSAGE);
  process.exit(1);
}

const connectionString = resolved.connectionString;

/**
 * The runtime contract: every table/column the AI pipeline reads or
 * writes on the hot path. Keep this in sync when a migration adds a
 * column the pipeline depends on — that is the whole point. Ordered
 * roughly by the outage risk each one caused.
 */
const REQUIRED = [
  // Read by the conversation load in auto-reply (one failed SELECT here
  // aborts EVERY inbound message — this was the outage).
  ['conversations', 'ai_handoff_state'],
  ['conversations', 'ai_caretaker_count'],
  ['conversations', 'ai_sla_reminder_count'],
  ['conversations', 'ai_sentiment'],
  ['conversations', 'ai_language'],
  ['conversations', 'assigned_agent_id'],
  // Knowledge / RAG.
  ['ai_knowledge_chunks', 'embedding'],
  ['ai_knowledge_chunks', 'account_id'],
  // Affective history (append-only emotion trend).
  ['conversation_affective_events', 'emotions'],
  ['conversation_affective_events', 'source'],
  ['conversation_affective_events', 'conversation_id'],
];

/** Database functions the pipeline calls via RPC. */
const REQUIRED_FUNCTIONS = [
  'match_ai_knowledge_semantic',
  'match_ai_knowledge_fts',
  'is_account_member',
];

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const normalized = new URL(connectionString);
if (!isLocal) normalized.searchParams.delete('sslmode');

const client = new Client({
  connectionString: normalized.toString(),
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

const problems = [];
const warnings = [];

try {
  await client.connect();

  // 1. Migration ledger drift -------------------------------------------
  const ledgerExists = await client.query(
    `SELECT to_regclass('wacrm_internal.schema_migrations') IS NOT NULL AS present`
  );

  const files = (await readdir(migrationsDirectory))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (!ledgerExists.rows[0]?.present) {
    problems.push(
      `No migration ledger (wacrm_internal.schema_migrations) — this database ` +
        `has never been migrated by db:push. All ${files.length} migrations are pending.`
    );
  } else {
    const { rows } = await client.query(
      'SELECT filename, checksum FROM wacrm_internal.schema_migrations'
    );
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDirectory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const seen = applied.get(file);
      if (!seen) {
        problems.push(`PENDING migration never applied: ${file}`);
      } else if (seen !== checksum) {
        // Editing an applied migration leaves the ledger and the repo
        // disagreeing while both look "done". Deliberately a WARN, not a
        // BLOCKER: the checksum proves the FILE changed, it cannot tell
        // us whether the SCHEMA is wrong. An edit that only added
        // `DROP POLICY IF EXISTS` changes the bytes while leaving the
        // resulting schema identical. Section 2 below is what actually
        // verifies the schema; treat this as "go confirm", not "broken".
        warnings.push(
          `CHECKSUM MISMATCH: ${file} was edited after being applied. ` +
            `The file no longer matches what was recorded. This may be ` +
            `harmless (e.g. an idempotency tweak) — verify the schema, ` +
            `then run  pnpm db:reconcile  to re-record the checksum.`
        );
      }
    }
  }

  // 2. Runtime contract: do the columns the code reads actually exist? ---
  const { rows: cols } = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'`
  );
  const present = new Set(cols.map((r) => `${r.table_name}.${r.column_name}`));

  for (const [table, column] of REQUIRED) {
    if (!present.has(`${table}.${column}`)) {
      problems.push(
        `MISSING COLUMN ${table}.${column} — the pipeline reads this; ` +
          `Postgres will fail the entire query (42703).`
      );
    }
  }

  // 3. RPC functions -----------------------------------------------------
  const { rows: fns } = await client.query(
    `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'`
  );
  const fnNames = new Set(fns.map((r) => r.proname));
  for (const fn of REQUIRED_FUNCTIONS) {
    if (!fnNames.has(fn)) problems.push(`MISSING FUNCTION ${fn}()`);
  }

  // 4. Report ------------------------------------------------------------
  const target = describeTarget({
    host: normalized.host,
    origin: resolved.origin,
  });
  // Reads are safe on the transaction pooler, WRITES are not — say so here so
  // a green doctor result is never mistaken for "db:push will work too".
  const poolerNote =
    normalized.host.includes(':6543') || normalized.url.port === '6543'
      ? `\nNote: :6543 is the transaction pooler — fine for this read-only\n` +
        `check, but db:push needs :5432 (session) or a direct connection.`
      : '';

  if (problems.length === 0 && warnings.length === 0) {
    console.log(
      `Schema OK — runtime contract satisfied.\n` +
        `  target: ${target}\n` +
        `Confirm that host is the database your PRODUCTION app talks to; a\n` +
        `pass on the wrong database proves nothing.${poolerNote}`
    );
    process.exit(0);
  }

  console.error(`\nSchema problems on ${target}:\n`);
  for (const p of problems) console.error(`  [BLOCKER] ${p}`);
  for (const w of warnings) console.error(`  [WARN]    ${w}`);

  if (problems.length > 0) {
    // NOTE: show the --url= form, never `VAR='<url>' pnpm ...`. The env-var
    // form was copied verbatim into this project's environment variables
    // once, creating a SUPABASE_DB_URL that literally contained
    // "'<same url>' pnpm db:doctor" and hijacking every later run.
    console.error(
      `\nFix: apply the pending migrations, then re-check:\n` +
        `  pnpm db:push --dry-run          # review the plan first\n` +
        `  pnpm db:push --yes\n` +
        `  pnpm db:doctor\n\n` +
        `Add --url='postgresql://...' to every command above if this host is\n` +
        `not the one those commands resolve to by default.\n` +
        `Until then, auto-reply will silently abort on every inbound message.\n`
    );
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error('Schema check could not run:', err.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

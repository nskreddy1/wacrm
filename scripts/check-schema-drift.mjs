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

const { Client } = pg;
const projectRoot = process.cwd();
const migrationsDirectory = path.join(projectRoot, 'supabase', 'migrations');

const connectionString =
  process.env.SUPABASE_DB_URL ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    'Missing SUPABASE_DB_URL, POSTGRES_URL, or DATABASE_URL.\n' +
      'Point it at the database you want to CHECK (safe: read-only).'
  );
  process.exit(1);
}

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
        // Editing an applied migration means the database and the repo
        // disagree while both look "done" — worse than a pending one.
        warnings.push(
          `CHECKSUM MISMATCH: ${file} was edited after being applied. ` +
            `The database does not match the file.`
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
  const target = normalized.host;
  if (problems.length === 0 && warnings.length === 0) {
    console.log(`Schema OK (${target}) — runtime contract satisfied.`);
    process.exit(0);
  }

  console.error(`\nSchema problems on ${target}:\n`);
  for (const p of problems) console.error(`  [BLOCKER] ${p}`);
  for (const w of warnings) console.error(`  [WARN]    ${w}`);

  if (problems.length > 0) {
    console.error(
      `\nFix: run  SUPABASE_DB_URL='<same url>' pnpm db:push\n` +
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

/**
 * Apply pending SQL migrations, safely enough to run against production.
 *
 * Production-safety properties, each earned from a real failure mode:
 *
 *   - TARGET IS ALWAYS PRINTED. An outage was once "fixed" against the wrong
 *     database while production stayed broken. Never write blind.
 *   - REFUSES THE TRANSACTION POOLER (:6543) when there is work to do.
 *     That port releases the connection after every transaction, so advisory
 *     locks and session-level SET silently do not persist — exactly the two
 *     mechanisms below. Migrations need :5432 (session) or a direct URL.
 *   - ADVISORY LOCK serialises deploys. Two concurrent pipelines applying
 *     the same migration is data corruption, not a race you can retry.
 *   - lock_timeout STOPS THE CLASSIC MIGRATION OUTAGE: DDL waiting on an
 *     ACCESS EXCLUSIVE lock queues every subsequent query on that table.
 *     Failing after 10s is recoverable; blocking all traffic is not.
 *   - PER-MIGRATION TRANSACTION so a failure leaves no half-applied schema.
 *   - --dry-run prints the plan, so production changes are reviewable first.
 *   - --yes is required for remote targets, so production is never a typo.
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

const dryRun = process.argv.includes('--dry-run');
const assumeYes = process.argv.includes('--yes');
const allowPooler = process.argv.includes('--allow-pooler');

// Same resolver as db:doctor / db:reconcile so all three ALWAYS agree on
// the target. They previously each read process.env independently, which
// let the doctor check one database while push wrote to another.
const resolved = await resolveDbUrl();

if (!resolved) {
  console.error(MISSING_URL_MESSAGE);
  process.exit(1);
}

const connectionString = resolved.connectionString;

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));

if (migrationFiles.length === 0) {
  console.error(`No SQL migrations found in ${migrationsDirectory}`);
  process.exit(1);
}

const isLocalDatabase = /localhost|127\.0\.0\.1/.test(connectionString);
const normalizedConnectionString = new URL(connectionString);

// Supabase pooler certificates can include a managed self-signed chain.
// Remove URL-level sslmode so this explicit pg TLS configuration takes effect.
if (!isLocalDatabase) normalizedConnectionString.searchParams.delete('sslmode');

const target = describeTarget({
  host: normalizedConnectionString.host,
  origin: resolved.origin,
});

// Supabase's transaction pooler. Reads are fine here; DDL is not.
const isTransactionPooler = normalizedConnectionString.port === '6543';

// Serialises concurrent deploys. Any stable arbitrary key works, as long as
// every deployer uses the same one.
const MIGRATION_LOCK_KEY = 4_812_207_115_004;

const client = new Client({
  connectionString: normalizedConnectionString.toString(),
  ssl: isLocalDatabase ? undefined : { rejectUnauthorized: false },
});

let lockAcquired = false;

try {
  await client.connect();
  console.log(`target  ${target}`);
  console.log(`mode    ${dryRun ? 'DRY RUN (no changes)' : 'APPLY'}\n`);

  await client.query(`
    CREATE SCHEMA IF NOT EXISTS wacrm_internal;
    CREATE TABLE IF NOT EXISTS wacrm_internal.schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    -- Provenance for audits: "who applied this, from where".
    ALTER TABLE wacrm_internal.schema_migrations
      ADD COLUMN IF NOT EXISTS applied_by text;
  `);

  const { rows } = await client.query(
    'SELECT filename, checksum FROM wacrm_internal.schema_migrations'
  );
  const applied = new Map(
    rows.map(({ filename, checksum }) => [filename, checksum])
  );

  // ---- Plan first, act second. -------------------------------------------
  // Building the full plan before touching anything is what makes --dry-run
  // truthful and lets the pooler/confirmation guards run BEFORE any DDL.
  const pending = [];

  for (const filename of migrationFiles) {
    const sql = await readFile(
      path.join(migrationsDirectory, filename),
      'utf8'
    );
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previousChecksum = applied.get(filename);

    if (previousChecksum === checksum) continue;

    if (previousChecksum) {
      // Deliberately still a hard stop — but tell the operator BOTH exits,
      // because they are not interchangeable and picking wrong is costly.
      throw new Error(
        `${filename} changed after it was applied.\n\n` +
          `  Target: ${target}\n\n` +
          `Two valid resolutions — choose by what the edit actually did:\n\n` +
          `  1. The edit CHANGED the intended schema (added/altered a column,\n` +
          `     policy, index): write a NEW migration. Never rewrite history\n` +
          `     that has already shipped.\n\n` +
          `  2. The edit was cosmetic or idempotency-only (e.g. adding\n` +
          `     DROP POLICY IF EXISTS) and the live schema is ALREADY correct:\n` +
          `     verify, then re-record the checksum without running DDL:\n` +
          `       pnpm db:doctor        # must show no [BLOCKER] lines\n` +
          `       pnpm db:reconcile     # dry run, shows what would change\n` +
          `       pnpm db:reconcile --write\n`
      );
    }

    pending.push({ filename, sql, checksum });
  }

  if (pending.length === 0) {
    console.log(
      `Schema is current: ${migrationFiles.length} migrations found, 0 pending.`
    );
    process.exit(0);
  }

  console.log(`${pending.length} migration(s) pending:`);
  for (const { filename } of pending) console.log(`  + ${filename}`);
  console.log('');

  if (dryRun) {
    console.log(
      `Dry run — nothing was applied. Re-run without --dry-run to apply.`
    );
    process.exit(0);
  }

  // ---- Guards that only matter when we are about to WRITE. ---------------

  if (isTransactionPooler && !allowPooler) {
    throw new Error(
      `Refusing to apply migrations through the transaction pooler (:6543).\n\n` +
        `  Target: ${target}\n\n` +
        `Port 6543 returns the connection to the pool after every transaction,\n` +
        `so advisory locks and session-level settings (lock_timeout) silently\n` +
        `do NOT persist. Those are the two guards that stop concurrent deploys\n` +
        `from colliding and stop DDL from blocking live traffic. Applying schema\n` +
        `changes here can appear to succeed while being unsafe.\n\n` +
        `Use the session pooler or a direct connection instead:\n` +
        `  pnpm db:push --url='postgresql://...@<host>:5432/postgres'\n\n` +
        `(db:doctor is read-only and remains safe on :6543.)`
    );
  }

  if (!isLocalDatabase && !assumeYes) {
    throw new Error(
      `Refusing to modify a remote database without confirmation.\n\n` +
        `  Target: ${target}\n\n` +
        `Review the plan above, then re-run with --yes:\n` +
        `  pnpm db:push --yes\n\n` +
        `To preview without any confirmation, use --dry-run.`
    );
  }

  // ---- Serialise deploys. ------------------------------------------------
  const { rows: lockRows } = await client.query(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [MIGRATION_LOCK_KEY]
  );

  if (!lockRows[0]?.locked) {
    throw new Error(
      `Another migration run holds the advisory lock on this database.\n` +
        `Wait for it to finish rather than applying concurrently — two\n` +
        `deploys writing schema at once is corruption, not a retryable race.`
    );
  }
  lockAcquired = true;

  const appliedBy = `${process.env.USER ?? process.env.USERNAME ?? 'unknown'}@${process.env.VERCEL_ENV ?? 'local'}`;
  let appliedCount = 0;

  for (const { filename, sql, checksum } of pending) {
    console.log(`apply ${filename}`);
    await client.query('BEGIN');

    try {
      // lock_timeout: fail fast instead of queueing behind a long-running
      // query and freezing every other query on the same table.
      // statement_timeout: a migration that hangs must not hang forever.
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query(sql);
      await client.query(
        `INSERT INTO wacrm_internal.schema_migrations
           (filename, checksum, applied_by)
         VALUES ($1, $2, $3)`,
        [filename, checksum, appliedBy]
      );
      await client.query('COMMIT');
      appliedCount += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(
        `Migration ${filename} failed and was rolled back. ` +
          `Migrations before it remain applied; fix this file and re-run.`,
        { cause: error }
      );
    }
  }

  console.log(
    `\nSchema is current: ${migrationFiles.length} migrations found, ${appliedCount} applied.`
  );
} catch (error) {
  console.error(`\n${error.message ?? error}`);
  if (error.cause) console.error(error.cause);
  process.exitCode = 1;
} finally {
  if (lockAcquired) {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}

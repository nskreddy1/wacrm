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

const client = new Client({
  connectionString: normalizedConnectionString.toString(),
  ssl: isLocalDatabase ? undefined : { rejectUnauthorized: false },
});

try {
  await client.connect();
  // Always state the target before writing. This is the guard against the
  // "I fixed it, but on the wrong database" failure that hid an outage.
  console.log(
    `target ${describeTarget({
      host: normalizedConnectionString.host,
      origin: resolved.origin,
    })}`
  );
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS wacrm_internal;
    CREATE TABLE IF NOT EXISTS wacrm_internal.schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await client.query(
    'SELECT filename, checksum FROM wacrm_internal.schema_migrations'
  );
  const applied = new Map(
    rows.map(({ filename, checksum }) => [filename, checksum])
  );

  let appliedCount = 0;

  for (const filename of migrationFiles) {
    const sql = await readFile(
      path.join(migrationsDirectory, filename),
      'utf8'
    );
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previousChecksum = applied.get(filename);

    if (previousChecksum === checksum) {
      console.log(`skip  ${filename}`);
      continue;
    }

    if (previousChecksum) {
      // Deliberately still a hard stop — but tell the operator BOTH exits,
      // because they are not interchangeable and picking wrong is costly.
      throw new Error(
        `${filename} changed after it was applied.\n\n` +
          `  Target: ${describeTarget({ host: normalizedConnectionString.host, origin: resolved.origin })}\n\n` +
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

    console.log(`apply ${filename}`);
    await client.query('BEGIN');

    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO wacrm_internal.schema_migrations (filename, checksum)
         VALUES ($1, $2)`,
        [filename, checksum]
      );
      await client.query('COMMIT');
      appliedCount += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed`, { cause: error });
    }
  }

  console.log(
    `Schema is current: ${migrationFiles.length} migrations found, ${appliedCount} applied.`
  );
} catch (error) {
  console.error(error);
  if (error.cause) console.error(error.cause);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

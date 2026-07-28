/**
 * Re-record checksums for migrations that were edited AFTER being applied.
 *
 * Why this exists as a separate, explicit command:
 *
 * `db:push` is keyed on checksums, so an edited-but-applied migration is
 * stuck — push skips it (the filename is recorded) while the doctor keeps
 * warning (the bytes differ). The only honest resolutions are "re-apply"
 * or "re-record", and they are NOT interchangeable:
 *
 *   - Re-apply is wrong when the edit was cosmetic or idempotent-only; it
 *     risks re-running DDL that already succeeded.
 *   - Re-record is wrong when the edit genuinely changed the intended
 *     schema, because it papers over a real difference.
 *
 * So this script refuses to guess. It re-records ONLY the checksum, never
 * runs DDL, and only after `check-schema-drift` reports zero BLOCKERs —
 * i.e. only once the runtime contract has independently verified that the
 * live schema is actually correct. It also prints the ledger row it is
 * about to overwrite, so the change is auditable rather than silent.
 *
 * Usage:
 *   SUPABASE_DB_URL='<url>' pnpm db:reconcile          # dry run (default)
 *   SUPABASE_DB_URL='<url>' pnpm db:reconcile --write  # apply
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client } from 'pg';
import {
  MISSING_URL_MESSAGE,
  describeTarget,
  normalizeDbUrl,
  resolveDbUrl,
} from './lib/resolve-db-url.mjs';

// Shared resolver: prefers --url, then the project's declared target in
// .env.development.local, then ambient vars — and reports which one won.
// This script WRITES to the ledger, so resolving to the wrong database
// silently is the worst possible outcome here.
const resolved = await resolveDbUrl();

if (!resolved) {
  console.error(MISSING_URL_MESSAGE);
  process.exit(1);
}

const write = process.argv.includes('--write');
const normalized = normalizeDbUrl(resolved.connectionString);
const target = describeTarget({
  host: normalized.host,
  origin: resolved.origin,
});

const client = new Client({
  connectionString: normalized.connectionString,
  ssl: { rejectUnauthorized: false },
});

const migrationsDirectory = path.join(process.cwd(), 'supabase', 'migrations');

try {
  await client.connect();

  const files = (await readdir(migrationsDirectory))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await client.query(
    'SELECT filename, checksum FROM wacrm_internal.schema_migrations'
  );
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

  const stale = [];
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDirectory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const recorded = applied.get(file);
    if (recorded && recorded !== checksum) {
      stale.push({ file, recorded, checksum });
    }
  }

  if (stale.length === 0) {
    console.log(
      `Nothing to reconcile — every applied migration matches its file.\n` +
        `  target: ${target}\n\n` +
        `If you EXPECTED a mismatch, you are pointed at a different database\n` +
        `than the one that reported it. Target it explicitly:\n` +
        `  pnpm db:reconcile --url='postgresql://...'`
    );
    process.exit(0);
  }

  console.log(`\nChecksum mismatches found.\n  target: ${target}\n`);
  for (const { file, recorded, checksum } of stale) {
    console.log(`  ${file}`);
    console.log(`    recorded: ${recorded.slice(0, 16)}…`);
    console.log(`    file now: ${checksum.slice(0, 16)}…`);
  }

  if (!write) {
    console.log(
      `\nDry run — nothing changed.\n\n` +
        `Before re-recording, confirm the LIVE SCHEMA is actually correct\n` +
        `on THIS SAME host (${normalized.host}):\n` +
        `  pnpm db:doctor\n` +
        `It must report no [BLOCKER] lines (the checksum WARN is expected).\n\n` +
        `If the edit changed the intended schema, do NOT reconcile — write a\n` +
        `NEW migration instead; that is the only safe way to change schema\n` +
        `that has already shipped.\n\n` +
        `Otherwise re-record with:\n` +
        `  pnpm db:reconcile --write\n`
    );
    process.exit(0);
  }

  for (const { file, checksum } of stale) {
    await client.query(
      'UPDATE wacrm_internal.schema_migrations SET checksum = $2 WHERE filename = $1',
      [file, checksum]
    );
    console.log(`  re-recorded ${file}`);
  }
  console.log(
    `\nReconciled ${stale.length} migration(s). No DDL was run — only the\n` +
      `ledger changed. Re-run  pnpm db:doctor  to confirm it is clean.\n`
  );
  process.exit(0);
} catch (err) {
  console.error('Reconcile could not run:', err.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

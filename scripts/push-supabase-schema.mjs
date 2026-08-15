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
    'Missing SUPABASE_DB_URL, POSTGRES_URL, or DATABASE_URL. Set one to the Supabase Postgres connection string.'
  );
  process.exit(1);
}

/**
 * Function-security invariants.
 *
 * `CREATE OR REPLACE FUNCTION` does NOT inherit the previous definition's
 * security mode: omit `SECURITY DEFINER` and Postgres silently recreates
 * the function as INVOKER. Nothing errors at apply time — the function
 * only fails later, at runtime, for real users, and only on the paths
 * that depended on elevated privileges (RLS bypass, guard triggers that
 * key off `current_user`). That is exactly how `switch_active_account`
 * broke: replaced to add a column, lost DEFINER, and every workspace
 * switch started failing with "account_role and account_id cannot be
 * changed directly".
 *
 * These checks run INSIDE each migration's transaction, so a violation
 * rolls the migration back instead of shipping. Both are ratchets: they
 * compare live state before and after, so they need no hand-maintained
 * list of privileged functions and cannot drift out of date.
 */
const SECURITY_SNAPSHOT_SQL = `
  SELECT
    p.oid::regprocedure::text AS identity,
    n.nspname || '.' || p.proname AS qualified_name,
    p.prosecdef AS is_definer,
    EXISTS (
      SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg
      WHERE cfg LIKE 'search\\_path=%'
    ) AS search_path_pinned
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'wacrm_internal')
`;

/**
 * Escape hatches, declared in the migration that needs them so the
 * intent is reviewable in the diff rather than buried in this script:
 *
 *   -- wacrm:allow-security-downgrade public.some_function
 *   -- wacrm:allow-mutable-search-path public.some_function
 */
function parseSecurityAllowances(sql) {
  const collect = (pattern) => {
    const out = new Set();
    for (const match of sql.matchAll(pattern)) out.add(match[1].trim());
    return out;
  };

  return {
    downgrade: collect(/--\s*wacrm:allow-security-downgrade\s+(\S+)/gi),
    mutableSearchPath: collect(/--\s*wacrm:allow-mutable-search-path\s+(\S+)/gi),
  };
}

async function snapshotFunctionSecurity(dbClient) {
  const { rows } = await dbClient.query(SECURITY_SNAPSHOT_SQL);
  return {
    // Names that still exist after the migration, so a deliberate DROP
    // is not misread as a privilege downgrade.
    names: new Set(rows.map((row) => row.qualified_name)),
    definerNames: new Set(
      rows.filter((row) => row.is_definer).map((row) => row.qualified_name)
    ),
    rows,
  };
}

function findSecurityViolations(before, after, allowances) {
  const violations = [];

  // 1. Privilege downgrade: was SECURITY DEFINER, still exists, no
  //    longer DEFINER. Compared by qualified name rather than by full
  //    signature so a replace that also changes the argument list is
  //    still caught.
  for (const name of before.definerNames) {
    if (!after.names.has(name)) continue; // intentionally dropped
    if (after.definerNames.has(name)) continue; // still privileged
    if (allowances.downgrade.has(name)) continue;
    violations.push(
      `${name} lost SECURITY DEFINER. CREATE OR REPLACE does not carry the ` +
        `previous security mode — restate "SECURITY DEFINER" in the ` +
        `function definition. If the downgrade is intentional, declare ` +
        `"-- wacrm:allow-security-downgrade ${name}" in this migration.`
    );
  }

  // 2. A SECURITY DEFINER function without a pinned search_path lets a
  //    caller shadow an unqualified name and run their own code as the
  //    function owner.
  for (const row of after.rows) {
    if (!row.is_definer || row.search_path_pinned) continue;
    if (allowances.mutableSearchPath.has(row.qualified_name)) continue;
    violations.push(
      `${row.identity} is SECURITY DEFINER with a mutable search_path. Add ` +
        `"SET search_path = ''" (or 'public') and fully-qualify the tables ` +
        `it touches.`
    );
  }

  return violations;
}

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
      throw new Error(
        `${filename} changed after it was applied. Add a new migration instead of editing migration history.`
      );
    }

    console.log(`apply ${filename}`);
    await client.query('BEGIN');

    try {
      // Snapshot inside the transaction so the comparison sees exactly
      // the state this migration starts from, including anything applied
      // earlier in this same run.
      const securityBefore = await snapshotFunctionSecurity(client);

      await client.query(sql);

      const securityAfter = await snapshotFunctionSecurity(client);
      const violations = findSecurityViolations(
        securityBefore,
        securityAfter,
        parseSecurityAllowances(sql)
      );

      if (violations.length > 0) {
        throw new Error(
          `Function-security invariants violated:\n` +
            violations.map((line) => `  - ${line}`).join('\n')
        );
      }

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

import { writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

/**
 * Regenerate `.agents/context/database-schema.md` from the live database.
 *
 * Why this script exists
 * ----------------------
 * The doc it writes already claimed to be "introspected from the live
 * Supabase Postgres… regenerate after schema changes by introspecting the
 * live database again" — but no script was committed, so regeneration was a
 * manual ritual that nobody repeated. It drifted 11 tables behind (77
 * documented vs 88 live) while still presenting itself as authoritative,
 * which is worse than having no doc: agents and humans trusted it and wrote
 * queries against tables whose real shape had moved on.
 *
 * Why introspect the live DB rather than parse `supabase/migrations/`
 * ------------------------------------------------------------------
 * The 131 migrations are the source of truth for *how* the schema is built,
 * and they stay that way — this script never replaces them. But they are
 * idempotent and cumulative (`ADD COLUMN IF NOT EXISTS`, later `ALTER`, the
 * occasional `DROP`), so computing the current shape from them means
 * re-implementing Postgres' DDL semantics and getting every ordering edge
 * case right. The live database already *is* those 131 files applied, so
 * reading it is the same answer without the reimplementation.
 *
 * The trade-off is that introspection cannot detect a migration that was
 * written but never applied, so the header records both the table count and
 * the migration count. If `supabase/migrations/` grows and this doc is
 * regenerated without the counts moving, the migrations were not pushed.
 *
 * Usage:
 *   set -a && source /vercel/share/.env.project && set +a \
 *     && node scripts/generate-schema-doc.mjs
 */

const projectRoot = process.cwd();
const outputPath = path.join(
  projectRoot,
  '.agents',
  'context',
  'database-schema.md'
);
const migrationsDirectory = path.join(projectRoot, 'supabase', 'migrations');

// Same precedence as push-supabase-schema.mjs so both scripts read one
// connection string. Non-pooling is preferred but not required: this is a
// read-only session, so a pooled connection returns identical catalog rows.
const rawConnectionString =
  process.env.SUPABASE_DB_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL;

if (!rawConnectionString) {
  console.error(
    'Missing SUPABASE_DB_URL, POSTGRES_URL_NON_POOLING, POSTGRES_URL, or DATABASE_URL.'
  );
  process.exit(1);
}

/**
 * Supabase's pooler presents a certificate that Node cannot chain to a
 * public root, so the default `sslmode=require` aborts the handshake. The
 * connection still has to be encrypted, so drop any inherited sslmode and
 * ask for `no-verify`: TLS stays on, only hostname/CA verification is
 * skipped. Acceptable because this reads catalog metadata over a trusted
 * network path and writes no data.
 */
function withPermissiveSsl(connectionString) {
  const stripped = connectionString.replace(/[?&]sslmode=[^&]*/g, '');
  return `${stripped}${stripped.includes('?') ? '&' : '?'}sslmode=no-verify`;
}

/** Render a value for the `Default` column: backticked, or an em dash. */
function renderDefault(value) {
  return value === null || value === undefined ? '—' : `\`${value}\``;
}

/**
 * Markdown table cells are pipe-delimited, so a literal `|` inside a
 * default expression (`ARRAY['a'|'b']`, bitwise ops) would silently split
 * the row into extra columns and corrupt every following cell.
 */
function escapeCell(value) {
  return String(value).replaceAll('|', '\\|');
}

const QUERIES = {
  enums: `
    SELECT t.typname AS name,
           -- enumlabel is the "name" type, whose array the pg driver hands
           -- back as a raw literal string rather than a JS array. Joining
           -- in SQL sidesteps that: the driver only ever sees plain text.
           string_agg(e.enumlabel::text, ', ' ORDER BY e.enumsortorder) AS values
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `,
  tables: `
    SELECT c.relname AS name,
           c.relrowsecurity AS rls_enabled,
           c.reltuples::bigint AS approx_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `,
  // format_type() is deliberate: information_schema.data_type collapses
  // every enum to "USER-DEFINED" and every array to "ARRAY", which would
  // erase exactly the detail this reference exists to provide.
  columns: `
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS data_type,
           NOT a.attnotnull AS is_nullable,
           pg_get_expr(d.adbin, d.adrelid) AS column_default,
           a.attnum
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY c.relname, a.attnum
  `,
  foreignKeys: `
    SELECT c.relname AS table_name,
           con.conname AS name,
           pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND con.contype = 'f'
    ORDER BY c.relname, con.conname
  `,
  checks: `
    SELECT c.relname AS table_name,
           con.conname AS name,
           pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND con.contype = 'c'
    ORDER BY c.relname, con.conname
  `,
  indexes: `
    SELECT tablename AS table_name, indexname AS name, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `,
  // tgisinternal excludes the triggers Postgres creates to enforce FK and
  // deferred-unique constraints — those are already reported as foreign
  // keys, and listing them again would bury the ~25 real application
  // triggers (updated_at stamping, guard triggers) in noise.
  triggers: `
    SELECT c.relname AS table_name,
           t.tgname AS name,
           pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  `,
  policies: `
    SELECT tablename AS table_name,
           policyname AS name,
           cmd,
           roles::text AS roles,
           qual,
           with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `,
  functions: `
    SELECT p.proname AS name,
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS returns,
           p.prosecdef AS is_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname, pg_get_function_arguments(p.oid)
  `,
  // Surfaced in the header rather than expanded: wacrm_internal is a
  // private helper schema, but a reader who only ever sees "public" would
  // not know other schemas carry tables at all.
  otherSchemas: `
    SELECT n.nspname AS schema, count(*)::int AS tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('public', 'information_schema')
      AND n.nspname NOT LIKE 'pg_%'
    GROUP BY n.nspname
    ORDER BY n.nspname
  `,
};

/** Group flat rows by their `table_name`, preserving query order. */
function groupByTable(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.table_name);
    if (list) list.push(row);
    else grouped.set(row.table_name, [row]);
  }
  return grouped;
}

/**
 * Turn `FOREIGN KEY (a) REFERENCES t(b) ON DELETE CASCADE` into the
 * doc's compact `a` → `t.b` (on delete cascade) form. Falls back to the
 * raw definition when the shape is unexpected (composite keys, MATCH
 * FULL) so an odd constraint is still reported rather than dropped.
 */
function formatForeignKey(definition) {
  const match = definition.match(
    /FOREIGN KEY \(([^)]+)\) REFERENCES ([^(]+)\(([^)]+)\)/
  );
  if (!match) return definition;

  const [, columns, targetTable, targetColumns] = match;
  const onDelete = definition.match(/ON DELETE ([A-Z ]+?)(?: ON UPDATE|$)/);
  const action = onDelete ? onDelete[1].trim().toLowerCase() : 'no action';
  const target = targetTable.trim().replace(/^public\./, '');

  return `\`${columns.trim()}\` → \`${target}.${targetColumns.trim()}\` (on delete ${action})`;
}

/**
 * Condense `CREATE TRIGGER x BEFORE UPDATE ON public.t FOR EACH ROW
 * EXECUTE FUNCTION f()` down to `BEFORE UPDATE → EXECUTE FUNCTION f()`.
 *
 * The table name and `FOR EACH ROW` are dropped as redundant — the trigger
 * is already listed under its table, and row-level is the default. Any
 * `WHEN (...)` clause is preserved, since a conditional trigger behaves
 * materially differently from an unconditional one.
 */
function formatTrigger(definition) {
  // The event list is matched greedily up to the LAST ` ON ` before
  // `FOR EACH`, because `UPDATE OF assigned_agent_id` and
  // `INSERT OR DELETE OR UPDATE` both contain tokens a lazy match stops
  // at — which silently dropped 18 of 40 triggers on the first attempt.
  const match = definition.match(
    /(BEFORE|AFTER|INSTEAD OF) (.+) ON \S+ (?:FROM \S+ )?(?:NOT DEFERRABLE |DEFERRABLE )?(?:INITIALLY \w+ )?FOR EACH (ROW|STATEMENT)(?: WHEN (\(.+\)))? (EXECUTE (?:FUNCTION|PROCEDURE) .+)/s
  );
  if (!match) return definition;

  const [, timing, events, level, when, action] = match;
  const scope = level === 'STATEMENT' ? ' (per statement)' : '';
  const condition = when ? ` WHEN ${when}` : '';
  return `${timing} ${events}${scope}${condition} → ${action}`;
}

async function main() {
  const client = new Client({
    connectionString: withPermissiveSsl(rawConnectionString),
  });
  await client.connect();

  const results = {};
  try {
    for (const [key, sql] of Object.entries(QUERIES)) {
      results[key] = (await client.query(sql)).rows;
    }
  } finally {
    await client.end();
  }

  const migrationFiles = (await readdir(migrationsDirectory)).filter((file) =>
    file.endsWith('.sql')
  );

  const columnsByTable = groupByTable(results.columns);
  const fksByTable = groupByTable(results.foreignKeys);
  const checksByTable = groupByTable(results.checks);
  const indexesByTable = groupByTable(results.indexes);
  const triggersByTable = groupByTable(results.triggers);
  const policiesByTable = groupByTable(results.policies);

  const out = [];
  out.push('# Live database structure — full reference');
  out.push('');
  out.push(
    'Generated by `scripts/generate-schema-doc.mjs` from the live Supabase'
  );
  out.push(
    `Postgres catalogs (\`pg_class\`, \`pg_attribute\`, \`pg_indexes\`,`
  );
  out.push(
    `\`pg_policies\`). **${results.tables.length} tables** in schema \`public\`,`
  );
  out.push(
    `built by the **${migrationFiles.length} migrations** in \`supabase/migrations/\`.`
  );
  out.push('');
  out.push(
    'Do not hand-edit: rerun the script instead, or the next regeneration'
  );
  out.push('silently discards the edit.');
  out.push('');
  out.push('```bash');
  out.push('set -a && source /vercel/share/.env.project && set +a \\');
  out.push('  && node scripts/generate-schema-doc.mjs');
  out.push('```');
  out.push('');
  out.push(
    'The migration count above is the drift check: `supabase/migrations/` is'
  );
  out.push(
    'the source of truth for how the schema is built, and this file only'
  );
  out.push(
    'reports those migrations as actually applied. If the directory has grown'
  );
  out.push('but a regeneration does not move these numbers, the new migrations');
  out.push('were never pushed.');
  out.push('');
  out.push(
    'This is the authoritative column-level reference: every table below'
  );
  out.push('lists its columns with exact Postgres types, nullability, defaults,');
  out.push('foreign keys with their ON DELETE behaviour, every index with its');
  out.push('full `CREATE INDEX` statement, check constraints, and all RLS');
  out.push('policies with their USING / WITH CHECK expressions.');
  out.push('');
  out.push('Read `database.md` first for the conceptual model (domains, tenancy');
  out.push('rules, key relationships). Come here when you need the exact shape');
  out.push('of a table before writing a query or a migration.');
  out.push('');

  if (results.otherSchemas.length > 0) {
    const summary = results.otherSchemas
      .map((row) => `\`${row.schema}\` (${row.tables})`)
      .join(', ');
    out.push(
      `Tables outside \`public\` are not expanded here: ${summary}. Inspect`
    );
    out.push('those directly if a migration needs them.');
    out.push('');
  }

  out.push('## Enum types');
  out.push('');
  for (const row of results.enums) {
    out.push(`- \`${row.name}\`: ${row.values}`);
  }
  out.push('');

  out.push('## Tables');
  out.push('');
  for (const table of results.tables) {
    out.push(`### ${table.name}`);
    out.push('');
    // reltuples is -1 until a table's first ANALYZE, so this is an
    // optimiser estimate and never a row count to reason about.
    out.push(
      `RLS: ${table.rls_enabled ? 'enabled' : 'DISABLED'} · approx rows: ${table.approx_rows}`
    );
    out.push('');
    out.push('| Column | Type | Null | Default |');
    out.push('| --- | --- | --- | --- |');
    for (const column of columnsByTable.get(table.name) ?? []) {
      out.push(
        `| ${column.column_name} | ${escapeCell(column.data_type)} | ${
          column.is_nullable ? 'yes' : 'no'
        } | ${escapeCell(renderDefault(column.column_default))} |`
      );
    }
    out.push('');

    const foreignKeys = fksByTable.get(table.name) ?? [];
    if (foreignKeys.length > 0) {
      out.push('Foreign keys:');
      for (const fk of foreignKeys) {
        out.push(`- ${formatForeignKey(fk.definition)}`);
      }
      out.push('');
    }

    const indexes = indexesByTable.get(table.name) ?? [];
    if (indexes.length > 0) {
      out.push('Indexes:');
      for (const index of indexes) {
        out.push(`- \`${index.name}\`: ${index.definition}`);
      }
      out.push('');
    }

    const checks = checksByTable.get(table.name) ?? [];
    if (checks.length > 0) {
      out.push('Check constraints:');
      for (const check of checks) {
        out.push(`- \`${check.name}\`: ${check.definition}`);
      }
      out.push('');
    }

    const triggers = triggersByTable.get(table.name) ?? [];
    if (triggers.length > 0) {
      out.push('Triggers:');
      for (const trigger of triggers) {
        out.push(`- \`${trigger.name}\`: ${formatTrigger(trigger.definition)}`);
      }
      out.push('');
    }

    const policies = policiesByTable.get(table.name) ?? [];
    if (policies.length > 0) {
      out.push('RLS policies:');
      for (const policy of policies) {
        out.push(`- \`${policy.name}\` (${policy.cmd}, roles ${policy.roles})`);
        if (policy.qual) out.push(`  - USING: ${policy.qual}`);
        if (policy.with_check)
          out.push(`  - WITH CHECK: ${policy.with_check}`);
      }
      out.push('');
    } else if (table.rls_enabled) {
      // RLS on with zero policies denies every non-service-role request.
      // Sometimes intended (platform tables), sometimes a table that was
      // locked down and never given policies — call it out either way.
      out.push(
        'RLS policies: none — RLS is enabled with no policies, so only the'
      );
      out.push('service role can read or write this table.');
      out.push('');
    }
  }

  out.push('## Functions');
  out.push('');
  for (const fn of results.functions) {
    const definer = fn.is_definer ? ' **SECURITY DEFINER**' : '';
    out.push(`- \`${fn.name}(${fn.args})\` → ${fn.returns}${definer}`);
  }
  out.push('');

  await writeFile(outputPath, out.join('\n'), 'utf8');

  const withoutRls = results.tables.filter((t) => !t.rls_enabled);
  console.log(
    `Wrote ${path.relative(projectRoot, outputPath)}: ${results.tables.length} tables, ` +
      `${results.functions.length} functions, ${results.policies.length} policies, ` +
      `${migrationFiles.length} migrations.`
  );
  if (withoutRls.length > 0) {
    console.warn(
      `WARNING: ${withoutRls.length} table(s) without RLS: ${withoutRls
        .map((t) => t.name)
        .join(', ')}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Validates the chart catalog migration against the LIVE database:
 *   1. every chart_sources.table_name is a real public table
 *   2. every account_column / default_date_column exists on that table
 *   3. every chart_dimensions.column_name exists on its source table
 *   4. every uuid dimension's relation_table + relation_label_column exist
 *   5. every chart_measures.column_name exists (NULL = COUNT(*) is fine)
 *   6. RLS is enabled on all three catalog tables and no write policies exist
 *   7. chart_aggregate is SECURITY INVOKER (not DEFINER) and anon lacks EXECUTE
 * Read-only — makes no data changes.
 */
import pg from 'pg';

const client = new pg.Client({
  connectionString: `${process.env.POSTGRES_URL.split('?')[0]}?sslmode=no-verify`,
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
const ok = (label) => console.log(`PASS  ${label}`);
const bad = (label, detail) => {
  failures += 1;
  console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};

async function columnExists(table, column) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
      where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(table) {
  const { rows } = await client.query(
    `select 1 from information_schema.tables
      where table_schema='public' and table_name=$1`,
    [table]
  );
  return rows.length > 0;
}

async function main() {
  await client.connect();

  // 1 + 2: sources
  const { rows: sources } = await client.query(
    `select * from chart_sources order by position`
  );
  if (sources.length === 0) bad('chart_sources seeded', 'no rows');

  for (const s of sources) {
    if (!(await tableExists(s.table_name))) {
      bad(`source ${s.source_key}: table ${s.table_name} exists`);
      continue;
    }
    ok(`source ${s.source_key} -> table ${s.table_name}`);

    if (s.account_column && !(await columnExists(s.table_name, s.account_column)))
      bad(`source ${s.source_key}: account column ${s.account_column}`);
    if (
      s.default_date_column &&
      !(await columnExists(s.table_name, s.default_date_column))
    )
      bad(`source ${s.source_key}: date column ${s.default_date_column}`);
  }

  // 3 + 4: dimensions
  const { rows: dims } = await client.query(
    `select d.*, s.table_name from chart_dimensions d
      join chart_sources s using (source_key) order by d.source_key, d.position`
  );
  for (const d of dims) {
    if (!(await columnExists(d.table_name, d.column_name))) {
      bad(`dimension ${d.source_key}.${d.dimension_key}: column ${d.table_name}.${d.column_name}`);
      continue;
    }
    if (d.kind === 'uuid') {
      if (!(await tableExists(d.relation_table))) {
        bad(`dimension ${d.source_key}.${d.dimension_key}: relation table ${d.relation_table}`);
        continue;
      }
      if (!(await columnExists(d.relation_table, d.relation_label_column))) {
        bad(`dimension ${d.source_key}.${d.dimension_key}: label ${d.relation_table}.${d.relation_label_column}`);
        continue;
      }
      if (!(await columnExists(d.relation_table, 'id'))) {
        bad(`dimension ${d.source_key}.${d.dimension_key}: ${d.relation_table}.id join key`);
        continue;
      }
    }
  }
  ok(`all ${dims.length} dimensions resolve to real columns`);

  // 5: measures
  const { rows: measures } = await client.query(
    `select m.*, s.table_name from chart_measures m
      join chart_sources s using (source_key) order by m.source_key, m.position`
  );
  let measureFail = false;
  for (const m of measures) {
    if (m.column_name && !(await columnExists(m.table_name, m.column_name))) {
      bad(`measure ${m.source_key}.${m.measure_key}: column ${m.table_name}.${m.column_name}`);
      measureFail = true;
    }
  }
  if (!measureFail) ok(`all ${measures.length} measures resolve to real columns`);

  // 6: RLS posture on catalog tables
  for (const t of ['chart_sources', 'chart_dimensions', 'chart_measures']) {
    const {
      rows: [rls],
    } = await client.query(
      `select relrowsecurity from pg_class where oid = ('public.'||$1)::regclass`,
      [t]
    );
    if (rls?.relrowsecurity) ok(`RLS enabled on ${t}`);
    else bad(`RLS enabled on ${t}`);

    const { rows: writePolicies } = await client.query(
      `select polname from pg_policy
        where polrelid = ('public.'||$1)::regclass
          and polcmd in ('a','w','d')`,
      [t]
    );
    if (writePolicies.length === 0) ok(`no write policies on ${t}`);
    else bad(`no write policies on ${t}`, writePolicies.map((p) => p.polname).join(','));
  }

  // 7: function security posture
  const {
    rows: [fn],
  } = await client.query(`
    select prosecdef,
           has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
           proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'chart_aggregate'
  `);
  if (!fn) bad('chart_aggregate exists');
  else {
    if (!fn.prosecdef) ok('chart_aggregate is SECURITY INVOKER');
    else bad('chart_aggregate is SECURITY INVOKER', 'it is SECURITY DEFINER!');
    if (!fn.anon_exec) ok('anon cannot EXECUTE chart_aggregate');
    else bad('anon cannot EXECUTE chart_aggregate');
    if (fn.auth_exec) ok('authenticated can EXECUTE chart_aggregate');
    else bad('authenticated can EXECUTE chart_aggregate');
    const sp = (fn.proconfig || []).find((c) => c.startsWith('search_path='));
    if (sp) ok(`search_path pinned (${sp})`);
    else bad('search_path pinned');
  }

  // Also: catalog tables not writable by authenticated via grants
  const { rows: grants } = await client.query(`
    select table_name, privilege_type, grantee
      from information_schema.role_table_grants
     where table_schema='public'
       and table_name in ('chart_sources','chart_dimensions','chart_measures')
       and grantee in ('anon','authenticated')
       and privilege_type in ('INSERT','UPDATE','DELETE')
  `);
  // Supabase default-grants write privileges to both roles on every table,
  // but RLS with no write policy blocks them. Report as info, not failure.
  if (grants.length > 0)
    console.log(
      `INFO  default grants exist (${grants.length}) but are inert: RLS has no write policies`
    );

  console.log(`\n${failures === 0 ? 'ALL VALIDATIONS PASSED' : failures + ' FAILURES'}`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('ERROR', e.message);
  process.exit(1);
});

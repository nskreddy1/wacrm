import { readFile } from 'node:fs/promises';
import pg from 'pg';

const client = new pg.Client({
  connectionString: `${process.env.POSTGRES_URL.split('?')[0]}?sslmode=no-verify`,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const sql = await readFile(
  'supabase/migrations/20260726220000_chart_catalog.sql',
  'utf8'
);

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('MIGRATION APPLIED OK');
} catch (e) {
  await client.query('ROLLBACK');
  console.log('MIGRATION FAILED:', e.message);
  if (e.position) console.log('  at position', e.position);
  await client.end();
  process.exit(1);
}

// ---- exercise the function across every shape ----
const CASES = [
  ['KPI count deals', ['deals', 'count', 'COUNT', null]],
  ['KPI sum value', ['deals', 'value', 'SUM', null]],
  ['Pie by status', ['deals', 'count', 'COUNT', 'status']],
  ['Pie by stage (uuid join)', ['deals', 'count', 'COUNT', 'stage']],
  ['Pie by owner (profiles join)', ['deals', 'value', 'SUM', 'owner']],
  ['Bool dimension', ['contacts', 'count', 'COUNT', 'smsOptOut']],
  ['Enum channel', ['conversations', 'count', 'COUNT', 'channel']],
  ['Messages (no account col)', ['messages', 'count', 'COUNT', 'senderType']],
];

console.log('\n=== single dimension ===');
for (const [name, [source, measure, op, dim]] of CASES) {
  try {
    const { rows } = await client.query(
      'select chart_aggregate($1,$2,$3,$4) as r',
      [source, measure, op, dim]
    );
    console.log(`OK   ${name}: ${JSON.stringify(rows[0].r).slice(0, 120)}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

console.log('\n=== time series + granularity ===');
for (const g of ['day', 'week', 'month', 'quarter', 'year']) {
  try {
    const { rows } = await client.query(
      'select chart_aggregate($1,$2,$3,$4,$5) as r',
      ['deals', 'value', 'SUM', 'createdAt', g]
    );
    console.log(`OK   granularity=${g}: ${JSON.stringify(rows[0].r).slice(0, 90)}`);
  } catch (e) {
    console.log(`FAIL granularity=${g}: ${e.message}`);
  }
}

console.log('\n=== two dimensions (stacked) ===');
try {
  const { rows } = await client.query(
    'select chart_aggregate($1,$2,$3,$4,$5,$6) as r',
    ['deals', 'count', 'COUNT', 'createdAt', 'month', 'status']
  );
  console.log('OK   month x status:', JSON.stringify(rows[0].r).slice(0, 120));
} catch (e) {
  console.log('FAIL month x status:', e.message);
}

console.log('\n=== date range filter ===');
try {
  const { rows } = await client.query(
    'select chart_aggregate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r',
    [
      'deals',
      'value',
      'SUM',
      'createdAt',
      'month',
      null,
      'month',
      'createdAt',
      new Date(Date.now() - 180 * 86400000).toISOString(),
      new Date().toISOString(),
    ]
  );
  console.log('OK   ranged:', JSON.stringify(rows[0].r).slice(0, 120));
} catch (e) {
  console.log('FAIL ranged:', e.message);
}

console.log('\n=== ordering ===');
for (const ob of ['bucket', 'bucketDesc', 'valueDesc', 'valueAsc']) {
  try {
    const { rows } = await client.query(
      'select chart_aggregate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r',
      ['deals', 'count', 'COUNT', 'status', 'month', null, 'month', null, null, null, ob]
    );
    console.log(`OK   orderBy=${ob}: ${JSON.stringify(rows[0].r).slice(0, 90)}`);
  } catch (e) {
    console.log(`FAIL orderBy=${ob}: ${e.message}`);
  }
}

console.log('\n=== all operations ===');
for (const op of [
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COUNT_UNIQUE_VALUES',
  'COUNT_EMPTY',
  'COUNT_NOT_EMPTY',
]) {
  try {
    const { rows } = await client.query(
      'select chart_aggregate($1,$2,$3,$4) as r',
      ['deals', 'value', op, 'status']
    );
    console.log(`OK   ${op}: ${JSON.stringify(rows[0].r).slice(0, 80)}`);
  } catch (e) {
    console.log(`FAIL ${op}: ${e.message}`);
  }
}

console.log('\n=== rejections (must all FAIL) ===');
const BAD = [
  ['unknown source', ['evil_table', 'count', 'COUNT', null]],
  ['unknown measure', ['deals', 'password', 'SUM', null]],
  ['unknown dimension', ['deals', 'count', 'COUNT', 'secret_col']],
  ['injection in source', ['deals; DROP TABLE deals--', 'count', 'COUNT', null]],
  ['injection in dimension', ['deals', 'count', 'COUNT', 'status") ; DROP TABLE deals--']],
  ['bad operation', ['deals', 'value', 'EVIL(1)', null]],
];
for (const [name, args] of BAD) {
  try {
    await client.query('select chart_aggregate($1,$2,$3,$4) as r', args);
    console.log(`!!!! ${name}: WAS ACCEPTED — SECURITY HOLE`);
  } catch (e) {
    console.log(`OK   rejected ${name}: ${e.message.slice(0, 70)}`);
  }
}

console.log('\n=== bad granularity (must fail) ===');
try {
  await client.query('select chart_aggregate($1,$2,$3,$4,$5) as r', [
    'deals',
    'count',
    'COUNT',
    'createdAt',
    "month') ; DROP TABLE deals--",
  ]);
  console.log('!!!! granularity injection ACCEPTED — SECURITY HOLE');
} catch (e) {
  console.log('OK   rejected granularity injection:', e.message.slice(0, 70));
}

// Confirm the table still exists after all injection attempts.
const { rows: check } = await client.query(
  "select count(*)::int as n from information_schema.tables where table_name='deals'"
);
console.log(`\ndeals table still present: ${check[0].n === 1}`);

await client.end();

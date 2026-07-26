import pg from 'pg';

const TABLES = [
  'deals',
  'contacts',
  'conversations',
  'messages',
  'tasks',
  'appointments',
  'broadcasts',
  'pipeline_stages',
  'pipelines',
  'profiles',
];

const client = new pg.Client({
  connectionString: `${process.env.POSTGRES_URL.split('?')[0]}?sslmode=no-verify`,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const { rows } = await client.query(
  `select table_name, column_name, data_type, is_nullable
     from information_schema.columns
    where table_schema = 'public'
      and table_name = any($1)
    order by table_name, ordinal_position`,
  [TABLES]
);

const byTable = new Map();
for (const r of rows) {
  if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
  byTable.get(r.table_name).push(r);
}

for (const t of TABLES) {
  const cols = byTable.get(t);
  if (!cols) {
    console.log(`\n=== ${t} === MISSING`);
    continue;
  }
  console.log(`\n=== ${t} ===`);
  console.log(
    cols
      .map(
        (c) =>
          `  ${c.column_name} ${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}`
      )
      .join('\n')
  );
}

const ENUMISH = [
  ['deals', 'status'],
  ['conversations', 'status'],
  ['messages', 'sender_type'],
  ['messages', 'channel'],
  ['messages', 'status'],
  ['contacts', 'source'],
  ['tasks', 'status'],
  ['tasks', 'priority'],
  ['appointments', 'status'],
  ['broadcasts', 'status'],
];

console.log('\n\n=== DISTINCT VALUES ===');
for (const [table, col] of ENUMISH) {
  const cols = byTable.get(table);
  if (!cols || !cols.some((c) => c.column_name === col)) continue;
  try {
    const { rows: vals } = await client.query(
      `select "${col}" as v, count(*)::int as n
         from public."${table}" group by 1 order by 2 desc limit 12`
    );
    console.log(
      `${table}.${col}: ${vals.map((r) => `${r.v}(${r.n})`).join(', ')}`
    );
  } catch (e) {
    console.log(`${table}.${col}: ERROR ${e.message}`);
  }
}

await client.end();

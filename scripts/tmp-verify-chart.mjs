// Inserts sample rows inside a transaction, asserts chart_aggregate()
// buckets them correctly, then ROLLS BACK. Nothing is persisted.
import pg from 'pg';

const client = new pg.Client({
  connectionString: `${process.env.POSTGRES_URL.split('?')[0]}?sslmode=no-verify`,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query('BEGIN');

try {
  // Minimal object graph: account -> user -> pipeline -> stages -> deals
  const {
    rows: [acct],
  } = await client.query(
    `insert into accounts (name) values ('__chart_test__') returning id`
  );

  const {
    rows: [usr],
  } = await client.query(
    `insert into auth.users (id, email, instance_id, aud, role)
     values (gen_random_uuid(), '__charttest__@example.test',
             '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
     returning id`
  );

  await client.query(
    `insert into profiles (user_id, full_name, email, account_id, account_role)
     values ($1, 'Chart Tester', '__charttest__@example.test', $2, 'owner')`,
    [usr.id, acct.id]
  );

  const {
    rows: [pipe],
  } = await client.query(
    `insert into pipelines (user_id, name, account_id)
     values ($1, 'Test pipeline', $2) returning id`,
    [usr.id, acct.id]
  );

  const stageIds = {};
  for (const [i, name] of ['New', 'Won', 'Lost'].entries()) {
    const {
      rows: [s],
    } = await client.query(
      `insert into pipeline_stages (pipeline_id, name, position, color)
       values ($1, $2, $3, '#000000') returning id`,
      [pipe.id, name, i]
    );
    stageIds[name] = s.id;
  }

  const {
    rows: [contact],
  } = await client.query(
    `insert into contacts (user_id, account_id, name, phone, source)
     values ($1, $2, 'Test Contact', '+10000000000', 'referral') returning id`,
    [usr.id, acct.id]
  );

  // 5 deals: 3 New (100,200,300), 1 Won (1000), 1 Lost (50)
  const deals = [
    ['New', 100, 'active'],
    ['New', 200, 'active'],
    ['New', 300, 'active'],
    ['Won', 1000, 'won'],
    ['Lost', 50, 'lost'],
  ];
  for (const [stage, value, status] of deals) {
    await client.query(
      `insert into deals
         (user_id, account_id, pipeline_id, stage_id, contact_id,
          title, value, status, priority, probability, position, assigned_to,
          created_at)
       values ($1,$2,$3,$4,$5,'Deal',$6,$7,'medium',50,0,$1, now())`,
      [usr.id, acct.id, pipe.id, stageIds[stage], contact.id, value, status]
    );
  }

  // chart_aggregate uses auth.uid() for its defence-in-depth filter. As the
  // migration role auth.uid() is NULL, so that predicate collapses to TRUE
  // (by design) and we see every row — which is what we want to assert on.
  const q = (args) =>
    client
      .query(
        `select chart_aggregate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as r`,
        args
      )
      .then((r) => r.rows[0].r);

  const checks = [];
  const expect = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    checks.push({ name, pass: a === e, actual: a, expected: e });
  };

  // KPI: count of deals = 5
  expect(
    'KPI count',
    (await q(['deals', 'count', 'COUNT', null, 'month', null, 'month', null, null, null, 'bucket', 50]))
      .map((r) => Number(r.value)),
    [5]
  );

  // KPI: sum of value = 1650
  expect(
    'KPI sum value',
    (await q(['deals', 'value', 'SUM', null, 'month', null, 'month', null, null, null, 'bucket', 50]))
      .map((r) => Number(r.value)),
    [1650]
  );

  // KPI: avg = 330
  expect(
    'KPI avg value',
    (await q(['deals', 'value', 'AVG', null, 'month', null, 'month', null, null, null, 'bucket', 50]))
      .map((r) => Number(r.value)),
    [330]
  );

  // Group by status, count, ordered by bucket asc
  expect(
    'count by status',
    (await q(['deals', 'count', 'COUNT', 'status', 'month', null, 'month', null, null, null, 'bucket', 50]))
      .map((r) => [r.bucket, Number(r.value)]),
    [
      ['active', 3],
      ['lost', 1],
      ['won', 1],
    ]
  );

  // Group by stage -> must resolve the uuid to the stage NAME
  expect(
    'sum value by stage name',
    (await q(['deals', 'value', 'SUM', 'stage', 'month', null, 'month', null, null, null, 'bucket', 50]))
      .map((r) => [r.bucket, Number(r.value)]),
    [
      ['Lost', 50],
      ['New', 600],
      ['Won', 1000],
    ]
  );

  // Group by owner -> resolves to profiles.full_name
  expect(
    'count by owner name',
    (await q(['deals', 'count', 'COUNT', 'owner', 'month', null, 'month', null, null, null, 'bucket', 50]))
      .map((r) => [r.bucket, Number(r.value)]),
    [['Chart Tester', 5]]
  );

  // valueDesc ordering
  expect(
    'ordered valueDesc',
    (await q(['deals', 'value', 'SUM', 'status', 'month', null, 'month', null, null, null, 'valueDesc', 50]))
      .map((r) => r.bucket),
    ['won', 'active', 'lost']
  );

  // Two dimensions: stage x status
  expect(
    'stage x status',
    (await q(['deals', 'count', 'COUNT', 'stage', 'month', 'status', 'month', null, null, null, 'bucket', 50]))
      .map((r) => [r.bucket, r.series, Number(r.value)]),
    [
      ['Lost', 'lost', 1],
      ['New', 'active', 3],
      ['Won', 'won', 1],
    ]
  );

  // Bool dimension on contacts -> 'No'
  expect(
    'bool dimension',
    (await q(['contacts', 'count', 'COUNT', 'smsOptOut', 'month', null, 'month', null, null, null, 'bucket', 50]))
      .map((r) => [r.bucket, Number(r.value)]),
    [['No', 1]]
  );

  // Date bucketing: all deals created now -> a single month bucket
  const monthly = await q([
    'deals', 'count', 'COUNT', 'createdAt', 'month', null, 'month', null, null, null, 'bucket', 50,
  ]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  expect(
    'monthly bucket key',
    [monthly.length, monthly[0]?.bucket?.slice(0, 7), Number(monthly[0]?.value)],
    [1, thisMonth, 5]
  );

  // Range filter excluding everything -> empty
  expect(
    'range excludes all',
    await q([
      'deals', 'count', 'COUNT', 'createdAt', 'month', null, 'month', 'createdAt',
      '2000-01-01T00:00:00Z', '2000-02-01T00:00:00Z', 'bucket', 50,
    ]),
    []
  );

  // Limit is respected
  expect(
    'limit 2',
    (await q(['deals', 'count', 'COUNT', 'status', 'month', null, 'month', null, null, null, 'bucket', 2]))
      .length,
    2
  );

  let failed = 0;
  for (const c of checks) {
    if (c.pass) {
      console.log(`PASS  ${c.name}`);
    } else {
      failed++;
      console.log(`FAIL  ${c.name}\n        expected ${c.expected}\n        actual   ${c.actual}`);
    }
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
} catch (e) {
  console.log('ERROR:', e.message);
} finally {
  await client.query('ROLLBACK');
  console.log('rolled back — no test data persisted');
  await client.end();
}

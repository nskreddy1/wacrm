import { Client } from 'pg';
import { resolveDbUrlOrExit } from './lib/db-url.mjs';

// Read-only inspection, so a pooled connection is fine.
const c = new Client(resolveDbUrlOrExit());
await c.connect();

const ix = await c.query(
  `select indexname, indexdef from pg_indexes where tablename='channel_connections'`
);
console.log('--- indexes ---');
for (const r of ix.rows) console.log(r.indexname, '=>', r.indexdef);

const rows = await c.query(
  `select channel, provider, external_identity, is_enabled, is_primary, status
   from channel_connections order by channel`
);
console.log('--- connections ---');
console.log(JSON.stringify(rows.rows, null, 1));

await c.end();

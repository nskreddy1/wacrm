import { Client } from 'pg';
const c = new Client({ connectionString: (process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL).replace(/[?&]sslmode=[^&]*/,''), ssl:{rejectUnauthorized:false} });
await c.connect();
const r = await c.query(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_account_context','switch_active_account','set_active_account')`);
for (const row of r.rows) console.log('\n----',row.proname,'\n',row.def);
await c.end();

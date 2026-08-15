import { Client } from 'pg';
const c = new Client({ connectionString: (process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL).replace(/[?&]sslmode=[^&]*/,''), ssl:{rejectUnauthorized:false} });
await c.connect();
let r = await c.query(`select p.email, p.account_id, p.account_role, wp.name profile, wr.name role_name from profiles p left join workspace_profiles wp on wp.id=p.workspace_profile_id left join workspace_roles wr on wr.id=p.workspace_role_id order by p.email`);
console.table(r.rows);
r = await c.query(`select indexdef from pg_indexes where indexname='idx_channel_connections_external'`);
console.table(r.rows);
await c.end();

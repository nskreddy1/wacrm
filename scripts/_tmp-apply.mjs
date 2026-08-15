import { readFileSync } from 'node:fs';
import { Client } from 'pg';
const file = process.argv[2];
const c = new Client({ connectionString: (process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL).replace(/[?&]sslmode=[^&]*/,''), ssl:{rejectUnauthorized:false} });
await c.connect();
await c.query('begin');
try { await c.query(readFileSync(file,'utf8')); await c.query('commit'); console.log('applied', file); }
catch (e) { await c.query('rollback'); console.error('FAILED', e.message); process.exitCode = 1; }
await c.end();

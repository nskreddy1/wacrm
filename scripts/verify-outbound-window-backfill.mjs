// ADR-006 F3 deploy gate.
//
// The 24-hour-window guard treats conversations.last_inbound_at = NULL as
// "window closed" (fail-closed). That is only safe once the backfill in
// 20260820120000_outbound_window_and_whatsapp_consent.sql has actually run
// against the data the guard will see. On an empty database this script
// passes vacuously, so it proves nothing until it is run against the
// environment being deployed.
//
// Run against each environment BEFORE enabling the guard:
//   set -a && source .env.production.local && set +a
//   node scripts/verify-outbound-window-backfill.mjs
//
// Exit code 0 = safe to ship the guard. Exit code 1 = do NOT ship.
import pg from 'pg';
import process from 'node:process';
import { resolveDbUrlOrExit } from './lib/db-url.mjs';

// Read-only verification queries, so a pooled connection is fine.
const client = new pg.Client(resolveDbUrlOrExit());

await client.connect();

let failed = false;

try {
  // --- Gate 1: schema shape -------------------------------------------------
  const { rows: cols } = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE (table_name = 'conversations' AND column_name = 'last_inbound_at')
        OR (table_name = 'contacts'
            AND column_name IN ('whatsapp_opted_out', 'whatsapp_opted_out_at'))`
  );
  const found = new Set(cols.map((r) => `${r.table_name}.${r.column_name}`));
  for (const required of [
    'conversations.last_inbound_at',
    'contacts.whatsapp_opted_out',
    'contacts.whatsapp_opted_out_at',
  ]) {
    if (!found.has(required)) {
      console.error(`FAIL  missing column ${required} — migration not applied`);
      failed = true;
    }
  }
  if (!failed) console.log('PASS  schema: window + consent columns present');

  // --- Gate 2: backfill completeness ---------------------------------------
  const {
    rows: [backfill],
  } = await client.query(
    `SELECT count(*)::int AS violations FROM public.conversations c
     WHERE c.last_inbound_at IS NULL
       AND EXISTS (SELECT 1 FROM public.messages m
                   WHERE m.conversation_id = c.id
                     AND m.sender_type = 'customer')`
  );
  if (backfill.violations > 0) {
    console.error(
      `FAIL  backfill: ${backfill.violations} conversations have inbound messages but NULL last_inbound_at.\n` +
        '      Shipping the guard now would 409 every reply in those threads.\n' +
        '      Re-run: pnpm db:push'
    );
    failed = true;
  } else {
    console.log('PASS  backfill: no conversation with inbound is left NULL');
  }

  // --- Gate 3: is this check meaningful? -----------------------------------
  const {
    rows: [scale],
  } = await client.query(
    `SELECT (SELECT count(*)::int FROM public.conversations) AS conversations,
            (SELECT count(*)::int FROM public.conversations
              WHERE last_inbound_at IS NOT NULL) AS with_window,
            (SELECT count(*)::int FROM public.messages
              WHERE sender_type = 'customer') AS inbound_msgs`
  );
  console.log(
    `INFO  conversations=${scale.conversations} with_window=${scale.with_window} inbound_msgs=${scale.inbound_msgs}`
  );
  if (scale.conversations === 0) {
    console.warn(
      'WARN  database has no conversations — gate 2 passed VACUOUSLY.\n' +
        '      This run does NOT clear the guard for a populated environment.\n' +
        '      Re-run against staging/production before enabling the guard.'
    );
  }
} finally {
  await client.end();
}

process.exit(failed ? 1 : 0);

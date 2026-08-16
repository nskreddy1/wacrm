// ============================================================
// Operation executor.
//
// Runs ONE admin-defined operation against ONE connection, with the
// parameter values resolved from the contact row (see bindings.ts).
//
// Every backend here is synchronous request/response. Streaming logs
// (Kafka, PubSub) are deliberately absent: they cannot answer "the order
// for this phone number" without consuming a topic or maintaining a
// materialised view, and the support path needs an answer in ~1-2s. A
// connector that looks supported and then times out is worse than no
// connector, so event ingest stays a separate concern (land events in a
// local table, then point a `postgres` connection at that table).
//
// Safety properties, all enforced here rather than trusted from config:
//   - a read runs inside a READ ONLY transaction, so even a statement
//     that slipped past validation cannot write
//   - a statement timeout is set server-side on the remote session
//   - reads are wrapped in a LIMIT guard, so a mistaken join cannot pull
//     a million rows into the prompt
//   - a write on a `read_only` connection is refused
//   - dry-run executes the write and then ROLLBACKs, so an admin can see
//     the affected row count without committing
// ============================================================

import { Client as PgClient } from 'pg';
import { createConnection as createMysqlConnection } from 'mysql2/promise';

import { isDeliverableUrl } from '@/features/webhooks/lib/ssrf';

import { resolveBindings, resolveRestPath } from './bindings';
import {
  IntegrationError,
  type BindableContact,
  type IntegrationConnection,
  type IntegrationOperation,
} from './types';

export interface ExecuteResult {
  rows: Record<string, unknown>[];
  /** Rows returned, or rows affected for a write. */
  rowCount: number;
  /** True when the row limit clipped the result. */
  truncated: boolean;
  /** True when a write ran and was rolled back rather than committed. */
  rolledBack: boolean;
}

export interface ExecuteArgs {
  connection: IntegrationConnection;
  operation: IntegrationOperation;
  contact: BindableContact;
  /** Decrypted connection secret: connection string, or REST auth value. */
  secret: string | null;
  /** Execute then ROLLBACK. Only meaningful for a write. */
  dryRun?: boolean;
}

export async function executeOperation(
  args: ExecuteArgs
): Promise<ExecuteResult> {
  const { connection, operation } = args;

  if (!connection.enabled) {
    throw new IntegrationError(`Connection "${connection.name}" is disabled.`);
  }
  if (!operation.enabled) {
    throw new IntegrationError(`Operation "${operation.name}" is disabled.`);
  }
  // Defence in depth: the database has a trigger for this, but an
  // operation reaching the executor with a write mode on a read-only
  // connection must never run, whatever the row says.
  if (operation.mode === 'write' && connection.read_only) {
    throw new IntegrationError(
      `Connection "${connection.name}" is read-only, so "${operation.name}" cannot run.`
    );
  }
  // Cross-tenant guard. `contact` is resolved by the caller; if it ever
  // came from the wrong account we must not query the client's system
  // with it.
  if (args.contact.account_id !== connection.account_id) {
    throw new IntegrationError('Contact does not belong to this account.');
  }

  switch (connection.kind) {
    case 'postgres':
      return executePostgres(args);
    case 'mysql':
      return executeMysql(args);
    case 'rest':
      return executeRest(args);
    default: {
      const never: never = connection.kind;
      throw new IntegrationError(`Unsupported connection kind "${never}".`);
    }
  }
}

// ------------------------------------------------------------
// Postgres
// ------------------------------------------------------------

async function executePostgres(args: ExecuteArgs): Promise<ExecuteResult> {
  const { connection, operation, contact, secret } = args;
  if (!secret) {
    throw new IntegrationError(
      `Connection "${connection.name}" has no connection string saved.`
    );
  }
  await assertRoutableConnectionString(secret);

  const values = resolveBindings(contact, operation.bindings);
  const statement = operation.statement.trim().replace(/;+\s*$/, '');
  const isRead = operation.mode === 'read';

  const client = new PgClient({
    connectionString: secret,
    // Verify TLS unless the operator explicitly opted out in their own
    // connection string, so accepting any certificate is a recorded
    // choice rather than a silent default.
    ssl: /[?&]sslmode=no-verify\b/.test(secret)
      ? { rejectUnauthorized: false }
      : true,
    connectionTimeoutMillis: operation.timeout_ms,
    query_timeout: operation.timeout_ms,
  });

  try {
    await client.connect();
    // READ ONLY makes the read guarantee structural: the remote server
    // rejects any write, so we are not relying on our own lexical
    // validation having caught everything.
    await client.query(
      isRead ? 'BEGIN TRANSACTION READ ONLY' : 'BEGIN'
    );
    await client.query(`SET LOCAL statement_timeout = ${operation.timeout_ms}`);

    let rows: Record<string, unknown>[] = [];
    let rowCount = 0;
    let truncated = false;

    if (isRead) {
      // Wrapping instead of parsing lets us cap the result without
      // touching the admin's SQL; their own LIMIT still applies inside.
      const guarded = `SELECT * FROM (${statement}) AS op LIMIT ${operation.row_limit + 1}`;
      const result = await client.query(guarded, values);
      const all = result.rows as Record<string, unknown>[];
      truncated = all.length > operation.row_limit;
      rows = all.slice(0, operation.row_limit);
      rowCount = rows.length;
    } else {
      const result = await client.query(statement, values);
      rowCount = result.rowCount ?? 0;
      rows = (result.rows ?? []).slice(
        0,
        operation.row_limit
      ) as Record<string, unknown>[];
    }

    const rollback = !isRead && args.dryRun === true;
    await client.query(rollback ? 'ROLLBACK' : 'COMMIT');

    return { rows, rowCount, truncated, rolledBack: rollback };
  } catch (err) {
    // Roll back a half-applied write before the socket closes.
    await client.query('ROLLBACK').catch(() => {});
    throw asIntegrationError(err, 'Postgres');
  } finally {
    await client.end().catch(() => {});
  }
}

// ------------------------------------------------------------
// MySQL
// ------------------------------------------------------------

/**
 * MySQL uses positional `?` placeholders, but operations are authored
 * and validated with Postgres-style `$1`. Translating here keeps ONE
 * statement syntax for admins and one validation path, instead of a
 * per-backend dialect the UI would have to explain.
 */
function toMysqlPlaceholders(statement: string): string {
  return statement.replace(/\$(\d+)/g, '?');
}

async function executeMysql(args: ExecuteArgs): Promise<ExecuteResult> {
  const { connection, operation, contact, secret } = args;
  if (!secret) {
    throw new IntegrationError(
      `Connection "${connection.name}" has no connection string saved.`
    );
  }
  await assertRoutableConnectionString(secret);

  const values = resolveBindings(contact, operation.bindings);
  const statement = toMysqlPlaceholders(
    operation.statement.trim().replace(/;+\s*$/, '')
  );
  const isRead = operation.mode === 'read';

  // `$1` is not ordered by appearance but by number, and resolveBindings
  // already returns values ordered by param, so a statement that uses
  // `$2` before `$1` would bind the wrong way round once translated to
  // anonymous `?`. Reject rather than silently mis-bind.
  assertPlaceholdersInOrder(operation.statement);

  const conn = await createMysqlConnection({
    uri: secret,
    connectTimeout: operation.timeout_ms,
    ssl: /[?&]sslmode=no-verify\b/.test(secret)
      ? { rejectUnauthorized: false }
      : {},
    // Never allow several statements in one round trip; this is MySQL's
    // stacked-query footgun and it is off by default, but be explicit.
    multipleStatements: false,
  });

  try {
    await conn.query(
      isRead ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION'
    );
    // MySQL's per-statement cap is in milliseconds and SELECT-only, so
    // it complements rather than replaces the socket timeout above.
    await conn
      .query(`SET SESSION MAX_EXECUTION_TIME = ${operation.timeout_ms}`)
      .catch(() => {
        // MariaDB and older MySQL do not have this variable; the driver
        // timeout still applies, so this is not fatal.
      });

    let rows: Record<string, unknown>[] = [];
    let rowCount = 0;
    let truncated = false;

    if (isRead) {
      const guarded = `SELECT * FROM (${statement}) AS op LIMIT ${operation.row_limit + 1}`;
      const [result] = await conn.query(guarded, values);
      const all = (Array.isArray(result) ? result : []) as Record<
        string,
        unknown
      >[];
      truncated = all.length > operation.row_limit;
      rows = all.slice(0, operation.row_limit);
      rowCount = rows.length;
    } else {
      const [result] = await conn.query(statement, values);
      rowCount =
        result && typeof result === 'object' && 'affectedRows' in result
          ? Number((result as { affectedRows: number }).affectedRows)
          : 0;
    }

    const rollback = !isRead && args.dryRun === true;
    await conn.query(rollback ? 'ROLLBACK' : 'COMMIT');

    return { rows, rowCount, truncated, rolledBack: rollback };
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    throw asIntegrationError(err, 'MySQL');
  } finally {
    await conn.end().catch(() => {});
  }
}

function assertPlaceholdersInOrder(statement: string): void {
  const seen = [...statement.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  for (let i = 0; i < seen.length; i += 1) {
    if (seen[i] !== i + 1) {
      throw new IntegrationError(
        'On MySQL, parameters must appear in order ($1 before $2, and so on).'
      );
    }
  }
}

// ------------------------------------------------------------
// REST
// ------------------------------------------------------------

async function executeRest(args: ExecuteArgs): Promise<ExecuteResult> {
  const { connection, operation, contact, secret } = args;
  if (!connection.base_url) {
    throw new IntegrationError(
      `Connection "${connection.name}" has no base URL saved.`
    );
  }

  const path = resolveRestPath(contact, operation.statement);
  // Resolve against base_url, then re-check the prefix. Resolution alone
  // is not enough: a template beginning "/" would resolve to the origin
  // root and escape a base_url that includes a path segment.
  const base = connection.base_url.endsWith('/')
    ? connection.base_url
    : `${connection.base_url}/`;
  const url = new URL(path.replace(/^\/+/, ''), base).toString();
  if (!url.startsWith(base) && url !== connection.base_url) {
    throw new IntegrationError(
      'Resolved URL falls outside the connection base URL.'
    );
  }
  if (!(await isDeliverableUrl(url))) {
    throw new IntegrationError(
      'Endpoint must be publicly reachable and cannot use a private or loopback address.'
    );
  }

  const headers: Record<string, string> = { accept: 'application/json' };
  if (secret) headers.authorization = `Bearer ${secret}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), operation.timeout_ms);
  try {
    const res = await fetch(url, {
      // A read must not be able to mutate the client's system, so the
      // verb is fixed here rather than taken from config.
      method: operation.mode === 'read' ? 'GET' : 'POST',
      headers,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      // Do not let a public endpoint redirect us into a private network.
      redirect: 'manual',
    });
    if (!res.ok) {
      throw new IntegrationError(
        `Endpoint responded ${res.status} ${res.statusText}.`
      );
    }
    const body = await res.json().catch(() => {
      throw new IntegrationError('Endpoint did not return valid JSON.');
    });

    const all = Array.isArray(body)
      ? (body as Record<string, unknown>[])
      : [body as Record<string, unknown>];
    const truncated = all.length > operation.row_limit;
    const rows = all.slice(0, operation.row_limit);
    return {
      rows,
      rowCount: rows.length,
      truncated,
      // HTTP has no transaction to roll back, so a REST write cannot be
      // dry-run. Say so instead of implying the call was reverted.
      rolledBack: false,
    };
  } catch (err) {
    throw asIntegrationError(err, 'Endpoint');
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

async function assertRoutableConnectionString(secret: string): Promise<void> {
  // A connection string is as attacker-influenced as a webhook URL (any
  // admin can save one) and we dial it from our own network, so it gets
  // the same host check: without it, `…@127.0.0.1:5432/postgres` or a
  // link-local metadata address turns an integration into a port scanner
  // against internal infrastructure.
  if (!(await isDeliverableUrl(secret))) {
    throw new IntegrationError(
      'Connection host must be a publicly routable address.'
    );
  }
}

function asIntegrationError(err: unknown, label: string): IntegrationError {
  if (err instanceof IntegrationError) return err;
  if ((err as Error)?.name === 'AbortError') {
    return new IntegrationError(`${label} timed out.`);
  }
  return new IntegrationError(`${label} failed: ${(err as Error).message}`);
}

// ============================================================
// External source recipient fetcher.
//
// Server-only module: decrypted secrets flow through here, so it
// must never be imported by client components. The dispatcher
// (`fetchRecipients`) routes to one of three adapters, then every
// row goes through the same normalization funnel:
//
//   raw row → field_map projection → phone sanitize/validate →
//   dedupe by phone → cap at EXTERNAL_FETCH_CAP.
//
// The cap check counts *source* rows (before validation), so a
// 50k-row sheet reports capped=true even if only 9k rows have valid
// phones — we want users to filter at the source, not rely on
// invalid rows keeping them under the limit.
// ============================================================

import { Client as PgClient } from 'pg';

import { isValidE164, sanitizePhoneForMeta } from '@/features/whatsapp/lib/phone-utils';
import { isDeliverableUrl } from '@/features/webhooks/lib/ssrf';

import {
  EXTERNAL_FETCH_CAP,
  FETCH_TIMEOUT_MS,
  type ExternalSourceType,
  type FieldMap,
  type FetchRecipientsResult,
  type FetchedRecipient,
  type GoogleSheetSourceConfig,
  type PostgresSourceConfig,
  type RestSourceConfig,
  type SourceConfig,
} from './types';

/** Raised for user-actionable configuration/connectivity problems. */
export class ExternalSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalSourceError';
  }
}

interface FetchArgs {
  type: ExternalSourceType;
  config: SourceConfig;
  fieldMap: FieldMap;
  /** Decrypted secret (bearer token / header value / pg connection string). */
  secret: string | null;
  /** Stop early once this many *source* rows have been seen. */
  maxRows?: number;
}

export async function fetchRecipients(
  args: FetchArgs
): Promise<FetchRecipientsResult> {
  const maxRows = args.maxRows ?? EXTERNAL_FETCH_CAP;

  let rows: Record<string, unknown>[];
  let sawMore = false;

  switch (args.type) {
    case 'rest': {
      const r = await fetchRestRows(
        args.config as RestSourceConfig,
        args.secret,
        maxRows
      );
      rows = r.rows;
      sawMore = r.sawMore;
      break;
    }
    case 'postgres': {
      const r = await fetchPostgresRows(
        args.config as PostgresSourceConfig,
        args.secret,
        maxRows
      );
      rows = r.rows;
      sawMore = r.sawMore;
      break;
    }
    case 'google_sheet': {
      const r = await fetchSheetRows(
        args.config as GoogleSheetSourceConfig,
        maxRows
      );
      rows = r.rows;
      sawMore = r.sawMore;
      break;
    }
    default:
      throw new ExternalSourceError(`Unknown source type: ${args.type}`);
  }

  return normalizeRows(rows, args.fieldMap, sawMore);
}

// ------------------------------------------------------------
// Normalization funnel (shared by all adapters)
// ------------------------------------------------------------

function normalizeRows(
  rows: Record<string, unknown>[],
  fieldMap: FieldMap,
  capped: boolean
): FetchRecipientsResult {
  const seen = new Set<string>();
  const recipients: FetchedRecipient[] = [];
  let invalid = 0;

  for (const row of rows) {
    const rawPhone = toCellString(getPath(row, fieldMap.phone));
    const phone = sanitizePhoneForMeta(rawPhone);
    if (!phone || !isValidE164(phone)) {
      invalid++;
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);

    const params: Record<string, string> = {};
    if (fieldMap.params) {
      for (const [idx, field] of Object.entries(fieldMap.params)) {
        if (!field) continue;
        params[idx] = toCellString(getPath(row, field));
      }
    }

    recipients.push({
      phone,
      name: fieldMap.name
        ? toCellString(getPath(row, fieldMap.name)) || undefined
        : undefined,
      params,
    });
  }

  return { recipients, total: rows.length, capped, invalid };
}

/** Resolve a dot-path ("parent.phone") against a record. */
function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function toCellString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

// ------------------------------------------------------------
// REST adapter
// ------------------------------------------------------------

async function fetchRestRows(
  config: RestSourceConfig,
  secret: string | null,
  maxRows: number
): Promise<{ rows: Record<string, unknown>[]; sawMore: boolean }> {
  if (!config.url) throw new ExternalSourceError('REST source has no URL');
  await assertPublicHttpUrl(config.url);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (secret && config.authStyle === 'bearer') {
    headers['Authorization'] = `Bearer ${secret}`;
  } else if (secret && config.authStyle === 'header') {
    const headerName = (config.authHeader || '').trim();
    if (!headerName) {
      throw new ExternalSourceError(
        'REST source uses a custom auth header but no header name is configured'
      );
    }
    headers[headerName] = secret;
  }

  const rows: Record<string, unknown>[] = [];
  let nextUrl: string | null = config.url;
  let sawMore = false;
  // Page guard independent of the row cap so a buggy `next` loop
  // can't spin forever on tiny pages.
  const MAX_PAGES = 200;
  let pages = 0;

  while (nextUrl && rows.length <= maxRows && pages < MAX_PAGES) {
    pages++;
    const body = await fetchJson(nextUrl, headers);

    const items = config.itemsPath ? getPath(body, config.itemsPath) : body;
    if (!Array.isArray(items)) {
      throw new ExternalSourceError(
        config.itemsPath
          ? `Response field "${config.itemsPath}" is not an array`
          : 'Response body is not a JSON array — set the "items path" to point at the record array'
      );
    }

    for (const item of items) {
      if (item && typeof item === 'object') {
        rows.push(item as Record<string, unknown>);
        if (rows.length > maxRows) {
          sawMore = true;
          break;
        }
      }
    }
    if (sawMore) break;

    if (config.nextPagePath) {
      const next = getPath(body, config.nextPagePath);
      nextUrl =
        typeof next === 'string' && next.trim()
          ? new URL(next, nextUrl).toString()
          : null;
      if (nextUrl) await assertPublicHttpUrl(nextUrl);
    } else {
      nextUrl = null;
    }
  }

  if (nextUrl && pages >= MAX_PAGES) sawMore = true;
  return { rows: rows.slice(0, maxRows), sawMore };
}

async function assertPublicHttpUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExternalSourceError(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ExternalSourceError('Only http(s) URLs are supported');
  }
  if (!(await isDeliverableUrl(raw))) {
    throw new ExternalSourceError(
      'REST endpoint must be publicly reachable and cannot use a private or loopback address'
    );
  }
}

async function fetchJson(
  url: string,
  headers: Record<string, string>
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      // Never forward cookies/credentials to external hosts.
      credentials: 'omit',
      cache: 'no-store',
      // A public URL must not redirect the server into a private network.
      redirect: 'manual',
    });
    if (!res.ok) {
      throw new ExternalSourceError(
        `Endpoint responded ${res.status} ${res.statusText}`
      );
    }
    return await res.json().catch(() => {
      throw new ExternalSourceError('Endpoint did not return valid JSON');
    });
  } catch (err) {
    if (err instanceof ExternalSourceError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new ExternalSourceError(
        `Endpoint timed out after ${FETCH_TIMEOUT_MS / 1000}s`
      );
    }
    throw new ExternalSourceError(
      `Could not reach endpoint: ${(err as Error).message}`
    );
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Postgres adapter
// ------------------------------------------------------------

async function fetchPostgresRows(
  config: PostgresSourceConfig,
  secret: string | null,
  maxRows: number
): Promise<{ rows: Record<string, unknown>[]; sawMore: boolean }> {
  if (!secret) {
    throw new ExternalSourceError(
      'Postgres source has no connection string saved'
    );
  }
  const query = (config.query || '').trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(query)) {
    throw new ExternalSourceError(
      'Only read-only SELECT (or WITH … SELECT) queries are allowed'
    );
  }

  const client = new PgClient({
    connectionString: secret,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: FETCH_TIMEOUT_MS,
    // Applied server-side per-session below as well; this guards the socket.
    query_timeout: FETCH_TIMEOUT_MS * 2,
  });

  try {
    await client.connect();
    // Belt and braces: read-only transaction + statement timeout so a
    // hostile/mistaken query can't write or hog the remote DB.
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${FETCH_TIMEOUT_MS * 2}`);
    // Wrap the user query so we can append a LIMIT guard without
    // parsing their SQL (their own LIMIT still applies inside).
    const guarded = `SELECT * FROM (${query}) AS ext_src LIMIT ${maxRows + 1}`;
    const result = await client.query(guarded);
    await client.query('COMMIT');

    const rows = result.rows as Record<string, unknown>[];
    const sawMore = rows.length > maxRows;
    return { rows: rows.slice(0, maxRows), sawMore };
  } catch (err) {
    if (err instanceof ExternalSourceError) throw err;
    throw new ExternalSourceError(
      `Postgres query failed: ${(err as Error).message}`
    );
  } finally {
    // end() is safe even if connect() failed.
    await client.end().catch(() => {});
  }
}

// ------------------------------------------------------------
// Google Sheet adapter (public / link-shared sheets, CSV export)
// ------------------------------------------------------------

async function fetchSheetRows(
  config: GoogleSheetSourceConfig,
  maxRows: number
): Promise<{ rows: Record<string, unknown>[]; sawMore: boolean }> {
  const csvUrl = toCsvExportUrl(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let text: string;
  try {
    const res = await fetch(csvUrl, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new ExternalSourceError(
        res.status === 401 || res.status === 403 || res.status === 302
          ? 'Sheet is not shared — set link sharing to "Anyone with the link can view"'
          : `Google returned ${res.status} for the sheet export`
      );
    }
    text = await res.text();
  } catch (err) {
    if (err instanceof ExternalSourceError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new ExternalSourceError(
        `Sheet download timed out after ${FETCH_TIMEOUT_MS / 1000}s`
      );
    }
    throw new ExternalSourceError(
      `Could not download sheet: ${(err as Error).message}`
    );
  } finally {
    clearTimeout(timer);
  }

  // Google serves an HTML login page (200) for private sheets fetched
  // without cookies — detect that before trying to parse as CSV.
  if (/^\s*</.test(text)) {
    throw new ExternalSourceError(
      'Sheet is not shared — set link sharing to "Anyone with the link can view"'
    );
  }

  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new ExternalSourceError(
      'Sheet appears empty (needs a header row plus data rows)'
    );
  }

  const headers = parseCsvLine(lines[0]).map((h) =>
    h.replace(/["']/g, '').trim()
  );

  const rows: Record<string, unknown>[] = [];
  let sawMore = false;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (rows.length >= maxRows) {
      sawMore = true;
      break;
    }
    const values = parseCsvLine(lines[i]);
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (h) row[h] = values[idx]?.replace(/^"|"$/g, '').trim() ?? '';
    });
    rows.push(row);
  }

  return { rows, sawMore };
}

/** Derive the CSV export URL from a normal sheet URL (or accept one). */
export function toCsvExportUrl(config: GoogleSheetSourceConfig): string {
  const raw = (config.url || '').trim();
  if (!raw) throw new ExternalSourceError('Google Sheet source has no URL');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExternalSourceError(`Invalid sheet URL: ${raw}`);
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) {
    throw new ExternalSourceError('URL must be a docs.google.com sheet link');
  }
  // Already an export URL → keep as-is (but force csv format).
  if (url.pathname.includes('/export')) {
    url.searchParams.set('format', 'csv');
    return url.toString();
  }
  const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new ExternalSourceError(
      'Could not find the spreadsheet ID in the URL — paste the full sheet link'
    );
  }
  const gid =
    config.gid?.trim() ||
    url.searchParams.get('gid') ||
    (url.hash.match(/gid=(\d+)/)?.[1] ?? '');
  const gidParam = gid ? `&gid=${encodeURIComponent(gid)}` : '';
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv${gidParam}`;
}

/** Simple CSV line parse (handles quoted fields) — mirrors parse-contact-csv. */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

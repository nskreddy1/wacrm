// ============================================================
// External recipient sources — shared types.
//
// An "external source" is a workspace-configured connector to an
// outside system (school database, CRM, spreadsheet) that can be
// pulled at broadcast time to produce a recipient list. Three
// connector types are supported:
//
//   rest         — JSON HTTP endpoint (recommended default)
//   postgres     — read-only SELECT over a pg connection string
//   google_sheet — public/CSV-export Google Sheet
//
// Secrets (bearer tokens, connection strings) live in the
// `encrypted_secret` column, AES-256-GCM encrypted with the same
// ENCRYPTION_KEY used for WhatsApp tokens. They are write-only from
// the client's perspective: never returned by any GET.
// ============================================================

export type ExternalSourceType = 'rest' | 'postgres' | 'google_sheet';

/**
 * Hard ceiling on recipients fetched per broadcast. Above this the
 * fetch is rejected with guidance to filter at the source. Keeps the
 * client fan-out pipeline (and Meta rate limits) within sane bounds.
 */
export const EXTERNAL_FETCH_CAP = 10_000;

/** Per-request timeout for REST page fetches / sheet downloads. */
export const FETCH_TIMEOUT_MS = 15_000;

// ------------------------------------------------------------
// Per-type config (stored in the `config` jsonb column — NO secrets)
// ------------------------------------------------------------

export interface RestSourceConfig {
  /** Full URL of the JSON endpoint, including any query params. */
  url: string;
  /** How the decrypted secret is sent. 'bearer' → Authorization: Bearer <secret>; 'header' → custom header. */
  authStyle?: 'none' | 'bearer' | 'header';
  /** Header name when authStyle === 'header' (e.g. "X-API-Key"). */
  authHeader?: string;
  /**
   * Dot-path to the array of records in the response body.
   * Empty/absent means the body itself is the array.
   * e.g. "data" or "result.students".
   */
  itemsPath?: string;
  /**
   * Dot-path to the next-page URL (absolute or relative) in the
   * response body, e.g. "next" or "meta.next_page". Absent = single page.
   */
  nextPagePath?: string;
}

export interface PostgresSourceConfig {
  /**
   * Read-only SELECT statement. Must start with SELECT/WITH; the
   * server appends a LIMIT guard and sets a statement timeout.
   * Column names become field-map keys.
   */
  query: string;
}

export interface GoogleSheetSourceConfig {
  /**
   * Regular sheet URL (https://docs.google.com/spreadsheets/d/<id>/...)
   * or a direct CSV export URL. The server derives the CSV export URL.
   */
  url: string;
  /** Optional gid of the tab to export (defaults to first tab). */
  gid?: string;
}

export type SourceConfig =
  | RestSourceConfig
  | PostgresSourceConfig
  | GoogleSheetSourceConfig;

// ------------------------------------------------------------
// Field mapping (stored in the `field_map` jsonb column)
// ------------------------------------------------------------

/**
 * Maps source columns/fields to recipient fields.
 *  - `phone` — required; source field containing the phone number.
 *  - `name`  — optional; display name field.
 *  - `params` — optional; template variable index → source field,
 *    e.g. { "1": "student_name", "2": "class_room" } lets template
 *    {{1}}/{{2}} bind to those columns.
 *
 * For REST sources, values are dot-paths into each record
 * (e.g. "parent.phone"); for postgres/sheets they are column names.
 */
export interface FieldMap {
  phone: string;
  name?: string;
  params?: Record<string, string>;
}

// ------------------------------------------------------------
// Row + result types
// ------------------------------------------------------------

/** One normalized recipient pulled from an external source. */
export interface FetchedRecipient {
  /** Digits-only phone (already passed sanitize + E.164 validation). */
  phone: string;
  name?: string;
  /** Template variable values keyed by variable index ("1", "2", …). */
  params: Record<string, string>;
}

export interface FetchRecipientsResult {
  recipients: FetchedRecipient[];
  /** Rows seen before the cap/validation (for "N of M valid" UI). */
  total: number;
  /** True when the source had more rows than EXTERNAL_FETCH_CAP. */
  capped: boolean;
  /** Rows dropped due to missing/invalid phone. */
  invalid: number;
}

/** DB row shape exposed to the client (no encrypted_secret). */
export interface ExternalSource {
  id: string;
  account_id: string;
  name: string;
  type: ExternalSourceType;
  config: SourceConfig;
  field_map: FieldMap;
  /** True when a secret is stored (the value itself never leaves the server). */
  has_secret?: boolean;
  last_tested_at: string | null;
  last_row_count: number | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Input validation for external source create/update payloads.
// Shared by POST /api/external-sources and PATCH …/[id] so both
// enforce identical shape rules. Returns a normalized value or a
// user-facing error string — no exceptions for expected bad input.
// ============================================================

import type {
  ExternalSourceType,
  FieldMap,
  SourceConfig,
} from './types';

export const MAX_NAME_LEN = 80;
const MAX_FIELD_LEN = 200;
const MAX_URL_LEN = 2000;
const MAX_QUERY_LEN = 5000;
const MAX_PARAMS = 20;

const TYPES: ExternalSourceType[] = ['rest', 'postgres', 'google_sheet'];

export function isSourceType(v: unknown): v is ExternalSourceType {
  return typeof v === 'string' && TYPES.includes(v as ExternalSourceType);
}

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateName(raw: unknown): Validated<string> {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return { ok: false, error: "'name' is required" };
  if (name.length > MAX_NAME_LEN) {
    return {
      ok: false,
      error: `Name must be ${MAX_NAME_LEN} characters or fewer`,
    };
  }
  return { ok: true, value: name };
}

export function validateConfig(
  type: ExternalSourceType,
  raw: unknown
): Validated<SourceConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: "'config' must be an object" };
  }
  const cfg = raw as Record<string, unknown>;

  const str = (key: string, max: number): string | null => {
    const v = cfg[key];
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || v.length > max) return null;
    return v.trim();
  };

  if (type === 'rest') {
    const url = str('url', MAX_URL_LEN);
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'REST source needs a valid http(s) URL' };
    }
    const authStyle = str('authStyle', 20);
    if (authStyle && !['none', 'bearer', 'header'].includes(authStyle)) {
      return { ok: false, error: "authStyle must be 'none', 'bearer' or 'header'" };
    }
    const authHeader = str('authHeader', 100);
    if (authStyle === 'header') {
      if (!authHeader || !/^[a-zA-Z0-9-]+$/.test(authHeader)) {
        return {
          ok: false,
          error: 'Custom auth header name must be set (letters, digits, dashes)',
        };
      }
    }
    return {
      ok: true,
      value: {
        url,
        authStyle: (authStyle as 'none' | 'bearer' | 'header') || 'none',
        ...(authHeader ? { authHeader } : {}),
        ...(str('itemsPath', MAX_FIELD_LEN)
          ? { itemsPath: str('itemsPath', MAX_FIELD_LEN)! }
          : {}),
        ...(str('nextPagePath', MAX_FIELD_LEN)
          ? { nextPagePath: str('nextPagePath', MAX_FIELD_LEN)! }
          : {}),
      },
    };
  }

  if (type === 'postgres') {
    const query = typeof cfg.query === 'string' ? cfg.query.trim() : '';
    if (!query) {
      return { ok: false, error: 'Postgres source needs a SELECT query' };
    }
    if (query.length > MAX_QUERY_LEN) {
      return {
        ok: false,
        error: `Query must be ${MAX_QUERY_LEN} characters or fewer`,
      };
    }
    if (!/^(select|with)\b/i.test(query)) {
      return {
        ok: false,
        error: 'Query must start with SELECT (or WITH … SELECT)',
      };
    }
    return { ok: true, value: { query } };
  }

  // google_sheet
  const url = str('url', MAX_URL_LEN);
  if (!url || !/^https:\/\/docs\.google\.com\//i.test(url)) {
    return {
      ok: false,
      error: 'Google Sheet source needs a docs.google.com link',
    };
  }
  const gid = str('gid', 20);
  if (gid && !/^\d+$/.test(gid)) {
    return { ok: false, error: 'Sheet gid must be numeric' };
  }
  return { ok: true, value: { url, ...(gid ? { gid } : {}) } };
}

export function validateFieldMap(raw: unknown): Validated<FieldMap> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: "'fieldMap' must be an object" };
  }
  const fm = raw as Record<string, unknown>;

  const phone = typeof fm.phone === 'string' ? fm.phone.trim() : '';
  if (!phone || phone.length > MAX_FIELD_LEN) {
    return {
      ok: false,
      error: 'Field mapping needs a phone column/field name',
    };
  }

  const name =
    typeof fm.name === 'string' && fm.name.trim()
      ? fm.name.trim().slice(0, MAX_FIELD_LEN)
      : undefined;

  let params: Record<string, string> | undefined;
  if (fm.params != null) {
    if (typeof fm.params !== 'object' || Array.isArray(fm.params)) {
      return { ok: false, error: "'fieldMap.params' must be an object" };
    }
    const entries = Object.entries(fm.params as Record<string, unknown>);
    if (entries.length > MAX_PARAMS) {
      return {
        ok: false,
        error: `At most ${MAX_PARAMS} template variables can be mapped`,
      };
    }
    params = {};
    for (const [key, value] of entries) {
      if (!/^\d{1,2}$/.test(key)) {
        return {
          ok: false,
          error: 'Template variable keys must be numeric ("1", "2", …)',
        };
      }
      if (typeof value !== 'string' || !value.trim()) continue;
      params[key] = value.trim().slice(0, MAX_FIELD_LEN);
    }
  }

  return {
    ok: true,
    value: { phone, ...(name ? { name } : {}), ...(params ? { params } : {}) },
  };
}

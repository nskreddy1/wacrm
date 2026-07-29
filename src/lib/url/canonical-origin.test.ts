import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalOrigin, canonicalRequestUrl } from './canonical-origin';

/**
 * These guard the OAuth redirect_uri contract. A regression here does not
 * throw — it silently produces a URL that providers reject with
 * `redirect_uri_mismatch`, or a postMessage target the browser drops,
 * which presents as "the popup hangs forever". Cheap to test, expensive
 * to debug in production.
 */

const ENV_KEYS = [
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe('canonicalOrigin', () => {
  it('prefers explicit NEXT_PUBLIC_SITE_URL over everything else', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';
    const origin = canonicalOrigin(
      req('http://localhost:3000/api/x', {
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'https',
      })
    );
    expect(origin).toBe('https://app.example.com');
  });

  it('strips any path from the configured site URL', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com/dashboard/';
    expect(canonicalOrigin(req('http://localhost:3000/api/x'))).toBe(
      'https://app.example.com'
    );
  });

  it('accepts a bare hostname and assumes https', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'app.example.com';
    expect(canonicalOrigin(req('http://localhost:3000/api/x'))).toBe(
      'https://app.example.com'
    );
  });

  it('falls through to forwarded headers when the env value is malformed', () => {
    // A typo in config must degrade, not cause an outage.
    process.env.NEXT_PUBLIC_SITE_URL = 'ht!tp:// not a url';
    const origin = canonicalOrigin(
      req('http://localhost:3000/api/x', {
        'x-forwarded-host': 'proxy.example.com',
        'x-forwarded-proto': 'https',
      })
    );
    expect(origin).toBe('https://proxy.example.com');
  });

  it('uses forwarded headers when no explicit origin is set', () => {
    const origin = canonicalOrigin(
      req('http://localhost:3000/api/alerts/connectors/slack/callback', {
        'x-forwarded-host': 'preview.vusercontent.net',
        'x-forwarded-proto': 'https',
      })
    );
    // The whole point: NOT localhost.
    expect(origin).toBe('https://preview.vusercontent.net');
  });

  it('takes only the first entry of a comma-separated forwarded chain', () => {
    // Later entries are upstream-supplied and less trustworthy.
    const origin = canonicalOrigin(
      req('http://localhost:3000/api/x', {
        'x-forwarded-host': 'outermost.example.com, inner.example.com',
        'x-forwarded-proto': 'https, http',
      })
    );
    expect(origin).toBe('https://outermost.example.com');
  });

  it('defaults a forwarded host to https when proto is absent', () => {
    const origin = canonicalOrigin(
      req('http://localhost:3000/api/x', {
        'x-forwarded-host': 'proxy.example.com',
      })
    );
    expect(origin).toBe('https://proxy.example.com');
  });

  it('falls back to the Vercel deployment host', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'wacrm.vercel.app';
    expect(canonicalOrigin(req('http://localhost:3000/api/x'))).toBe(
      'https://wacrm.vercel.app'
    );
  });

  it('uses the request origin for direct, unproxied deployments', () => {
    // Local dev with no proxy is a legitimate case and must still work.
    expect(canonicalOrigin(req('http://localhost:3000/api/x'))).toBe(
      'http://localhost:3000'
    );
  });
});

describe('canonicalRequestUrl', () => {
  it('preserves path and query while swapping the origin', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.com';
    const url = canonicalRequestUrl(
      req('http://localhost:3000/api/hook?code=abc&state=xyz')
    );
    expect(url).toBe('https://app.example.com/api/hook?code=abc&state=xyz');
  });
});

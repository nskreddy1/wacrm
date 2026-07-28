/**
 * Canonical public origin resolution.
 *
 * Behind Vercel (and any reverse proxy) `request.url` reflects the
 * *internal* origin — typically `http://localhost:3000` — not the URL the
 * browser actually visited. Anything that must round-trip through a third
 * party or the user's browser has to use the public origin instead:
 *
 * - OAuth `redirect_uri` — providers match it byte-for-byte against the
 *   value registered in their dashboard. `localhost` never matches, and
 *   the authorize step and token-exchange step must agree exactly or the
 *   exchange fails with `redirect_uri_mismatch`.
 * - `postMessage` target origins — a wrong target is silently dropped by
 *   the browser, so a popup would appear to hang forever.
 * - Webhook callback URLs handed to providers.
 *
 * Resolution order (most trustworthy first):
 *   1. `NEXT_PUBLIC_SITE_URL` — the operator's explicit canonical origin.
 *      Deliberately first: it is the only source not derived from a
 *      request, so it cannot be influenced by a caller.
 *   2. `x-forwarded-proto` / `x-forwarded-host` — set by Vercel and
 *      standard proxies. Only the first value in a comma-separated list
 *      is used (the outermost proxy appends, so later entries are
 *      upstream-supplied and less trustworthy).
 *   3. `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` — deployment
 *      hostnames injected by the platform; always https.
 *   4. `request.url` — correct for direct, unproxied deployments.
 *
 * Security note: `x-forwarded-host` is caller-supplied in a
 * non-proxied deployment, so it must never be used to build a redirect
 * the app itself follows. For OAuth it is safe because the provider
 * independently validates `redirect_uri` against its own allowlist — a
 * spoofed host produces a failed exchange, not a redirect to an
 * attacker. Set `NEXT_PUBLIC_SITE_URL` in production to remove the
 * ambiguity entirely.
 */

/** Hostname chars permitted by DNS, plus IPv6 literal brackets/colons. */
const VALID_HOSTNAME = /^[a-z0-9.\-[\]:]+$/i;

function normalizeOrigin(candidate: string): string | null {
  const trimmed = candidate.trim();
  // Whitespace inside a URL is always a config error. Bail early rather
  // than letting the URL parser coerce it into a surprising hostname.
  if (!trimmed || /\s/.test(trimmed)) return null;

  try {
    // Accept bare hostnames ("example.com") as well as full URLs.
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withScheme);

    // `new URL` is permissive: it happily parses "https://ht!tp://x" into
    // the host "ht!tp". Validate explicitly so a typo falls through to
    // the next source instead of producing a silently broken origin that
    // every OAuth provider would reject.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname || !VALID_HOSTNAME.test(url.hostname)) return null;
    // A hostname must contain a dot (a public domain) or be a bare local
    // name like "localhost" — never something like "ht!tp" or "a b".
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function canonicalOrigin(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    const origin = normalizeOrigin(explicit);
    if (origin) return origin;
    // Malformed env value: fall through rather than hard-failing, so a
    // typo degrades to "works via proxy headers" instead of an outage.
  }

  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  if (forwardedHost) {
    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
      'https';
    const origin = normalizeOrigin(`${proto}://${forwardedHost}`);
    if (origin) return origin;
  }

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim();
  if (vercelHost) {
    const origin = normalizeOrigin(vercelHost);
    if (origin) return origin;
  }

  return new URL(request.url).origin;
}

/**
 * The canonical public URL for this request, preserving path and query.
 * Used where a provider signed against the full URL it called.
 */
export function canonicalRequestUrl(request: Request): string {
  const { pathname, search } = new URL(request.url);
  return `${canonicalOrigin(request)}${pathname}${search}`;
}

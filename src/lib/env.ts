/**
 * src/lib/env.ts — the canonical environment contract.
 *
 * WHY THIS EXISTS
 * Environment names had drifted into several spellings of the same
 * secret (four names for the service-role key, four for the database
 * URL, two for the anon key), each duplicated across 7+ call sites.
 * Every duplicate is a place where a rename silently half-lands: the
 * webhook keeps working while the cron job starts failing closed, and
 * nothing in CI notices.
 *
 * So there is exactly ONE rule:
 *
 *   Legacy / alias environment names are resolved HERE and nowhere
 *   else. Application code asks for a *value*, never a name.
 *
 * `scripts/check-env-completeness.mjs --contract` enforces that
 * mechanically: an alias name appearing in any file other than this one
 * fails CI, as does a code reference to an env var that no manifest
 * documents, or a server secret smuggled behind a `NEXT_PUBLIC_` prefix.
 *
 * CONVENTIONS
 * - Required getters throw `MissingEnvError` naming every accepted
 *   spelling, so an operator reading the message knows what to set.
 * - Optional getters return `undefined`. Callers must degrade to a
 *   no-op (observability sinks) or fail closed (webhook signature
 *   verification) — never fail open.
 * - Values are read at call time, never cached at module scope. The
 *   Workers runtime populates `process.env` per-isolate and tests
 *   mutate it between cases; caching would freeze the first read.
 * - Empty and whitespace-only values are treated as absent. A blank
 *   secret in a CI matrix is a missing secret, not a valid one.
 *
 * DELIBERATELY NOT HERE
 * - `HYPERDRIVE` (production SQL) is a Cloudflare *binding*, not an env
 *   var; it is resolved in `src/lib/db/client.ts`.
 * - The Supabase direct-connection URL and the Cloudflare API token are
 *   CI/deploy-only names, so they are not spelled out here: ARCH-010
 *   forbids those literals anywhere under `src/`, and this file is not
 *   exempt from its own rules. They are resolved for standalone scripts
 *   in `scripts/lib/db-url.mjs`; see that file (or the ARCH-010 rule in
 *   `scripts/check-architecture.mjs`) for the exact variable names.
 * - `NEXT_PUBLIC_*` values consumed in the browser stay inline in the
 *   component that needs them: Next.js inlines those at build time by
 *   matching the literal `process.env.NEXT_PUBLIC_FOO` text, so routing
 *   them through a function would leave the client with `undefined`.
 */

/** Thrown when a required variable is absent under every accepted name. */
export class MissingEnvError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[], hint?: string) {
    super(
      `Missing required environment variable: ${names.join(' or ')}.` +
        (hint ? ` ${hint}` : '')
    );
    this.name = 'MissingEnvError';
    this.names = names;
  }
}

/** A present, non-blank value, or `undefined`. */
function read(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** First present value across the accepted spellings, most-canonical first. */
function firstOf(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = read(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Like {@link firstOf}, but throws a named error instead of returning undefined. */
function requireFirstOf(names: readonly string[], hint?: string): string {
  const value = firstOf(names);
  if (value === undefined) throw new MissingEnvError(names, hint);
  return value;
}

// ---------------------------------------------------------------------------
// Alias registry — the single source of truth for legacy names.
//
// `scripts/check-env-completeness.mjs --contract` imports this list (by
// parsing it out of this file) to prove no alias leaks back into
// application code. Order is resolution order: canonical name first.
// ---------------------------------------------------------------------------

// These two chains are mirrored verbatim in `next.config.ts` (which
// cannot import from `src/` at build time). Their ORDER is part of the
// contract: if the two files disagree, a browser render and a server
// render can resolve to two different Supabase projects. Until this was
// enforced, `next.config.ts` accepted four spellings this file did not —
// `check-env-completeness.mjs --contract` now fails on any divergence.
const SUPABASE_URL_NAMES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_zepo_SUPABASE_URL',
  'SUPABASE_URL',
] as const;

const SUPABASE_ANON_KEY_NAMES = [
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_zepo_SUPABASE_ANON_KEY',
  'zepo_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
] as const;

// The `zepo_`-prefixed spellings are injected by the Supabase↔Vercel
// marketplace integration, which namespaces its variables per linked
// project. They are accepted so an integration-provisioned deployment
// boots without hand-copying keys, but they rank below the explicit
// names so an operator override always wins.
const SUPABASE_SERVICE_ROLE_KEY_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'zepo_SUPABASE_SERVICE_ROLE_KEY',
  'zepo_SUPABASE_SECRET_KEY',
] as const;

const DATABASE_URL_NAMES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
] as const;

// ---------------------------------------------------------------------------
// Supabase (Auth / Storage / Realtime — SQL goes through @/lib/db)
// ---------------------------------------------------------------------------

/**
 * Supabase project URL. `SUPABASE_URL` is accepted because server-only
 * contexts (scripts, the webhook) historically set the unprefixed name.
 */
export function supabaseUrl(): string {
  return requireFirstOf(
    SUPABASE_URL_NAMES,
    'Copy it from Supabase → Project Settings → API.'
  );
}

/** Publishable (anon) key — safe to expose to the browser. */
export function supabaseAnonKey(): string {
  return requireFirstOf(
    SUPABASE_ANON_KEY_NAMES,
    'Copy it from Supabase → Project Settings → API.'
  );
}

/**
 * Service-role key. Bypasses RLS entirely, so every caller must already
 * be a server-only module that scopes its own queries by `account_id`
 * (see `.agents/context/security.md`).
 */
export function supabaseServiceRoleKey(): string {
  return requireFirstOf(
    SUPABASE_SERVICE_ROLE_KEY_NAMES,
    'Copy it from Supabase → Project Settings → API. Server-only — never expose it to the browser.'
  );
}

/** Both halves of a service-role client, resolved together. */
export function supabaseAdminCredentials(): { url: string; key: string } {
  return { url: supabaseUrl(), key: supabaseServiceRoleKey() };
}

/**
 * Whether a service-role client *could* be constructed, without
 * constructing one or throwing. Lets a caller degrade gracefully (skip
 * an optional background sweep) instead of catching an exception to use
 * it as control flow.
 */
export function hasSupabaseAdminConfig(): boolean {
  return (
    firstOf(SUPABASE_URL_NAMES) !== undefined &&
    firstOf(SUPABASE_SERVICE_ROLE_KEY_NAMES) !== undefined
  );
}

// ---------------------------------------------------------------------------
// Database (dev / CI only — production SQL uses the HYPERDRIVE binding)
// ---------------------------------------------------------------------------

/**
 * Postgres connection string for local dev and CI.
 *
 * Optional by design: in production `src/lib/db/client.ts` resolves the
 * Cloudflare `HYPERDRIVE` binding first and only falls back here, so a
 * missing value is a valid production state rather than a boot failure.
 */
export function databaseUrl(): string | undefined {
  return firstOf(DATABASE_URL_NAMES);
}

// ---------------------------------------------------------------------------
// App-level secrets
// ---------------------------------------------------------------------------

/**
 * AES-256-GCM key (64 hex chars) protecting every third-party
 * credential stored in the database. Rotating it orphans all
 * previously-encrypted tokens.
 */
export function encryptionKey(): string {
  return requireFirstOf(
    ['ENCRYPTION_KEY'],
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))".'
  );
}

/** Comma-separated operator emails granted the platform console. */
export function superAdminEmails(): string[] {
  return (firstOf(['SUPER_ADMIN_EMAILS']) ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Cron authorization
//
// Two secrets, NOT one: Vercel Cron cannot send custom headers, so it
// authenticates with `Authorization: Bearer $CRON_SECRET`, while an
// external pinger uses `x-cron-secret: $AUTOMATION_CRON_SECRET`. Each
// secret is valid only in its own transport (see
// `src/features/flows/lib/cron-auth.ts`), so a leak in one channel
// cannot authorize the other. Collapsing them into one value would
// silently discard that property — hence two getters, one reader.
// ---------------------------------------------------------------------------

/** Bearer-token secret used by platform cron schedulers. */
export function vercelCronSecret(): string | undefined {
  return firstOf(['CRON_SECRET']);
}

/** `x-cron-secret` header secret used by external pingers. */
export function automationCronSecret(): string | undefined {
  return firstOf(['AUTOMATION_CRON_SECRET']);
}

/**
 * Both cron secrets in the shape `authorizeCronRequest` expects. The
 * single place every cron route reads its configuration from.
 */
export function cronAuthEnv(): {
  vercelCronSecret?: string;
  automationCronSecret?: string;
} {
  return {
    vercelCronSecret: vercelCronSecret(),
    automationCronSecret: automationCronSecret(),
  };
}

// ---------------------------------------------------------------------------
// Public origin
//
// Resolution/normalization of the canonical origin lives in
// `src/lib/url/canonical-origin.ts` (it also consults proxy headers,
// which are request-scoped). These getters supply the env half.
// ---------------------------------------------------------------------------

/** Operator-configured canonical origin, e.g. `https://auxelon.in`. */
export function siteUrl(): string | undefined {
  return firstOf(['NEXT_PUBLIC_SITE_URL']);
}

/** Platform-injected deployment hostname (no scheme). */
export function deploymentHost(): string | undefined {
  return firstOf(['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL']);
}

// ---------------------------------------------------------------------------
// Meta / WhatsApp Cloud API
//
// OPTIONAL. Per-tenant WhatsApp credentials are configured in-app and
// stored encrypted (`src/lib/crypto/secrets.ts`); these two are the
// *app-level* identifiers. Absent them, webhook signature verification
// fails closed and image-header template submission returns a clear
// error — the rest of the product is unaffected.
// ---------------------------------------------------------------------------

export function metaAppId(): string | undefined {
  return firstOf(['META_APP_ID']);
}

export function metaAppSecret(): string | undefined {
  return firstOf(['META_APP_SECRET']);
}

// ---------------------------------------------------------------------------
// Upstash Redis (rate limiting, read-through cache, concurrency guard)
// ---------------------------------------------------------------------------

/**
 * Redis REST credentials, or `undefined` when either half is missing.
 * Returning a pair (rather than two getters) makes "half-configured" —
 * a URL with no token — impossible to act on by accident.
 */
export function redisCredentials(): { url: string; token: string } | undefined {
  const url = firstOf(['KV_REST_API_URL']);
  const token = firstOf(['KV_REST_API_TOKEN']);
  if (!url || !token) return undefined;
  return { url, token };
}

// ---------------------------------------------------------------------------
// Email delivery (optional — invites fall back to logging the link)
// ---------------------------------------------------------------------------

export function resendApiKey(): string | undefined {
  return firstOf(['RESEND_API_KEY']);
}

export function emailFrom(): string | undefined {
  return firstOf(['EMAIL_FROM']);
}

export function mailtrapApiToken(): string | undefined {
  return firstOf(['MAILTRAP_API_TOKEN']);
}

export function mailtrapFromEmail(): string | undefined {
  return firstOf(['MAILTRAP_FROM_EMAIL']);
}

/** Raw `INVITE_DELIVERY_MODE`; parsed by `@/lib/email/invite-delivery-mode`. */
export function inviteDeliveryMode(): string | undefined {
  return firstOf(['INVITE_DELIVERY_MODE']);
}

// ---------------------------------------------------------------------------
// Payments (ADR-009). ALL OPTIONAL — absent config yields the
// NoopPaymentProvider, which throws on every method (F8).
//
// `environment` is CONFIGURED, never inferred. Every payments table
// stores it and the RPC rejects on a mismatch, so the deployment must
// be able to state which mode it is in without consulting a payload.
// An unrecognised or absent value while a provider IS set resolves to
// the Noop — defaulting to `test` would make live webhooks unverifiable,
// and defaulting to `live` would let a sandbox grant real entitlement.
// Both are fail-open; there is no safe guess.
//
// Two credential sets are nameable at once so the test-mode go-live
// rehearsal needs no code edit. Only the set matching
// `PAYMENTS_ENVIRONMENT` is ever loaded, which is what makes "the
// environment stamped on an event is the credential set that verified
// its signature" true by construction rather than by convention.
// ---------------------------------------------------------------------------

/** Provider id, e.g. `razorpay`. Absent ⇒ payments disabled entirely. */
export function paymentsProvider(): string | undefined {
  return firstOf(['PAYMENTS_PROVIDER']);
}

/** Raw `PAYMENTS_ENVIRONMENT`; validated by the provider factory. */
export function paymentsEnvironment(): string | undefined {
  return firstOf(['PAYMENTS_ENVIRONMENT']);
}

/**
 * Razorpay credentials for one environment, resolved as a UNIT.
 *
 * Returning a bundle rather than four getters is the same reasoning as
 * `redisCredentials()`, and it matters more here: a deployment holding
 * an API key but no webhook secret could create real subscriptions and
 * charge real customers while being structurally unable to verify the
 * webhook that grants them access (attack A2). Requiring all three
 * together makes that half-live state unrepresentable.
 *
 * `merchantAccountRef` and `webhookSecretPrevious` are deliberately
 * NOT required: the first is defense in depth over an already-verified
 * signature, and the second exists only during a rotation window.
 */
export function razorpayCredentials(environment: 'test' | 'live'):
  | {
      keyId: string;
      keySecret: string;
      webhookSecret: string;
      webhookSecretPrevious?: string;
      merchantAccountRef?: string;
    }
  | undefined {
  const prefix = environment === 'live' ? 'RAZORPAY_LIVE' : 'RAZORPAY_TEST';

  const keyId = firstOf([`${prefix}_KEY_ID`]);
  const keySecret = firstOf([`${prefix}_KEY_SECRET`]);
  const webhookSecret = firstOf([`${prefix}_WEBHOOK_SECRET`]);
  if (!keyId || !keySecret || !webhookSecret) return undefined;

  return {
    keyId,
    keySecret,
    webhookSecret,
    // Accepted during a secret rotation only. Razorpay retries failed
    // deliveries for up to 24 hours and those in flight when the secret
    // changed still validate against the OLD secret, so a single-secret
    // rotation silently 401s a day of real events.
    webhookSecretPrevious: firstOf([`${prefix}_WEBHOOK_SECRET_PREVIOUS`]),
    merchantAccountRef: firstOf([`${prefix}_ACCOUNT_ID`]),
  };
}

// ---------------------------------------------------------------------------
// Release identity + observability (all optional; adapters no-op when unset)
// ---------------------------------------------------------------------------

export function releaseVersion(): string | undefined {
  return firstOf(['RELEASE_VERSION']);
}

export function gitSha(): string | undefined {
  return firstOf(['GIT_SHA']);
}

/**
 * `RELEASE_VERSION` is injected only by the promotion workflow, so its
 * presence is the deployment's own signal that it is a released build.
 */
export function isProductionRelease(): boolean {
  return releaseVersion() !== undefined;
}

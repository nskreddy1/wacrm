import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The single service-role Supabase client for the whole process.
 *
 * There used to be four byte-identical copies of this file — one each in
 * `features/flows`, `features/assistant/lib/ai`, `features/admin/lib/platform`,
 * and `features/channels` — and they had already drifted:
 *
 *   - each held its own module-level singleton, so a request that touched
 *     the flows engine and the AI auto-reply path opened two separate
 *     clients with two separate connection pools;
 *   - only the `channels` copy passed `auth: { persistSession: false,
 *     autoRefreshToken: false }`, so the other three kept an in-memory
 *     session store and a refresh timer that a service-role key never
 *     needs;
 *   - the env-var fallback chain was duplicated four times, so adding a
 *     deployment's key alias meant remembering all four.
 *
 * Being service-role, this client bypasses RLS. Every caller must either
 * sit behind an authorization check (`requireSuperAdmin()`, an account
 * membership check, a verified webhook signature) or be a server-internal
 * compensation step, and must scope its own queries by `account_id`.
 */
let adminClient: SupabaseClient | null = null;

/**
 * Resolve one of the accepted aliases for a Supabase setting.
 *
 * The aliases exist because deployments have named these differently over
 * time (`zepo_`-prefixed keys come from the hosted preview environment).
 * Resolution order is the same as it always was; the difference is that a
 * miss now throws here, naming every variable that would have satisfied
 * the lookup. The old code asserted with `!` and handed `undefined` to
 * `createClient`, which failed much later with a generic
 * `fetch failed`/`Invalid API key` from deep inside supabase-js and gave
 * no hint that the real problem was an unset environment variable.
 */
function requireEnv(names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(
    `Supabase service-role client is not configured. Set one of: ${names.join(', ')}.`
  );
}

const URL_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const;

const SERVICE_KEY_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'zepo_SUPABASE_SERVICE_ROLE_KEY',
  'zepo_SUPABASE_SECRET_KEY',
  'SUPABASE_SECRET_KEY',
] as const;

/** True when a service-role key is present, without constructing a client. */
export function hasServiceRoleConfig(): boolean {
  return (
    URL_VARS.some((name) => process.env[name]) &&
    SERVICE_KEY_VARS.some((name) => process.env[name])
  );
}

/**
 * Lazily-created, shared service-role client.
 *
 * Lazy on purpose: importing this module must not throw at build time in
 * a deployment that has not set the key yet, only when a request actually
 * reaches for elevated access.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(requireEnv(URL_VARS), requireEnv(SERVICE_KEY_VARS), {
      // A service-role key is a static credential: there is no session to
      // persist and nothing to refresh.
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

/**
 * Platform-operator alias for {@link supabaseAdmin}.
 *
 * Same client; the distinct name marks call sites that act as the platform
 * operator (super-admin console, support triage) rather than on behalf of
 * an account, so a reviewer can grep for them. Every one of these MUST sit
 * behind `requireSuperAdmin()`.
 */
export const platformAdmin = supabaseAdmin;

/**
 * Channel-infrastructure alias for {@link supabaseAdmin}.
 *
 * Marks call sites reached from an inbound provider webhook, where there is
 * no `auth.uid()` because the caller is Meta or Twilio rather than a user.
 * The signature check on the webhook route is the authorization boundary.
 */
export const channelAdmin = supabaseAdmin;

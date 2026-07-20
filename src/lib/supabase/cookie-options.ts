import type { CookieOptionsWithName } from "@supabase/ssr"

/**
 * Shared auth-cookie attributes for every Supabase client (browser,
 * server, proxy). The app must stay signed in when it runs inside an
 * embedded preview iframe (e.g. the v0 preview): there the app's own
 * cookies are "third-party" relative to the top-level page, and
 * browsers silently drop them unless they are `SameSite=None; Secure`.
 * `Partitioned` (CHIPS) additionally lets Chrome store them even with
 * third-party cookie blocking enabled, keyed to the embedding site.
 *
 * In a normal first-party tab these attributes are harmless — the
 * cookies behave exactly like before (HTTPS is already required, and
 * localhost is treated as a secure context in dev).
 */
export const authCookieOptions: CookieOptionsWithName = {
  sameSite: "none",
  secure: true,
  partitioned: true,
}

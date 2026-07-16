import "server-only"

/**
 * Production data source: Supabase only.
 *
 * The previous "mock" data source (in-memory demo data returned whenever
 * Supabase env vars were missing) has been removed. Missing configuration
 * now fails fast with a clear server error instead of silently serving
 * demo data.
 */
export type DataSource = "supabase"

export function hasSupabaseDataConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

/**
 * Returns the active data source, failing fast when Supabase is not
 * configured. Callers should invoke this inside their try/catch so the
 * configuration error surfaces as a clean 500 rather than an unhandled
 * exception.
 */
export function getDataSource(): DataSource {
  if (!hasSupabaseDataConfig()) {
    throw new Error(
      "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are required). Demo mode has been removed.",
    )
  }
  return "supabase"
}

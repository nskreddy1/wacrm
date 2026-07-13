import "server-only"

export type DataSource = "mock" | "supabase"

export const DEMO_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001"
export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001"

export function hasSupabaseDataConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

export function getDataSource(): DataSource {
  return hasSupabaseDataConfig() ? "supabase" : "mock"
}

export type RequestDataContext = {
  accountId: string
  userId: string
  source: DataSource
}

export function getMockDataContext(accountId?: string | null): RequestDataContext {
  return {
    accountId: accountId || DEMO_ACCOUNT_ID,
    userId: DEMO_USER_ID,
    source: "mock",
  }
}

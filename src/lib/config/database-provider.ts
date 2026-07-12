import { z } from "zod"

const providerSchema = z.enum(["supabase", "neon"])

export type DatabaseProvider = z.infer<typeof providerSchema>

export function getDatabaseProvider(): DatabaseProvider {
  const result = providerSchema.safeParse(process.env.DATABASE_PROVIDER ?? "supabase")
  if (!result.success) {
    throw new Error("DATABASE_PROVIDER must be either 'supabase' or 'neon'")
  }
  return result.data
}

export function assertDatabaseProviderConfig(provider = getDatabaseProvider()) {
  if (provider === "neon") {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when DATABASE_PROVIDER=neon")
    if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters when DATABASE_PROVIDER=neon")
    }
    return
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Supabase URL and anonymous key are required when DATABASE_PROVIDER=supabase")
  }
}

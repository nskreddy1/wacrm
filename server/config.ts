/**
 * @deprecated LEGACY — Express service (local/dev compatibility only).
 *
 * All production API traffic is served by same-origin Next.js Route
 * Handlers under `src/app/api/*`, deployed on Vercel. This Express
 * process is NOT part of the production path: nothing in `src/`
 * references it, and the Vercel deployment neither builds nor runs it.
 * The account endpoint now lives at `src/app/api/account/route.ts`.
 *
 * Run locally (only if needed): `pnpm legacy:api`
 */
import { z } from "zod"

const serverConfigSchema = z.object({
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
})

export type ServerConfig = z.infer<typeof serverConfigSchema>

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const result = serverConfigSchema.safeParse({
    ...environment,
    NEXT_PUBLIC_SUPABASE_URL:
      environment.NEXT_PUBLIC_SUPABASE_URL ??
      environment.NEXT_PUBLIC_zepo_SUPABASE_URL ??
      environment.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      environment.NEXT_PUBLIC_zepo_SUPABASE_ANON_KEY ??
      environment.zepo_SUPABASE_PUBLISHABLE_KEY ??
      environment.SUPABASE_PUBLISHABLE_KEY,
  })

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ")
    throw new Error(`Invalid API configuration: ${details}`)
  }

  return result.data
}

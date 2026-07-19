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
import type { SupabaseClient, User } from "@supabase/supabase-js"
import type { Request } from "express"

export type AccountRole = "agent" | "manager" | "admin" | "owner"

export interface RequestContext {
  requestId: string
  user: User
  userId: string
  accountId: string
  role: AccountRole
  supabase: SupabaseClient
}

export interface AuthenticatedRequest extends Request {
  context: RequestContext
}

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
import { Router, type RequestHandler } from "express"
import { z } from "zod"

import type { AuthenticatedRequest } from "../../http/context"
import { HttpError } from "../../http/errors"
import { requireRole } from "../../http/auth"

const updateAccountSchema = z.object({ name: z.string().trim().min(1).max(80) })

const getAccount: RequestHandler = async (request, response, next) => {
  try {
    const { accountId, role, supabase } = (request as AuthenticatedRequest).context
    const { data, error } = await supabase.from("accounts").select("id, name").eq("id", accountId).single()
    if (error) throw new HttpError(500, "account_read_failed", "Failed to load the account")
    response.json({ data: { account: data, role } })
  } catch (error) {
    next(error)
  }
}

const updateAccount: RequestHandler = async (request, response, next) => {
  try {
    const parsed = updateAccountSchema.safeParse(request.body)
    if (!parsed.success) throw new HttpError(400, "invalid_request", "Enter a valid account name", parsed.error.flatten())

    const { accountId, supabase } = (request as AuthenticatedRequest).context
    const { data, error } = await supabase
      .from("accounts")
      .update({ name: parsed.data.name })
      .eq("id", accountId)
      .select("id, name")
      .single()
    if (error) throw new HttpError(500, "account_update_failed", "Failed to update the account")
    response.json({ data: { account: data } })
  } catch (error) {
    next(error)
  }
}

export function accountRouter() {
  const router = Router()
  router.get("/", getAccount)
  router.patch("/", requireRole("admin"), updateAccount)
  return router
}

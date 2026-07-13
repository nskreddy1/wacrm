import { createClient } from "@supabase/supabase-js"
import type { NextFunction, Request, Response } from "express"

import type { ServerConfig } from "../config"
import type { AccountRole, AuthenticatedRequest } from "./context"
import { HttpError } from "./errors"

const accountRoles = new Set<AccountRole>(["agent", "manager", "admin", "owner"])
const roleRank: Record<AccountRole, number> = { agent: 0, manager: 1, admin: 2, owner: 3 }

function bearerToken(request: Request) {
  const authorization = request.get("authorization")
  if (!authorization?.startsWith("Bearer ")) return null
  return authorization.slice(7).trim() || null
}

export function authenticate(config: ServerConfig) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const token = bearerToken(request)
      if (!token) throw new HttpError(401, "unauthorized", "Authentication is required")

      const supabase = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: { user }, error: userError } = await supabase.auth.getUser(token)
      if (userError || !user) throw new HttpError(401, "unauthorized", "The session is invalid or expired")

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("account_id, account_role")
        .eq("user_id", user.id)
        .maybeSingle()

      if (profileError || !profile?.account_id || !accountRoles.has(profile.account_role as AccountRole)) {
        throw new HttpError(403, "account_context_missing", "The user is not linked to an account")
      }

      ;(request as AuthenticatedRequest).context = {
        requestId: String(request.id),
        user,
        userId: user.id,
        accountId: profile.account_id,
        role: profile.account_role as AccountRole,
        supabase,
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function requireRole(minimum: AccountRole) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const context = (request as AuthenticatedRequest).context
    if (!context || roleRank[context.role] < roleRank[minimum]) {
      next(new HttpError(403, "forbidden", `This action requires the '${minimum}' role or higher`))
      return
    }
    next()
  }
}

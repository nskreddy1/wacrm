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

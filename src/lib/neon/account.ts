import "server-only"

import { eq } from "drizzle-orm"
import { headers } from "next/headers"
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account"
import { isAccountRole, type AccountRole } from "@/lib/auth/roles"
import { db } from "@/lib/db"
import { crmAccounts, profiles } from "@/lib/db/schema"
import { neonAuth } from "./auth"

export interface NeonAccountContext {
  userId: string
  accountId: string
  role: AccountRole
  account: { id: string; name: string }
}

export async function getCurrentNeonAccount(): Promise<NeonAccountContext> {
  const session = await neonAuth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()

  const [profile] = await db
    .select({ accountId: profiles.accountId, role: profiles.accountRole })
    .from(profiles)
    .where(eq(profiles.userId, session.user.id))
    .limit(1)

  if (!profile || !isAccountRole(profile.role)) {
    throw new ForbiddenError("Profile is not linked to an account")
  }

  const [account] = await db
    .select({ id: crmAccounts.id, name: crmAccounts.name })
    .from(crmAccounts)
    .where(eq(crmAccounts.id, profile.accountId))
    .limit(1)

  if (!account) throw new ForbiddenError("Profile is not linked to an account")

  return { userId: session.user.id, accountId: account.id, role: profile.role, account }
}

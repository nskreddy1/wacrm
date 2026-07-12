import "server-only"

import { getDatabaseProvider } from "@/lib/config/database-provider"
import type { AccountRole } from "./roles"
import { getCurrentAccount } from "./account"

export interface ProviderAccountContext {
  userId: string
  accountId: string
  role: AccountRole
  account: { id: string; name: string }
}

export async function getCurrentProviderAccount(): Promise<ProviderAccountContext> {
  if (getDatabaseProvider() === "neon") {
    const { getCurrentNeonAccount } = await import("@/lib/neon/account")
    return getCurrentNeonAccount()
  }

  const { userId, accountId, role, account } = await getCurrentAccount()
  return { userId, accountId, role, account }
}

import "server-only"

import type { AccountRole } from "./roles"
import { getCurrentAccount } from "./account"

export interface ProviderAccountContext {
  userId: string
  accountId: string
  role: AccountRole
  account: { id: string; name: string }
}

export async function getCurrentProviderAccount(): Promise<ProviderAccountContext> {
  const { userId, accountId, role, account } = await getCurrentAccount()
  return { userId, accountId, role, account }
}

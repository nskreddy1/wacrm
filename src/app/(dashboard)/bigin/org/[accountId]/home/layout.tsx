import { notFound } from "next/navigation"
import { getCurrentAccount } from "@/lib/auth/account"
import { isUuid } from "@/lib/routes/dashboard-routes"

export default async function EnterpriseHomeLayout({ children, params }: { children: React.ReactNode; params: Promise<{ accountId: string }> }) {
  const [{ accountId }, context] = await Promise.all([params, getCurrentAccount()])
  if (!isUuid(accountId) || accountId !== context.accountId) notFound()
  return children
}

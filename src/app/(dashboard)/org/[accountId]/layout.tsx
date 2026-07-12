import { notFound } from "next/navigation"
import { getCurrentAccount } from "@/lib/auth/account"

export default async function OrganizationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ accountId: string }> }) {
  const [{ accountId }, context] = await Promise.all([params, getCurrentAccount()])
  if (accountId !== context.accountId) notFound()
  return children
}

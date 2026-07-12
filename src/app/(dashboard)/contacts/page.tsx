import { redirect } from "next/navigation"
import { getCurrentAccount } from "@/lib/auth/account"
import { enterpriseContactsPath } from "@/lib/routes/dashboard-routes"

export default async function ContactsPage() {
  const context = await getCurrentAccount()
  redirect(enterpriseContactsPath(context.accountId))
}

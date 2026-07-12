import { redirect } from "next/navigation"
import { getCurrentProviderAccount } from "@/lib/auth/provider-account"
import { enterpriseContactsPath } from "@/lib/routes/dashboard-routes"

export default async function ContactsPage() {
  const context = await getCurrentProviderAccount()
  redirect(enterpriseContactsPath(context.accountId))
}

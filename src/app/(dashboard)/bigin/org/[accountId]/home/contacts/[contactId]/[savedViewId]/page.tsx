import { notFound } from "next/navigation"
import { ContactWorkspace } from "@/components/contacts/contact-workspace"
import { getCurrentProviderAccount } from "@/lib/auth/provider-account"
import { isOpaqueId, isUuid, type ContactViewMode } from "@/lib/routes/dashboard-routes"

const modes = new Set<ContactViewMode>(["list", "sheet", "cards"])

export default async function EnterpriseContactsPage({ params }: { params: Promise<{ accountId: string; contactId: string; savedViewId: string }> }) {
  const [{ accountId, contactId: mode, savedViewId }, context] = await Promise.all([params, getCurrentProviderAccount()])
  if (accountId !== context.accountId || !isUuid(accountId) || !modes.has(mode as ContactViewMode) || !isOpaqueId(savedViewId)) notFound()
  return <ContactWorkspace accountId={accountId} initialView={mode as ContactViewMode} savedViewId={savedViewId} />
}

import { notFound } from "next/navigation"
import { ContactWorkspace } from "@/components/contacts/contact-workspace"
import { getCurrentProviderAccount } from "@/lib/auth/provider-account"
import { isOpaqueId, isUuid, type ContactViewMode } from "@/lib/routes/dashboard-routes"

const modes = new Set<ContactViewMode>(["list", "sheet", "cards"])

export default async function EnterpriseContactPage({ params, searchParams }: { params: Promise<{ accountId: string; contactId: string }>; searchParams: Promise<{ view?: string; mode?: string }> }) {
  const [{ accountId, contactId }, query, context] = await Promise.all([params, searchParams, getCurrentProviderAccount()])
  const mode = modes.has(query.mode as ContactViewMode) ? query.mode as ContactViewMode : "list"
  const savedViewId = query.view ?? "all"
  if (accountId !== context.accountId || !isUuid(accountId) || !isOpaqueId(contactId) || !isOpaqueId(savedViewId)) notFound()
  return <ContactWorkspace accountId={accountId} initialView={mode} savedViewId={savedViewId} initialContactId={contactId} />
}

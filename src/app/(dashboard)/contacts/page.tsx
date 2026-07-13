import { ContactWorkspace } from "@/components/contacts/contact-workspace"
import { isOpaqueId, type ContactViewMode } from "@/lib/routes/dashboard-routes"

const modes = new Set<ContactViewMode>(["list", "sheet", "cards"])

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; view?: string; contact?: string }>
}) {
  const query = await searchParams
  const mode = modes.has(query.mode as ContactViewMode) ? (query.mode as ContactViewMode) : "list"
  const view = query.view && isOpaqueId(query.view) ? query.view : "all"
  const contact = query.contact && isOpaqueId(query.contact) ? query.contact : undefined

  return <ContactWorkspace accountId="demo-workspace" initialView={mode} savedViewId={view} initialContactId={contact} />
}

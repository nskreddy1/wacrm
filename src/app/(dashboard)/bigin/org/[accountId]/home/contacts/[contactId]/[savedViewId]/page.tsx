import { redirect } from "next/navigation"
import { contactsPath, isOpaqueId, type ContactViewMode } from "@/lib/routes/dashboard-routes"

const modes = new Set<ContactViewMode>(["list", "sheet", "cards"])

export default async function LegacyContactsView({
  params,
}: {
  params: Promise<{ contactId: string; savedViewId: string }>
}) {
  const { contactId: mode, savedViewId } = await params
  redirect(contactsPath(undefined, {
    mode: modes.has(mode as ContactViewMode) ? (mode as ContactViewMode) : "list",
    view: isOpaqueId(savedViewId) ? savedViewId : "all",
  }))
}

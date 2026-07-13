import { redirect } from "next/navigation"
import { contactsPath, isOpaqueId, type ContactViewMode } from "@/lib/routes/dashboard-routes"

const modes = new Set<ContactViewMode>(["list", "sheet", "cards"])

export default async function LegacyContactDetail({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>
  searchParams: Promise<{ view?: string; mode?: string }>
}) {
  const [{ contactId }, query] = await Promise.all([params, searchParams])
  redirect(contactsPath(undefined, {
    contact: isOpaqueId(contactId) ? contactId : undefined,
    view: query.view && isOpaqueId(query.view) ? query.view : "all",
    mode: modes.has(query.mode as ContactViewMode) ? (query.mode as ContactViewMode) : "list",
  }))
}

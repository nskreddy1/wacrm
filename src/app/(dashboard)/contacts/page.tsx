import type { Metadata } from "next"
import { ContactWorkspace } from "@/components/contacts/contact-workspace"

export const metadata: Metadata = {
  title: "Contacts",
  description: "Manage contacts in list, spreadsheet, and card views.",
}

export default function ContactsPage() {
  return <ContactWorkspace />
}

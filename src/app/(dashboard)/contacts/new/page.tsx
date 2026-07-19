import type { Metadata } from "next"

import { ContactRecordForm } from "@/components/contacts/contact-record-form"

export const metadata: Metadata = {
  title: "Create contact",
  description: "Create a contact record for your CRM workspace.",
}

export default function NewContactPage() {
  return <ContactRecordForm mode="create" />
}

import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ContactRecordForm } from "@/components/contacts/contact-record-form"
import { getCurrentAccount } from "@/lib/auth/account"
import { getSupabaseContactWorkspace } from "@/lib/data/contacts/supabase-repository"

export const metadata: Metadata = {
  title: "Edit contact",
  description: "Update a contact record in your CRM workspace.",
}

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const workspace = await getSupabaseContactWorkspace(await getCurrentAccount())
  const contact = workspace.contacts.find((item) => item.id === id)
  if (!contact) notFound()

  return <ContactRecordForm mode="edit" contact={contact} />
}

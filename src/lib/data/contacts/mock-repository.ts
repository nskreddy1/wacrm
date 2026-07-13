import "server-only"

import {
  addMockContactField,
  getMockDatabase,
  normalizeMockPhone,
} from "@/lib/data/mock-db"
import type {
  ContactPreferences,
  ContactValue,
  ContactWorkspaceData,
  FieldType,
  WorkspaceContact,
} from "@/lib/data/contacts/types"

function accountContacts(accountId: string) {
  return getMockDatabase().contacts.filter((contact) => contact.accountId === accountId)
}

function accountPreferences(accountId: string): ContactPreferences {
  const database = getMockDatabase()
  database.contactPreferences[accountId] ??= {
    visible: database.contactFields.map((field) => field.id),
    order: database.contactFields.map((field) => field.id),
    frozen: ["name"],
    widths: {},
  }
  return database.contactPreferences[accountId]
}

export function getMockContactWorkspace(accountId: string): ContactWorkspaceData {
  const database = getMockDatabase()
  return {
    contacts: accountContacts(accountId).map((contact) => ({ ...contact, values: { ...contact.values } })),
    fields: database.contactFields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined })),
    preferences: { ...accountPreferences(accountId) },
  }
}

export function createMockContact(accountId: string, values: Record<string, ContactValue>) {
  const phone = normalizeMockPhone(values.phone)
  if (!values.name || !phone) throw new Error("Name and phone are required")
  if (accountContacts(accountId).some((contact) => normalizeMockPhone(contact.values.phone) === phone)) {
    throw new Error("A contact with this phone already exists")
  }

  const now = new Date().toISOString()
  const contact: WorkspaceContact = {
    id: crypto.randomUUID(),
    accountId,
    createdAt: now,
    updatedAt: now,
    values: { ...values },
  }
  getMockDatabase().contacts.unshift(contact)
  return { ...contact, values: { ...contact.values } }
}

export function updateMockContact(
  accountId: string,
  id: string,
  values: Partial<Record<string, ContactValue>>,
) {
  const database = getMockDatabase()
  const contact = database.contacts.find((candidate) => candidate.id === id && candidate.accountId === accountId)
  if (!contact) throw new Error("Contact not found")

  const defined = Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, ContactValue] => entry[1] !== undefined),
  )
  if (defined.phone) {
    const phone = normalizeMockPhone(defined.phone)
    const duplicate = accountContacts(accountId).some(
      (candidate) => candidate.id !== id && normalizeMockPhone(candidate.values.phone) === phone,
    )
    if (duplicate) throw new Error("A contact with this phone already exists")
  }

  contact.values = { ...contact.values, ...defined }
  contact.updatedAt = new Date().toISOString()
  return { ...contact, values: { ...contact.values } }
}

export function deleteMockContacts(accountId: string, ids: string[]) {
  const database = getMockDatabase()
  const selected = new Set(ids)
  database.contacts = database.contacts.filter(
    (contact) => contact.accountId !== accountId || !selected.has(contact.id),
  )
  for (const deal of database.deals) {
    if (deal.accountId === accountId && deal.contactId && selected.has(deal.contactId)) deal.contactId = null
  }
}

export function createMockContactField(input: {
  label: string
  type: FieldType
  options?: string[]
  width?: number
}) {
  return addMockContactField(input)
}

export function updateMockContactPreferences(accountId: string, next: Partial<ContactPreferences>) {
  const preferences = accountPreferences(accountId)
  Object.assign(preferences, next)
  return { ...preferences }
}

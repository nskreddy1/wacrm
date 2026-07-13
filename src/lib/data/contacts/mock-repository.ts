import "server-only"

import { DEMO_ACCOUNT_ID } from "@/lib/data/runtime"
import type {
  ContactField,
  ContactPreferences,
  ContactValue,
  ContactWorkspaceData,
  FieldType,
  WorkspaceContact,
} from "@/lib/data/contacts/types"

const fields: ContactField[] = [
  { id: "name", label: "Contact name", type: "text", required: true, width: 220 },
  { id: "email", label: "Email", type: "email", width: 230 },
  { id: "phone", label: "Phone", type: "phone", required: true, width: 160 },
  { id: "company", label: "Company", type: "text", width: 180 },
  { id: "street", label: "Mailing street", type: "text", width: 220 },
  { id: "city", label: "Mailing city", type: "text", width: 160 },
  { id: "state", label: "Mailing state", type: "single_select", options: ["California", "New York", "Texas", "Florida", "Illinois"], width: 170 },
  { id: "lifecycle", label: "Lifecycle", type: "single_select", options: ["Lead", "Qualified", "Customer", "Inactive"], width: 150 },
  { id: "value", label: "Customer value", type: "currency", width: 150 },
]

const names = ["Ted Watson", "Ava Rodriguez", "Noah Williams", "Mia Chen", "Liam Anderson", "Sophia Patel", "Ethan Martinez", "Olivia Johnson", "Lucas Brown", "Emma Davis", "James Wilson", "Isabella Thomas", "Benjamin Lee", "Amelia Moore", "Henry Taylor", "Harper White", "Alexander Harris", "Evelyn Clark", "Daniel Lewis", "Charlotte Hall", "Michael Young", "Luna King", "Sebastian Wright", "Camila Scott", "Jack Green", "Sofia Baker", "Owen Adams", "Aria Nelson", "Samuel Carter", "Ella Mitchell"]

let contacts: WorkspaceContact[] = names.map((name, index) => ({
  id: `00000000-0000-4001-8000-${String(index + 1).padStart(12, "0")}`,
  accountId: DEMO_ACCOUNT_ID,
  createdAt: new Date(2026, 5, index + 1).toISOString(),
  updatedAt: new Date(2026, 6, 12).toISOString(),
  values: {
    name,
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
    phone: `+1415555${String(1100 + index)}`,
    company: ["Northstar Labs", "Acme Retail", "Evergreen Health", "Orbit Works"][index % 4],
    street: `${8 + index} Market Street`,
    city: ["San Francisco", "Austin", "New York", "Miami"][index % 4],
    state: ["California", "Texas", "New York", "Florida"][index % 4],
    lifecycle: ["Lead", "Qualified", "Customer", "Lead"][index % 4],
    value: 1800 + index * 425,
  },
}))

let preferences: ContactPreferences = {
  visible: fields.map((field) => field.id),
  order: fields.map((field) => field.id),
  frozen: ["name"],
  widths: {},
}

function accountContacts(accountId: string) {
  return contacts.filter((contact) => contact.accountId === accountId)
}

export function getMockContactWorkspace(accountId: string): ContactWorkspaceData {
  return { contacts: accountContacts(accountId), fields, preferences }
}

export function createMockContact(accountId: string, values: Record<string, ContactValue>) {
  const phone = String(values.phone ?? "").replace(/\D/g, "")
  if (!values.name || !phone) throw new Error("Name and phone are required")
  if (accountContacts(accountId).some((contact) => String(contact.values.phone).replace(/\D/g, "") === phone)) {
    throw new Error("A contact with this phone already exists")
  }
  const now = new Date().toISOString()
  const contact: WorkspaceContact = {
    id: crypto.randomUUID(),
    accountId,
    createdAt: now,
    updatedAt: now,
    values,
  }
  contacts = [contact, ...contacts]
  return contact
}

export function updateMockContact(accountId: string, id: string, values: Partial<Record<string, ContactValue>>) {
  const index = contacts.findIndex((contact) => contact.id === id && contact.accountId === accountId)
  if (index < 0) throw new Error("Contact not found")
  const defined = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, ContactValue] => entry[1] !== undefined))
  contacts[index] = {
    ...contacts[index],
    updatedAt: new Date().toISOString(),
    values: { ...contacts[index].values, ...defined },
  }
  return contacts[index]
}

export function deleteMockContacts(accountId: string, ids: string[]) {
  const selected = new Set(ids)
  contacts = contacts.filter((contact) => contact.accountId !== accountId || !selected.has(contact.id))
}

export function createMockContactField(input: { label: string; type: FieldType; options?: string[]; width?: number }) {
  if (fields.length >= 100) throw new Error("The 100 field limit has been reached")
  const field: ContactField = { ...input, id: `custom_${crypto.randomUUID()}`, width: input.width ?? 180 }
  fields.push(field)
  preferences = {
    ...preferences,
    visible: [...preferences.visible, field.id],
    order: [...preferences.order, field.id],
  }
  return field
}

export function updateMockContactPreferences(next: Partial<ContactPreferences>) {
  preferences = { ...preferences, ...next }
  return preferences
}

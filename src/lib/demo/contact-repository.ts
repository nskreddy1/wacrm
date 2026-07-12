export type FieldType = "text" | "number" | "date" | "email" | "phone" | "url" | "single_select" | "multi_select" | "checkbox" | "currency"

export type ContactField = {
  id: string
  label: string
  type: FieldType
  required?: boolean
  readOnly?: boolean
  options?: string[]
  width: number
}

export type DemoContact = {
  id: string
  createdAt: string
  updatedAt: string
  values: Record<string, string | number | boolean | string[]>
}

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

let contacts: DemoContact[] = names.map((name, index) => ({
  id: `contact-${index + 1}`,
  createdAt: new Date(2026, 5, index + 1).toISOString(),
  updatedAt: new Date(2026, 6, 12).toISOString(),
  values: {
    name,
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
    phone: `+1 415 555 ${String(1100 + index)}`,
    company: ["Northstar Labs", "Acme Retail", "Evergreen Health", "Orbit Works"][index % 4],
    street: `${8 + index} Market Street`,
    city: ["San Francisco", "Austin", "New York", "Miami"][index % 4],
    state: ["California", "Texas", "New York", "Florida"][index % 4],
    lifecycle: ["Lead", "Qualified", "Customer", "Lead"][index % 4],
    value: 1800 + index * 425,
  },
}))

let preferences = { visible: fields.map((field) => field.id), order: fields.map((field) => field.id), frozen: ["name"], widths: {} as Record<string, number> }

export function getContactStore() {
  return { contacts, fields, preferences }
}

export function createContact(values: DemoContact["values"]) {
  const phone = String(values.phone ?? "").replace(/\D/g, "")
  if (!values.name || !phone) throw new Error("Name and phone are required")
  if (contacts.some((contact) => String(contact.values.phone).replace(/\D/g, "") === phone)) throw new Error("A contact with this phone already exists")
  const now = new Date().toISOString()
  const contact = { id: `contact-${Date.now()}`, createdAt: now, updatedAt: now, values }
  contacts = [contact, ...contacts]
  return contact
}

export function updateContact(id: string, values: Partial<DemoContact["values"]>) {
  const index = contacts.findIndex((contact) => contact.id === id)
  if (index < 0) throw new Error("Contact not found")
  const definedValues = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string | number | boolean | string[]] => entry[1] !== undefined))
  contacts[index] = { ...contacts[index], updatedAt: new Date().toISOString(), values: { ...contacts[index].values, ...definedValues } }
  return contacts[index]
}

export function deleteContacts(ids: string[]) {
  contacts = contacts.filter((contact) => !ids.includes(contact.id))
}

export function createField(input: Omit<ContactField, "id" | "width"> & { width?: number }) {
  if (fields.length >= 100) throw new Error("The 100 field limit has been reached")
  const id = `custom_${Date.now()}`
  const field = { ...input, id, width: input.width ?? 180 }
  fields.push(field)
  preferences.visible.push(id)
  preferences.order.push(id)
  return field
}

export function updatePreferences(next: Partial<typeof preferences>) {
  preferences = { ...preferences, ...next }
  return preferences
}

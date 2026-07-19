import type { ContactField, ContactValue, FieldType } from "./types"

export const FIELD_TYPES = ["text", "number", "date", "email", "phone", "url", "single_select", "multi_select", "checkbox", "currency"] as const satisfies readonly FieldType[]
const SELECT_TYPES = new Set<FieldType>(["single_select", "multi_select"])
const CORE_LABELS = new Set(["name", "phone", "email", "company"])

export function normalizeFieldLabel(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

export function normalizeFieldOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeFieldLabel).filter(Boolean)
}

export function validateFieldDefinition(
  input: { label?: unknown; type?: unknown; options?: unknown },
  existing: ContactField[],
  editingId?: string,
) {
  const label = normalizeFieldLabel(input.label)
  if (!label) throw new Error("Field label is required")
  if (label.length > 80) throw new Error("Field label must be 80 characters or fewer")
  const normalizedLabel = label.toLocaleLowerCase()
  if (CORE_LABELS.has(normalizedLabel)) throw new Error(`“${label}” is already a standard contact field`)
  if (existing.some((field) => field.id !== editingId && normalizeFieldLabel(field.label).toLocaleLowerCase() === normalizedLabel)) {
    throw new Error(`A field named “${label}” already exists`)
  }
  if (!FIELD_TYPES.includes(input.type as FieldType)) throw new Error("Choose a valid field type")
  const type = input.type as FieldType
  const options = normalizeFieldOptions(input.options)
  if (SELECT_TYPES.has(type)) {
    if (!options.length) throw new Error("Select fields require at least one option")
    const seen = new Set<string>()
    for (const option of options) {
      if (option.length > 80) throw new Error("Each option must be 80 characters or fewer")
      const key = option.toLocaleLowerCase()
      if (seen.has(key)) throw new Error(`Duplicate option: “${option}”`)
      seen.add(key)
    }
  }
  if (options.length > 100) throw new Error("Select fields support up to 100 options")
  return { label, type, options: SELECT_TYPES.has(type) ? options : [] }
}

export function validateContactIdentity(values: Partial<Record<string, ContactValue>>) {
  const name = String(values.name ?? "").trim().replace(/\s+/g, " ")
  const phone = String(values.phone ?? "").trim()
  const email = String(values.email ?? "").trim().toLocaleLowerCase()
  const company = String(values.company ?? "").trim().replace(/\s+/g, " ")
  if (!name) throw new Error("Contact name is required")
  if (name.length > 120) throw new Error("Contact name must be 120 characters or fewer")
  if (!phone && !email) throw new Error("Add a phone number or email address")
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address")
  if (email.length > 254) throw new Error("Email address is too long")
  if (phone.length > 32) throw new Error("Phone number is too long")
  if (company.length > 160) throw new Error("Company must be 160 characters or fewer")
  return { name, phone, email, company }
}

export function validateContactValue(field: ContactField, value: ContactValue | null | undefined): ContactValue {
  if (value === "" || value === null || value === undefined) return ""
  if (field.type === "number" || field.type === "currency") {
    const number = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(number)) throw new Error(`${field.label} must be a valid number`)
    return number
  }
  if (field.type === "checkbox") {
    if (typeof value === "boolean") return value
    if (value === "true" || value === "1") return true
    if (value === "false" || value === "0") return false
    throw new Error(`${field.label} must be true or false`)
  }
  if (field.type === "date" && Number.isNaN(Date.parse(String(value)))) throw new Error(`${field.label} must be a valid date`)
  if (field.type === "email" && !/^\S+@\S+\.\S+$/.test(String(value))) throw new Error(`${field.label} must be a valid email address`)
  if (field.type === "url") {
    try { new URL(String(value)) } catch { throw new Error(`${field.label} must be a valid URL`) }
  }
  if (field.type === "single_select" && !field.options?.includes(String(value))) throw new Error(`${field.label} must use one of its configured options`)
  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? value.map(String) : String(value).split(",").map((item) => item.trim()).filter(Boolean)
    if (selected.some((item) => !field.options?.includes(item))) throw new Error(`${field.label} contains an invalid option`)
    return [...new Set(selected)]
  }
  return String(value).trim()
}

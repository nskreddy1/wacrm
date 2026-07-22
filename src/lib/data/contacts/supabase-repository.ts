import "server-only"

import type { AccountContext } from "@/lib/auth/account"
import type { ContactField, ContactPreferences, ContactValue, ContactWorkspaceData, FieldType, WorkspaceContact } from "./types"
import { validateContactIdentity, validateContactValue, validateFieldDefinition } from "./validation"

const CONTACT_SELECT = "id, account_id, name, phone, email, company, created_at, updated_at"

export const coreContactFields: ContactField[] = [
  { id: "name", label: "Name", type: "text", required: true, width: 220 },
  { id: "phone", label: "Phone", type: "phone", width: 180 },
  { id: "email", label: "Email", type: "email", width: 220 },
  { id: "company", label: "Company", type: "text", width: 180 },
]

function mapField(row: Record<string, unknown>): ContactField {
  const rawOptions = row.field_options
  const options = Array.isArray(rawOptions)
    ? rawOptions.map(String)
    : rawOptions && typeof rawOptions === "object" && Array.isArray((rawOptions as { options?: unknown[] }).options)
      ? (rawOptions as { options: unknown[] }).options.map(String)
      : undefined
  return {
    id: String(row.id),
    label: String(row.field_name),
    type: String(row.field_type ?? "text") as FieldType,
    options,
    width: 180,
    custom: true,
  }
}

function mapContact(row: Record<string, unknown>, customValues: Record<string, ContactValue> = {}): WorkspaceContact {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    values: {
      name: String(row.name ?? ""),
      phone: String(row.phone ?? ""),
      email: String(row.email ?? ""),
      company: String(row.company ?? ""),
      ...customValues,
    },
  }
}

function contactColumns(values: Partial<Record<string, ContactValue>>) {
  const allowed = ["name", "phone", "email", "company"] as const
  return Object.fromEntries(allowed.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]))
}

// Extra form fields (no dedicated columns on `contacts`) persisted as
// auto-provisioned custom fields so the full Create Contact form round-trips.
const EXTENDED_CONTACT_FIELDS: Record<string, string> = {
  title: "Title",
  description: "Description",
  street: "Street",
  city: "City",
}

async function resolveExtendedValues(ctx: AccountContext, values: Partial<Record<string, ContactValue>>) {
  const entries = Object.entries(EXTENDED_CONTACT_FIELDS).filter(([key]) => values[key] !== undefined)
  if (!entries.length) return values
  const { data: rows, error } = await ctx.supabase.from("custom_fields").select("id, field_name").eq("account_id", ctx.accountId)
  if (error) throw new Error(error.message)
  const byLabel = new Map((rows ?? []).map((row) => [String(row.field_name).toLocaleLowerCase(), String(row.id)]))
  const next: Partial<Record<string, ContactValue>> = { ...values }
  for (const [key, label] of entries) {
    const value = next[key]
    delete next[key]
    let fieldId = byLabel.get(label.toLocaleLowerCase())
    if (!fieldId) {
      if (!String(value ?? "").trim()) continue
      const { data, error: insertError } = await ctx.supabase
        .from("custom_fields")
        .insert({ account_id: ctx.accountId, user_id: ctx.userId, field_name: label, field_type: "text", field_options: null })
        .select("id")
        .single()
      if (insertError) throw new Error(insertError.message)
      fieldId = String(data.id)
      byLabel.set(label.toLocaleLowerCase(), fieldId)
    }
    next[fieldId] = value
  }
  return next
}

async function saveCustomValues(ctx: AccountContext, contactId: string, values: Partial<Record<string, ContactValue>>) {
  const { data: fieldRows, error: fieldsError } = await ctx.supabase.from("custom_fields").select("id, field_name, field_type, field_options").eq("account_id", ctx.accountId)
  if (fieldsError) throw new Error(fieldsError.message)
  const fields = new Map((fieldRows ?? []).map((row) => {
    const field = mapField(row)
    return [field.id, field]
  }))
  const entries = Object.entries(values).filter(([id]) => fields.has(id))
  if (!entries.length) return
  const rows = entries.map(([custom_field_id, value]) => {
    const validated = validateContactValue(fields.get(custom_field_id)!, value)
    return { contact_id: contactId, custom_field_id, value: Array.isArray(validated) ? validated.join(", ") : String(validated ?? "") }
  })
  const { error } = await ctx.supabase.from("contact_custom_values").upsert(rows, { onConflict: "contact_id,custom_field_id" })
  if (error) throw new Error(error.message)
}

export async function getSupabaseContactWorkspace(ctx: AccountContext): Promise<ContactWorkspaceData> {
  const [contactsResult, fieldsResult, valuesResult] = await Promise.all([
    ctx.supabase.from("contacts").select(CONTACT_SELECT).eq("account_id", ctx.accountId).order("created_at", { ascending: false }),
    ctx.supabase.from("custom_fields").select("id, field_name, field_type, field_options").eq("account_id", ctx.accountId).order("created_at"),
    ctx.supabase.from("contact_custom_values").select("contact_id, custom_field_id, value"),
  ])
  if (contactsResult.error) throw new Error(contactsResult.error.message)
  if (fieldsResult.error) throw new Error(fieldsResult.error.message)
  if (valuesResult.error) throw new Error(valuesResult.error.message)

  const valuesByContact = new Map<string, Record<string, ContactValue>>()
  for (const row of valuesResult.data ?? []) {
    const current = valuesByContact.get(String(row.contact_id)) ?? {}
    current[String(row.custom_field_id)] = String(row.value ?? "")
    valuesByContact.set(String(row.contact_id), current)
  }
  const fields = [...coreContactFields, ...(fieldsResult.data ?? []).map((row) => mapField(row))]
  const preferences: ContactPreferences = {
    visible: fields.map((field) => field.id),
    order: fields.map((field) => field.id),
    frozen: ["name"],
    widths: {},
  }
  const aliasByFieldId = new Map<string, string>()
  for (const field of fields) {
    if (!field.custom) continue
    const alias = Object.entries(EXTENDED_CONTACT_FIELDS).find(([, label]) => label.toLocaleLowerCase() === field.label.toLocaleLowerCase())?.[0]
    if (alias) aliasByFieldId.set(field.id, alias)
  }
  return {
    contacts: (contactsResult.data ?? []).map((row) => {
      const customValues = valuesByContact.get(String(row.id)) ?? {}
      const aliases = Object.fromEntries(
        [...aliasByFieldId].filter(([fieldId]) => customValues[fieldId] !== undefined).map(([fieldId, alias]) => [alias, customValues[fieldId]]),
      )
      return mapContact(row, { ...customValues, ...aliases })
    }),
    fields,
    preferences,
  }
}

export async function createSupabaseContact(ctx: AccountContext, values: Record<string, ContactValue>) {
  const fields = validateContactIdentity(values)
  const { data, error } = await ctx.supabase.from("contacts").insert({ ...fields, account_id: ctx.accountId, user_id: ctx.userId }).select(CONTACT_SELECT).single()
  if (error) throw new Error(error.code === "23505" ? "A contact with these details already exists" : error.message)
  const resolved = await resolveExtendedValues(ctx, values)
  await saveCustomValues(ctx, String(data.id), resolved)
  return mapContact(data, Object.fromEntries(Object.entries(resolved).filter((entry): entry is [string, ContactValue] => entry[1] !== undefined)))
}

export async function updateSupabaseContact(ctx: AccountContext, id: string, values: Partial<Record<string, ContactValue>>) {
  const { data: current, error: currentError } = await ctx.supabase.from("contacts").select(CONTACT_SELECT).eq("account_id", ctx.accountId).eq("id", id).single()
  if (currentError) throw new Error(currentError.message)
  const currentContact = mapContact(current)
  const identityTouched = ["name", "phone", "email", "company"].some((key) => values[key] !== undefined)
  let row = current as Record<string, unknown>
  if (identityTouched) {
    const identity = validateContactIdentity({ ...currentContact.values, ...values })
    const { data, error } = await ctx.supabase.from("contacts").update(identity).eq("account_id", ctx.accountId).eq("id", id).select(CONTACT_SELECT).single()
    if (error) throw new Error(error.code === "23505" ? "A contact with these details already exists" : error.message)
    row = data
  }
  const resolved = await resolveExtendedValues(ctx, values)
  await saveCustomValues(ctx, id, resolved)
  const mergedValues = Object.fromEntries(Object.entries({ ...currentContact.values, ...resolved }).filter((entry): entry is [string, ContactValue] => entry[1] !== undefined))
  return mapContact(row, mergedValues)
}

export async function createSupabaseContactField(ctx: AccountContext, field: { label: string; type: FieldType; options?: string[] }) {
  const { data: rows, error: fieldsError } = await ctx.supabase.from("custom_fields").select("id, field_name, field_type, field_options").eq("account_id", ctx.accountId)
  if (fieldsError) throw new Error(fieldsError.message)
  const validated = validateFieldDefinition(field, [...coreContactFields, ...(rows ?? []).map(mapField)])
  const { data, error } = await ctx.supabase.from("custom_fields").insert({ account_id: ctx.accountId, user_id: ctx.userId, field_name: validated.label, field_type: validated.type, field_options: validated.options.length ? { options: validated.options } : null }).select("id, field_name, field_type, field_options").single()
  if (error) throw new Error(error.code === "23505" ? `A field named “${validated.label}” already exists` : error.message)
  return mapField(data)
}

export async function updateSupabaseContactField(ctx: AccountContext, id: string, field: { label?: string; type?: FieldType; options?: string[] }) {
  const { data: rows, error: fieldsError } = await ctx.supabase.from("custom_fields").select("id, field_name, field_type, field_options").eq("account_id", ctx.accountId)
  if (fieldsError) throw new Error(fieldsError.message)
  const existing = (rows ?? []).map(mapField)
  const current = existing.find((item) => item.id === id)
  if (!current) throw new Error("Custom field not found")
  const validated = validateFieldDefinition({ label: field.label ?? current.label, type: field.type ?? current.type, options: field.options ?? current.options }, [...coreContactFields, ...existing], id)
  const { data, error } = await ctx.supabase.from("custom_fields").update({ field_name: validated.label, field_type: validated.type, field_options: validated.options.length ? { options: validated.options } : null }).eq("account_id", ctx.accountId).eq("id", id).select("id, field_name, field_type, field_options").single()
  if (error) throw new Error(error.code === "23505" ? `A field named “${validated.label}” already exists` : error.message)
  return mapField(data)
}

export async function deleteSupabaseContactFields(ctx: AccountContext, ids: string[]) {
  const { error, count } = await ctx.supabase.from("custom_fields").delete({ count: "exact" }).eq("account_id", ctx.accountId).in("id", ids)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function deleteSupabaseContacts(ctx: AccountContext, ids: string[]) {
  if (!ids.length) return 0
  const { error, count } = await ctx.supabase.from("contacts").delete({ count: "exact" }).eq("account_id", ctx.accountId).in("id", ids)
  if (error) throw new Error(error.message)
  return count ?? ids.length
}

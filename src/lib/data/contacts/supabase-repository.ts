import "server-only"

import type { AccountContext } from "@/features/auth/lib/account"
import type { ContactField, ContactPreferences, ContactValue, ContactWorkspaceData, FieldType, WorkspaceContact } from "./types"
import { validateContactIdentity, validateContactValue, validateFieldDefinition } from "./validation"

const CONTACT_SELECT = "id, account_id, user_id, name, phone, email, company, created_at, updated_at"

export const coreContactFields: ContactField[] = [
  { id: "name", label: "Name", type: "text", required: true, width: 220 },
  { id: "phone", label: "Phone", type: "phone", width: 180 },
  { id: "email", label: "Email", type: "email", width: 220 },
  { id: "company", label: "Company", type: "text", width: 180 },
]

function mapField(row: Record<string, unknown>): ContactField {
  const rawOptions = row.field_options
  const meta = rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions) ? (rawOptions as { options?: unknown[]; required?: unknown; unique?: unknown }) : null
  const options = Array.isArray(rawOptions)
    ? rawOptions.map(String)
    : meta && Array.isArray(meta.options)
      ? meta.options.map(String)
      : undefined
  return {
    id: String(row.id),
    label: String(row.field_name),
    type: String(row.field_type ?? "text") as FieldType,
    options,
    required: meta?.required === true,
    unique: meta?.unique === true,
    width: 180,
    custom: true,
  }
}

function fieldOptionsPayload(definition: { options: string[]; required?: boolean; unique?: boolean }) {
  const payload: { options?: string[]; required?: boolean; unique?: boolean } = {}
  if (definition.options.length) payload.options = definition.options
  if (definition.required) payload.required = true
  if (definition.unique) payload.unique = true
  return Object.keys(payload).length ? payload : null
}

function mapContact(row: Record<string, unknown>, customValues: Record<string, ContactValue> = {}): WorkspaceContact {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    ownerId: String(row.user_id ?? ""),
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

// Extra form fields (no dedicated columns on `contacts`) persisted as
// auto-provisioned custom fields so the full Create Contact form round-trips.
const EXTENDED_CONTACT_FIELDS: Record<string, string> = {
  title: "Title",
  description: "Description",
  street: "Street",
  city: "City",
  otherPhones: "Other Phones",
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
    const field = fields.get(custom_field_id)!
    const validated = validateContactValue(field, value)
    const stored = Array.isArray(validated) ? validated.join(", ") : String(validated ?? "")
    if (field.required && !stored.trim()) throw new Error(`${field.label} is required`)
    return { contact_id: contactId, custom_field_id, value: stored }
  })
  // Enforce "do not allow duplicate values" per field across other contacts.
  const uniqueRows = rows.filter((row) => fields.get(row.custom_field_id)?.unique && row.value.trim())
  if (uniqueRows.length) {
    const { data: existing, error: uniqueError } = await ctx.supabase
      .from("contact_custom_values")
      .select("contact_id, custom_field_id, value")
      .in("custom_field_id", uniqueRows.map((row) => row.custom_field_id))
      .neq("contact_id", contactId)
    if (uniqueError) throw new Error(uniqueError.message)
    for (const row of uniqueRows) {
      const clash = (existing ?? []).find((item) => String(item.custom_field_id) === row.custom_field_id && String(item.value ?? "").trim().toLocaleLowerCase() === row.value.trim().toLocaleLowerCase())
      if (clash) throw new Error(`Another contact already uses this ${fields.get(row.custom_field_id)!.label} value`)
    }
  }
  const { error } = await ctx.supabase.from("contact_custom_values").upsert(rows, { onConflict: "contact_id,custom_field_id" })
  if (error) throw new Error(error.message)
}

export async function getSupabaseContactWorkspace(ctx: AccountContext): Promise<ContactWorkspaceData> {
  const [contactsResult, fieldsResult, valuesResult, profilesResult] = await Promise.all([
    ctx.supabase.from("contacts").select(CONTACT_SELECT).eq("account_id", ctx.accountId).order("created_at", { ascending: false }),
    ctx.supabase.from("custom_fields").select("id, field_name, field_type, field_options").eq("account_id", ctx.accountId).order("created_at"),
    ctx.supabase.from("contact_custom_values").select("contact_id, custom_field_id, value"),
    ctx.supabase.from("profiles").select("user_id, full_name, email, avatar_url").eq("account_id", ctx.accountId),
  ])
  if (contactsResult.error) throw new Error(contactsResult.error.message)
  if (fieldsResult.error) throw new Error(fieldsResult.error.message)
  if (valuesResult.error) throw new Error(valuesResult.error.message)
  if (profilesResult.error) throw new Error(profilesResult.error.message)

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
    owners: (profilesResult.data ?? []).map((profile) => ({
      userId: String(profile.user_id),
      name: (profile.full_name as string | null) || (profile.email as string | null) || "Team member",
      avatarUrl: (profile.avatar_url as string | null) ?? null,
    })),
    currentUserId: ctx.userId,
  }
}

export async function createSupabaseContact(ctx: AccountContext, values: Record<string, ContactValue>) {
  const { ownerId, ...rest } = values
  const fields = validateContactIdentity(rest)
  const owner = typeof ownerId === "string" && ownerId.trim() ? ownerId : ctx.userId
  const { data, error } = await ctx.supabase.from("contacts").insert({ ...fields, account_id: ctx.accountId, user_id: owner }).select(CONTACT_SELECT).single()
  if (error) throw new Error(error.code === "23505" ? "A contact with these details already exists" : error.message)
  const resolved = await resolveExtendedValues(ctx, rest)
  await saveCustomValues(ctx, String(data.id), resolved)
  return mapContact(data, Object.fromEntries(Object.entries(resolved).filter((entry): entry is [string, ContactValue] => entry[1] !== undefined)))
}

export async function updateSupabaseContact(ctx: AccountContext, id: string, values: Partial<Record<string, ContactValue>>) {
  const { ownerId, ...rest } = values
  const { data: current, error: currentError } = await ctx.supabase.from("contacts").select(CONTACT_SELECT).eq("account_id", ctx.accountId).eq("id", id).single()
  if (currentError) throw new Error(currentError.message)
  const currentContact = mapContact(current)
  const identityTouched = ["name", "phone", "email", "company"].some((key) => rest[key] !== undefined)
  const ownerTouched = typeof ownerId === "string" && ownerId.trim() && ownerId !== currentContact.ownerId
  let row = current as Record<string, unknown>
  if (identityTouched || ownerTouched) {
    const identity = identityTouched ? validateContactIdentity({ ...currentContact.values, ...rest }) : {}
    const patch = ownerTouched ? { ...identity, user_id: ownerId } : identity
    const { data, error } = await ctx.supabase.from("contacts").update(patch).eq("account_id", ctx.accountId).eq("id", id).select(CONTACT_SELECT).single()
    if (error) throw new Error(error.code === "23505" ? "A contact with these details already exists" : error.message)
    row = data
  }
  const resolved = await resolveExtendedValues(ctx, rest)
  await saveCustomValues(ctx, id, resolved)
  const mergedValues = Object.fromEntries(Object.entries({ ...currentContact.values, ...resolved }).filter((entry): entry is [string, ContactValue] => entry[1] !== undefined))
  return mapContact(row, mergedValues)
}

export async function createSupabaseContactField(ctx: AccountContext, field: { label: string; type: FieldType; options?: string[]; required?: boolean; unique?: boolean }) {
  const { data: rows, error: fieldsError } = await ctx.supabase.from("custom_fields").select("id, field_name, field_type, field_options").eq("account_id", ctx.accountId)
  if (fieldsError) throw new Error(fieldsError.message)
  const validated = validateFieldDefinition(field, [...coreContactFields, ...(rows ?? []).map(mapField)])
  const payload = fieldOptionsPayload({ ...validated, required: field.required === true, unique: field.unique === true })
  const { data, error } = await ctx.supabase.from("custom_fields").insert({ account_id: ctx.accountId, user_id: ctx.userId, field_name: validated.label, field_type: validated.type, field_options: payload }).select("id, field_name, field_type, field_options").single()
  if (error) throw new Error(error.code === "23505" ? `A field named “${validated.label}” already exists` : error.message)
  return mapField(data)
}

export async function updateSupabaseContactField(ctx: AccountContext, id: string, field: { label?: string; type?: FieldType; options?: string[]; required?: boolean; unique?: boolean }) {
  const { data: rows, error: fieldsError } = await ctx.supabase.from("custom_fields").select("id, field_name, field_type, field_options").eq("account_id", ctx.accountId)
  if (fieldsError) throw new Error(fieldsError.message)
  const existing = (rows ?? []).map(mapField)
  const current = existing.find((item) => item.id === id)
  if (!current) throw new Error("Custom field not found")
  const validated = validateFieldDefinition({ label: field.label ?? current.label, type: field.type ?? current.type, options: field.options ?? current.options }, [...coreContactFields, ...existing], id)
  const payload = fieldOptionsPayload({ ...validated, required: field.required ?? current.required === true, unique: field.unique ?? current.unique === true })
  const { data, error } = await ctx.supabase.from("custom_fields").update({ field_name: validated.label, field_type: validated.type, field_options: payload }).eq("account_id", ctx.accountId).eq("id", id).select("id, field_name, field_type, field_options").single()
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

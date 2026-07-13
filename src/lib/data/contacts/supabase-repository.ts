import "server-only"

import type { AccountContext } from "@/lib/auth/account"
import type { ContactPreferences, ContactValue, ContactWorkspaceData, WorkspaceContact } from "./types"

export const coreContactFields = [
  { id: "name", label: "Name", type: "text" as const, required: true, width: 220 },
  { id: "phone", label: "Phone", type: "phone" as const, width: 180 },
  { id: "email", label: "Email", type: "email" as const, width: 220 },
  { id: "company", label: "Company", type: "text" as const, width: 180 },
]

const defaultPreferences: ContactPreferences = {
  visible: coreContactFields.map((field) => field.id),
  order: coreContactFields.map((field) => field.id),
  frozen: ["name"],
  widths: {},
}

function mapContact(row: Record<string, unknown>): WorkspaceContact {
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
    },
  }
}

function contactColumns(values: Partial<Record<string, ContactValue>>) {
  const allowed = ["name", "phone", "email", "company"] as const
  return Object.fromEntries(allowed.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]))
}

export async function getSupabaseContactWorkspace(ctx: AccountContext): Promise<ContactWorkspaceData> {
  const { data, error } = await ctx.supabase.from("contacts").select("id, account_id, name, phone, email, company, created_at, updated_at").eq("account_id", ctx.accountId).order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return { contacts: (data ?? []).map((row) => mapContact(row)), fields: coreContactFields, preferences: defaultPreferences }
}

export async function createSupabaseContact(ctx: AccountContext, values: Record<string, ContactValue>) {
  const fields = contactColumns(values)
  if (!fields.name || (!fields.phone && !fields.email)) throw new Error("Name and either phone or email are required")
  const { data, error } = await ctx.supabase.from("contacts").insert({ ...fields, account_id: ctx.accountId, user_id: ctx.userId }).select("id, account_id, name, phone, email, company, created_at, updated_at").single()
  if (error) throw new Error(error.code === "23505" ? "A contact with these details already exists" : error.message)
  return mapContact(data)
}

export async function updateSupabaseContact(ctx: AccountContext, id: string, values: Partial<Record<string, ContactValue>>) {
  const { data, error } = await ctx.supabase.from("contacts").update(contactColumns(values)).eq("account_id", ctx.accountId).eq("id", id).select("id, account_id, name, phone, email, company, created_at, updated_at").single()
  if (error) throw new Error(error.message)
  return mapContact(data)
}

export async function deleteSupabaseContacts(ctx: AccountContext, ids: string[]) {
  if (!ids.length) return 0
  const { error, count } = await ctx.supabase.from("contacts").delete({ count: "exact" }).eq("account_id", ctx.accountId).in("id", ids)
  if (error) throw new Error(error.message)
  return count ?? ids.length
}

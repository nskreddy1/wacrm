import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import {
  createSupabaseContact,
  deleteSupabaseContacts,
  getSupabaseContactWorkspace,
  updateSupabaseContact,
} from "@/lib/data/contacts/supabase-repository"
import type { ContactPreferences, ContactValue, FieldType } from "@/lib/data/contacts/types"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

function response(data: unknown, status = 200) {
  return NextResponse.json({ data, meta: { source: "supabase" } }, { status })
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: { code: "request_failed", message: error instanceof Error ? error.message : "Request failed" } }, { status })
}

export async function GET() {
  try {
    getDataSource()
    return response(await getSupabaseContactWorkspace(await getCurrentAccount()))
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    getDataSource()
    const body = (await request.json()) as {
      kind?: string
      values?: Record<string, ContactValue>
      field?: { label: string; type: FieldType; options?: string[]; width?: number }
    }
    if (body.kind === "field") return failure(new Error("Custom contact fields are not available yet"), 501)
    if (!body.values) throw new Error("Contact values are required")
    return response(await createSupabaseContact(await getCurrentAccount(), body.values), 201)
  } catch (error) {
    return failure(error)
  }
}

export async function PATCH(request: Request) {
  try {
    getDataSource()
    const body = (await request.json()) as {
      kind?: string
      id?: string
      values?: Partial<Record<string, ContactValue>>
      preferences?: Partial<ContactPreferences>
    }
    if (body.kind === "preferences") return response(body.preferences ?? {})
    if (!body.id || !body.values) throw new Error("Contact id and values are required")
    return response(await updateSupabaseContact(await getCurrentAccount(), body.id, body.values))
  } catch (error) {
    return failure(error)
  }
}

export async function DELETE(request: Request) {
  try {
    getDataSource()
    const body = (await request.json()) as { ids?: string[] }
    if (!Array.isArray(body.ids)) throw new Error("Contact ids are required")
    return response({ deleted: await deleteSupabaseContacts(await getCurrentAccount(), body.ids) })
  } catch (error) {
    return failure(error)
  }
}

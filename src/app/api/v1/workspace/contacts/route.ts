import { NextResponse } from "next/server"

import {
  createMockContact,
  createMockContactField,
  deleteMockContacts,
  getMockContactWorkspace,
  updateMockContact,
  updateMockContactPreferences,
} from "@/lib/data/contacts/mock-repository"
import type { ContactPreferences, ContactValue, FieldType } from "@/lib/data/contacts/types"
import { getDataSource, getMockDataContext } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

function response(data: unknown, status = 200) {
  return NextResponse.json({ data, meta: { source: getDataSource() } }, { status })
}

function failure(error: unknown, status = 400) {
  return NextResponse.json(
    { error: { code: "request_failed", message: error instanceof Error ? error.message : "Request failed" } },
    { status },
  )
}

function context(request: Request) {
  const accountId = new URL(request.url).searchParams.get("account")
  return getMockDataContext(accountId)
}

export async function GET(request: Request) {
  const ctx = context(request)
  if (ctx.source !== "mock") {
    return failure(new Error("The Supabase workspace adapter is not available for this endpoint"), 503)
  }
  return response(getMockContactWorkspace(ctx.accountId))
}

export async function POST(request: Request) {
  try {
    const ctx = context(request)
    const body = (await request.json()) as {
      kind?: string
      values?: Record<string, ContactValue>
      field?: { label: string; type: FieldType; options?: string[]; width?: number }
    }
    if (body.kind === "field") {
      if (!body.field?.label || !body.field.type) throw new Error("Field label and type are required")
      return response(createMockContactField(body.field), 201)
    }
    if (!body.values) throw new Error("Contact values are required")
    return response(createMockContact(ctx.accountId, body.values), 201)
  } catch (error) {
    return failure(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = context(request)
    const body = (await request.json()) as {
      kind?: string
      id?: string
      values?: Partial<Record<string, ContactValue>>
      preferences?: Partial<ContactPreferences>
    }
    if (body.kind === "preferences") {
      return response(updateMockContactPreferences(body.preferences ?? {}))
    }
    if (!body.id || !body.values) throw new Error("Contact id and values are required")
    return response(updateMockContact(ctx.accountId, body.id, body.values))
  } catch (error) {
    return failure(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = context(request)
    const body = (await request.json()) as { ids?: string[] }
    if (!Array.isArray(body.ids)) throw new Error("Contact ids are required")
    deleteMockContacts(ctx.accountId, body.ids)
    return response({ deleted: body.ids.length })
  } catch (error) {
    return failure(error)
  }
}

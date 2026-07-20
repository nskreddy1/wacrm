// ============================================================
// /api/v1/workspace/catalog — session-scoped catalog item CRUD.
//
// Generic products/services catalog: a school sells courses and
// programs, a clinic sells consultations — same shape.
//
// GET    ?includeInactive=true        — list
// POST   { name, price, ... }         — create
// PATCH  { id, ...fields }            — update
// DELETE { ids: [...] }               — bulk delete (admin per RLS)
// ============================================================

import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import {
  createCatalogItem,
  deleteCatalogItems,
  listCatalogItems,
  updateCatalogItem,
} from "@/lib/data/operations/supabase-repository"
import {
  catalogItemCreateSchema,
  catalogItemUpdateSchema,
  idListSchema,
} from "@/lib/data/operations/validation"

export const dynamic = "force-dynamic"

function response(data: unknown, status = 200) {
  return NextResponse.json({ data, meta: { source: "supabase" } }, { status })
}

function validationFailure(error: z.ZodError) {
  return NextResponse.json(
    {
      error: {
        code: "validation_failed",
        message: error.issues[0]?.message ?? "Invalid request body",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    },
    { status: 422 },
  )
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(request.url)
    const includeInactive = url.searchParams.get("includeInactive") === "true"
    return response(await listCatalogItems(ctx, { includeInactive }))
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const parsed = catalogItemCreateSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailure(parsed.error)
    return response(await createCatalogItem(ctx, parsed.data), 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const parsed = catalogItemUpdateSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailure(parsed.error)
    const { id, ...fields } = parsed.data
    return response(await updateCatalogItem(ctx, id, fields))
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const parsed = idListSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailure(parsed.error)
    return response({ deleted: await deleteCatalogItems(ctx, parsed.data.ids) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

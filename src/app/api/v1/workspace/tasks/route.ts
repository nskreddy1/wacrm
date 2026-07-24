// ============================================================
// /api/v1/workspace/tasks — session-scoped follow-up task CRUD.
//
// GET    ?status=open&limit=<n>       — list
// POST   { title, dueAt, ... }        — create
// PATCH  { id, ...fields }            — update (incl. status=done)
// DELETE { ids: [...] }               — bulk delete
// ============================================================

import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentAccount, toErrorResponse } from "@/features/auth/lib/account"
import {
  createTask,
  deleteTasks,
  listTasks,
  updateTask,
} from "@/lib/data/operations/supabase-repository"
import type { TaskStatus } from "@/lib/data/operations/types"
import {
  idListSchema,
  taskCreateSchema,
  taskUpdateSchema,
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

const TASK_STATUSES: readonly TaskStatus[] = ["open", "done", "cancelled"]

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(request.url)
    const statusParam = url.searchParams.get("status")
    const status = TASK_STATUSES.includes(statusParam as TaskStatus)
      ? (statusParam as TaskStatus)
      : undefined
    const limitParam = Number(url.searchParams.get("limit"))
    const limit =
      Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 200
        ? limitParam
        : undefined

    return response(await listTasks(ctx, { status, limit }))
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const parsed = taskCreateSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailure(parsed.error)
    return response(await createTask(ctx, parsed.data), 201)
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const parsed = taskUpdateSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailure(parsed.error)
    const { id, ...fields } = parsed.data
    return response(await updateTask(ctx, id, fields))
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const parsed = idListSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailure(parsed.error)
    return response({ deleted: await deleteTasks(ctx, parsed.data.ids) })
  } catch (error) {
    return toErrorResponse(error)
  }
}

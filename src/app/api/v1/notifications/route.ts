import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { listMockNotifications, markMockNotificationsRead } from "@/lib/data/notifications/mock-repository"
import { listSupabaseNotifications, markSupabaseNotificationsRead } from "@/lib/data/notifications/supabase-repository"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()
  if (source === "mock") return NextResponse.json({ data: listMockNotifications(), meta: { source } })
  try {
    const context = await getCurrentAccount()
    return NextResponse.json({ data: await listSupabaseNotifications(context), meta: { source } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  const source = getDataSource()
  const body = await request.json().catch(() => ({})) as { ids?: unknown }
  if (body.ids !== undefined && (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string"))) {
    return NextResponse.json({ error: "ids must be an array of strings" }, { status: 400 })
  }
  const ids = body.ids as string[] | undefined
  if (source === "mock") return NextResponse.json({ data: markMockNotificationsRead(ids), meta: { source } })
  try {
    const context = await getCurrentAccount()
    return NextResponse.json({ data: await markSupabaseNotificationsRead(context, ids), meta: { source } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

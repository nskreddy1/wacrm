import { NextResponse } from "next/server"

import { listMockNotifications, markMockNotificationsRead } from "@/lib/data/notifications/mock-repository"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()
  if (source === "mock") return NextResponse.json({ data: listMockNotifications(), meta: { source } })
  return NextResponse.json({ error: { code: "not_implemented", message: "Supabase notifications adapter is not configured" } }, { status: 503 })
}

export async function PATCH(request: Request) {
  const source = getDataSource()
  if (source !== "mock") return NextResponse.json({ error: { code: "not_implemented", message: "Supabase notifications adapter is not configured" } }, { status: 503 })
  const body = await request.json().catch(() => ({})) as { ids?: string[] }
  return NextResponse.json({ data: markMockNotificationsRead(body.ids), meta: { source } })
}

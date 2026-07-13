import { NextResponse } from "next/server"

import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()
  if (source === "mock") return NextResponse.json({ data: { unreadConversations: 3 }, meta: { source } })
  return NextResponse.json({ error: { code: "not_implemented", message: "Supabase inbox adapter is not configured" } }, { status: 503 })
}

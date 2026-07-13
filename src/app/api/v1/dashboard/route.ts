import { NextResponse } from "next/server"

import { getMockDashboard } from "@/lib/data/dashboard/mock-repository"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()
  if (source === "mock") {
    return NextResponse.json({ data: getMockDashboard(), meta: { source } })
  }

  return NextResponse.json(
    { error: { code: "not_implemented", message: "Supabase dashboard adapter is not configured" } },
    { status: 503 },
  )
}

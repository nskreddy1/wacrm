import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/features/auth/lib/account"
import { getDashboardOverview } from "@/lib/data/dashboard/supabase-repository"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const source = getDataSource()
    const context = await getCurrentAccount()
    const data = await getDashboardOverview(context)
    return NextResponse.json({ data, meta: { source } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

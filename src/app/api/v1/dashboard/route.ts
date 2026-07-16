import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { getSupabaseDashboard } from "@/lib/data/dashboard/supabase-repository"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const source = getDataSource()
    const context = await getCurrentAccount()
    const data = await getSupabaseDashboard(context)
    return NextResponse.json({ data, meta: { source } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

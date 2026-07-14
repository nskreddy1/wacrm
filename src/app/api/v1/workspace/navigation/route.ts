// ============================================================
// GET /api/v1/workspace/navigation — role-scoped nav for the
// app shell. The sidebar renders a static viewer-safe fallback
// instantly, then reconciles with this response, so this route
// stays cheap: it reuses the account context (one profile read)
// and does pure in-memory filtering.
// ============================================================

import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { getDataSource } from "@/lib/data/runtime"
import { navigationForRole } from "@/lib/navigation/config"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()
  if (source === "mock") {
    return NextResponse.json({ data: { groups: navigationForRole("owner") }, meta: { source } })
  }

  try {
    const context = await getCurrentAccount()
    return NextResponse.json({ data: { groups: navigationForRole(context.role) }, meta: { source } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

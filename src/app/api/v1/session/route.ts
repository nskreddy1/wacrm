import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { getSessionPayload } from "@/lib/auth/session-payload"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    // Shared with the dashboard server layout so the SSR-provided
    // fallback session and this client-revalidated session can never
    // drift in shape. See lib/auth/session-payload.ts for the perf notes.
    const payload = await getSessionPayload()
    return NextResponse.json(payload)
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE() {
  try {
    const source = getDataSource()
    const context = await getCurrentAccount()
    const { error } = await context.supabase.auth.signOut()
    if (error) throw error
    return NextResponse.json({ data: { signed_out: true }, meta: { source } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

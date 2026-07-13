import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()
  if (source === "mock") return NextResponse.json({ data: { unreadConversations: 3 }, meta: { source } })
  try {
    const context = await getCurrentAccount()
    const { count, error } = await context.supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("account_id", context.accountId)
      .gt("unread_count", 0)
    if (error) throw error
    return NextResponse.json({ data: { unreadConversations: count ?? 0 }, meta: { source } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

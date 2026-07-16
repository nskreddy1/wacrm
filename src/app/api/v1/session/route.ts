import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const source = getDataSource()
    const context = await getCurrentAccount()
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, role, beta_features, account_id, account_role")
      .eq("user_id", context.userId)
      .single()

    if (profileError) throw profileError

    const { data: account, error: accountError } = await context.supabase
      .from("accounts")
      .select("id, name, default_currency")
      .eq("id", context.accountId)
      .single()

    if (accountError) throw accountError

    const { data: authData, error: authError } = await context.supabase.auth.getUser()
    if (authError || !authData.user) throw authError ?? new Error("Session user is unavailable")

    return NextResponse.json({
      data: {
        user: {
          id: authData.user.id,
          email: authData.user.email ?? profile.email,
          created_at: authData.user.created_at,
        },
        profile: { ...profile, id: profile.user_id },
        account,
      },
      meta: { source },
    })
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

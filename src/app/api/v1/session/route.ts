import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const source = getDataSource()
    const context = await getCurrentAccount()
    // PERF: profile + account fetched in parallel, and the previous
    // `auth.getUser()` network call is gone — the user id comes from
    // the (already locally verified) context, and `created_at` comes
    // from the profile row, which the signup trigger creates at the
    // same moment as the auth user.
    const [profileResult, accountResult] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, role, beta_features, account_id, account_role, created_at")
        .eq("user_id", context.userId)
        .single(),
      context.supabase
        .from("accounts")
        .select("id, name, default_currency")
        .eq("id", context.accountId)
        .single(),
    ])

    const { data: profile, error: profileError } = profileResult
    if (profileError) throw profileError

    const { data: account, error: accountError } = accountResult
    if (accountError) throw accountError

    return NextResponse.json({
      data: {
        user: {
          id: context.userId,
          email: profile.email,
          created_at: profile.created_at,
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

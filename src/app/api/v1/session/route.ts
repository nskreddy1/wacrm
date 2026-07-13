import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { DEMO_ACCOUNT_ID, DEMO_USER_ID, getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

function mockSession() {
  return {
    user: { id: DEMO_USER_ID, email: "sam@acme.example" },
    profile: {
      id: DEMO_USER_ID,
      full_name: "Sam Silva",
      email: "sam@acme.example",
      avatar_url: null,
      role: "owner",
      beta_features: [],
      account_id: DEMO_ACCOUNT_ID,
      account_role: "owner",
    },
    account: { id: DEMO_ACCOUNT_ID, name: "Acme Support", default_currency: "USD" },
  }
}

export async function GET() {
  const source = getDataSource()

  if (source === "mock") {
    return NextResponse.json({ data: mockSession(), meta: { source } })
  }

  try {
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
  if (getDataSource() === "mock") {
    return NextResponse.json({ data: { signed_out: true }, meta: { source: "mock" } })
  }

  try {
    const context = await getCurrentAccount()
    const { error } = await context.supabase.auth.signOut()
    if (error) throw error
    return NextResponse.json({ data: { signed_out: true }, meta: { source: "supabase" } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

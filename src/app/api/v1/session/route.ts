import { NextResponse } from "next/server"

import { DEMO_ACCOUNT_ID, DEMO_USER_ID, getDataSource } from "@/lib/data/runtime"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()

  if (source === "mock") {
    return NextResponse.json({
      data: {
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
      },
      meta: { source },
    })
  }

  return NextResponse.json(
    { error: { code: "not_implemented", message: "Supabase session adapter is not configured" } },
    { status: 503 },
  )
}

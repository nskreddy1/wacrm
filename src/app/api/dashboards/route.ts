// ============================================================
// /api/dashboards
//
//   GET  — list the caller's custom dashboards (all fields; the
//          widgets jsonb is small and the UI needs it anyway).
//   POST — create a dashboard (optionally with initial widgets).
//
// Dashboards are PERSONAL: scoped to (user_id, account_id) and
// enforced owner-only by RLS. Any role can use them — they only
// project data the user can already see on the overview.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  MAX_DASHBOARDS_PER_USER,
  sanitizeWidgets,
} from '@/lib/dashboards/widgets'

const COLUMNS = 'id, name, widgets, position, created_at, updated_at'
const MAX_NAME_LEN = 60

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('user_dashboards')
      .select(COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json(
        { error: 'Failed to load dashboards' },
        { status: 500 },
      )
    }
    return NextResponse.json({ dashboards: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const body = (await request.json().catch(() => null)) as {
      name?: unknown
      widgets?: unknown
    } | null

    const name =
      typeof body?.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LEN) : ''
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    // Per-user cap — keeps the switcher (and the jsonb rows) sane.
    const { count } = await ctx.supabase
      .from('user_dashboards')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('user_id', ctx.userId)
    if ((count ?? 0) >= MAX_DASHBOARDS_PER_USER) {
      return NextResponse.json(
        { error: `Limit of ${MAX_DASHBOARDS_PER_USER} dashboards reached` },
        { status: 400 },
      )
    }

    const { data, error } = await ctx.supabase
      .from('user_dashboards')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        widgets: sanitizeWidgets(body?.widgets),
        position: count ?? 0,
      })
      .select(COLUMNS)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: 'Failed to create dashboard' },
        { status: 500 },
      )
    }
    return NextResponse.json({ dashboard: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

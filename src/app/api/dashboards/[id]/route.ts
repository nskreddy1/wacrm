// ============================================================
// /api/dashboards/[id]
//
//   PATCH  — rename and/or replace the widgets array (autosave).
//   DELETE — remove the dashboard.
//
// RLS restricts every operation to the owning user; the explicit
// .eq('user_id') is defense-in-depth, not the primary guard.
// ============================================================

import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/features/auth/lib/account'
import { sanitizeWidgets } from '@/features/dashboards/lib/widgets'

const COLUMNS = 'id, name, widgets, position, created_at, updated_at'
const MAX_NAME_LEN = 60

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const ctx = await getCurrentAccount()
    const body = (await request.json().catch(() => null)) as {
      name?: unknown
      widgets?: unknown
    } | null

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof body?.name === 'string') {
      const name = body.name.trim().slice(0, MAX_NAME_LEN)
      if (!name) {
        return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      }
      patch.name = name
    }
    if (body && 'widgets' in body) {
      patch.widgets = sanitizeWidgets(body.widgets)
    }

    const { data, error } = await ctx.supabase
      .from('user_dashboards')
      .update(patch)
      .eq('id', id)
      .eq('user_id', ctx.userId)
      .select(COLUMNS)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 })
    }
    return NextResponse.json({ dashboard: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const ctx = await getCurrentAccount()
    const { error } = await ctx.supabase
      .from('user_dashboards')
      .delete()
      .eq('id', id)
      .eq('user_id', ctx.userId)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete dashboard' },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

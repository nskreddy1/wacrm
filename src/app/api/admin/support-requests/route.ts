import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { supabaseAdmin } from '@/lib/ai/admin-client'

// ============================================================
// AI support requests — super-admin review surface.
//
// Mirrors the platform-settings route pattern: both methods require an
// authenticated user on the SUPER_ADMIN_EMAILS allowlist; the table's
// RLS allows member INSERT/SELECT only, so status/notes updates happen
// exclusively here through the service-role client after the gate.
// ============================================================

const STATUSES = ['pending', 'in_progress', 'resolved'] as const
type Status = (typeof STATUSES)[number]

/** 401 for no session, 403 for a session that isn't a super admin. */
async function requireSuperAdmin(): Promise<NextResponse | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!isSuperAdmin(user.email)) {
    return NextResponse.json(
      { error: 'Super admin access required' },
      { status: 403 },
    )
  }
  return null
}

/**
 * GET /api/admin/support-requests[?status=pending]
 *
 * All accounts' AI support requests, newest first, with the account
 * name joined in so the admin table is readable without extra calls.
 */
export async function GET(request: Request) {
  const denied = await requireSuperAdmin()
  if (denied) return denied

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  if (status && !STATUSES.includes(status as Status)) {
    return NextResponse.json(
      { error: `status must be one of: ${STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  let query = supabaseAdmin()
    .from('ai_support_requests')
    .select(
      'id, account_id, user_id, topic, message, contact_info, status, admin_notes, created_at, updated_at, accounts(name)',
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    console.error('[admin/support-requests GET] fetch error:', error)
    return NextResponse.json(
      { error: 'Failed to load support requests' },
      { status: 500 },
    )
  }
  return NextResponse.json({ requests: data ?? [] })
}

/**
 * PATCH /api/admin/support-requests
 *
 * Body: `{ id, status?, admin_notes? }` — update a request's triage
 * state. At least one of status/admin_notes must be present.
 */
export async function PATCH(request: Request) {
  const denied = await requireSuperAdmin()
  if (denied) return denied

  const body = (await request.json().catch(() => null)) as {
    id?: unknown
    status?: unknown
    admin_notes?: unknown
  } | null

  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (body && 'status' in body && body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) {
      return NextResponse.json(
        { error: `status must be one of: ${STATUSES.join(', ')}` },
        { status: 400 },
      )
    }
    update.status = body.status
  }
  if (body && 'admin_notes' in body && body.admin_notes !== undefined) {
    const notes =
      typeof body.admin_notes === 'string' ? body.admin_notes.trim() : ''
    if (notes.length > 4000) {
      return NextResponse.json(
        { error: 'admin_notes must be ≤ 4000 characters' },
        { status: 400 },
      )
    }
    update.admin_notes = notes || null
  }
  if (!('status' in update) && !('admin_notes' in update)) {
    return NextResponse.json(
      { error: 'Provide status and/or admin_notes' },
      { status: 400 },
    )
  }

  const { data, error } = await supabaseAdmin()
    .from('ai_support_requests')
    .update(update)
    .eq('id', id)
    .select(
      'id, account_id, user_id, topic, message, contact_info, status, admin_notes, created_at, updated_at',
    )
    .maybeSingle()

  if (error) {
    console.error('[admin/support-requests PATCH] update error:', error)
    return NextResponse.json(
      { error: 'Failed to update support request' },
      { status: 500 },
    )
  }
  if (!data) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }
  return NextResponse.json({ request: data })
}

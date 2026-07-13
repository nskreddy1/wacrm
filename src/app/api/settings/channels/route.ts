import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const updateSchema = z.object({
  id: z.string().uuid(),
  isEnabled: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
})

const SAFE_COLUMNS = [
  'id',
  'account_id',
  'created_by_user_id',
  'channel',
  'provider',
  'display_name',
  'external_account_id',
  'external_identity',
  'configuration',
  'status',
  'is_enabled',
  'is_primary',
  'last_connected_at',
  'last_synced_at',
  'last_error',
  'created_at',
  'updated_at',
].join(',')

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { data, error } = await supabase
      .from('channel_connections')
      .select(SAFE_COLUMNS)
      .eq('account_id', accountId)
      .order('channel')
      .order('created_at')

    if (error) throw error
    return NextResponse.json({ connections: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid channel connection update', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const updates: { is_enabled?: boolean; is_primary?: boolean } = {}
    if (parsed.data.isEnabled !== undefined) {
      updates.is_enabled = parsed.data.isEnabled
    }
    if (parsed.data.isPrimary !== undefined) {
      updates.is_primary = parsed.data.isPrimary
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No changes supplied' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await supabase
      .from('channel_connections')
      .select('id, channel, status')
      .eq('id', parsed.data.id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) {
      return NextResponse.json({ error: 'Channel connection not found' }, { status: 404 })
    }
    if (updates.is_enabled && !['connected', 'degraded'].includes(existing.status)) {
      return NextResponse.json(
        { error: 'Connect this provider before enabling it' },
        { status: 409 },
      )
    }

    if (updates.is_primary) {
      const { error: clearError } = await supabase
        .from('channel_connections')
        .update({ is_primary: false })
        .eq('account_id', accountId)
        .eq('channel', existing.channel)
        .neq('id', existing.id)
      if (clearError) throw clearError
    }

    const { data, error } = await supabase
      .from('channel_connections')
      .update(updates)
      .eq('id', existing.id)
      .eq('account_id', accountId)
      .select(SAFE_COLUMNS)
      .single()
    if (error) throw error

    return NextResponse.json({ connection: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

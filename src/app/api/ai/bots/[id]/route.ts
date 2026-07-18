import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  BOT_SELECT_COLUMNS,
  BotPayloadError,
  parseBotPayload,
} from '@/lib/ai/bot-payload'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ai/bots/[id] — read one bot (viewer+ via RLS).
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return bad('Invalid bot id')

    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('ai_bots')
      .select(BOT_SELECT_COLUMNS)
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('[ai/bots/:id GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load bot' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
    }
    return NextResponse.json({ bot: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/bots/[id]  (admin+)
 *
 * Partial edit — only fields present in the body change. `is_active`
 * is deliberately NOT editable here; activation has its own endpoint
 * with deactivate-then-activate semantics.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return bad('Invalid bot id')

    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-bots:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    let parsed
    try {
      parsed = parseBotPayload(body as Record<string, unknown>)
    } catch (err) {
      if (err instanceof BotPayloadError) return bad(err.message)
      throw err
    }
    const { fields, handoffAgentId, handoffProvided } = parsed

    if (handoffProvided && handoffAgentId) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', handoffAgentId)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
    }

    const update = {
      ...fields,
      ...(handoffProvided ? { handoff_agent_id: handoffAgentId } : {}),
    }
    if (Object.keys(update).length === 0) return bad('No fields to update')

    const { data, error } = await supabase
      .from('ai_bots')
      .update(update)
      .eq('account_id', accountId)
      .eq('id', id)
      .select(BOT_SELECT_COLUMNS)
      .maybeSingle()

    if (error) {
      console.error('[ai/bots/:id PATCH] update error:', error)
      return NextResponse.json({ error: 'Failed to update bot' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
    }
    return NextResponse.json({ bot: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/bots/[id]  (admin+)
 *
 * Deleting the active bot simply leaves the account bot-less (base
 * scaffold persona); auto-reply stays governed by `ai_configs` flags.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) return bad('Invalid bot id')

    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-bots:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data, error } = await supabase
      .from('ai_bots')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[ai/bots/:id DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete bot' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { BOT_SELECT_COLUMNS } from '@/lib/ai/bot-payload'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/ai/bots/[id]/activate  (admin+)
 *
 * Make this bot THE active one: deactivate all of the account's bots,
 * then activate the target. Two statements, not a transaction — the
 * partial unique index `UNIQUE (account_id) WHERE is_active` is the
 * race-safe backstop: two concurrent activations can't both win; the
 * loser gets a constraint error and retries cleanly.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid bot id' }, { status: 400 })
    }

    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-bots:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    // Verify the bot exists in this account before touching anything —
    // otherwise "deactivate all" for a bogus id would kill the current
    // active bot for nothing.
    const { data: target, error: findErr } = await supabase
      .from('ai_bots')
      .select('id, is_active')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()

    if (findErr) {
      console.error('[ai/bots activate] lookup error:', findErr)
      return NextResponse.json({ error: 'Failed to activate bot' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
    }
    if (target.is_active) {
      // Idempotent: already active is success, not an error.
      const { data } = await supabase
        .from('ai_bots')
        .select(BOT_SELECT_COLUMNS)
        .eq('id', id)
        .single()
      return NextResponse.json({ bot: data })
    }

    const { error: deactErr } = await supabase
      .from('ai_bots')
      .update({ is_active: false })
      .eq('account_id', accountId)
      .eq('is_active', true)

    if (deactErr) {
      console.error('[ai/bots activate] deactivate error:', deactErr)
      return NextResponse.json({ error: 'Failed to activate bot' }, { status: 500 })
    }

    const { data, error: actErr } = await supabase
      .from('ai_bots')
      .update({ is_active: true })
      .eq('account_id', accountId)
      .eq('id', id)
      .select(BOT_SELECT_COLUMNS)
      .single()

    if (actErr) {
      // Unique-index collision (concurrent activation) or other failure.
      console.error('[ai/bots activate] activate error:', actErr)
      return NextResponse.json(
        { error: 'Another activation happened at the same time — try again.' },
        { status: 409 },
      )
    }

    return NextResponse.json({ bot: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

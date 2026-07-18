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
import { getBuiltInTemplate } from '@/lib/ai/bot-templates'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/bots
 *
 * List the account's bots (viewer+ via RLS). Active bot first, then
 * newest — matches the card grid's reading order.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_bots')
      .select(BOT_SELECT_COLUMNS)
      .eq('account_id', accountId)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[ai/bots GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load bots' }, { status: 500 })
    }

    return NextResponse.json({ bots: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

const MAX_BOTS_PER_ACCOUNT = 20

/**
 * POST /api/ai/bots  (admin+)
 *
 * Create a bot. Body may carry any bot fields; `template_key` (when it
 * names a built-in template) prefills prompt/tone/greeting for fields
 * the body doesn't set explicitly, so "Use template" is one call.
 * New bots are NEVER active — activation is its own explicit endpoint.
 */
export async function POST(request: Request) {
  try {
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

    // Template prefill: only for fields the body did NOT set, so an
    // edited-before-save template still wins.
    const templateKey =
      typeof fields.template_key === 'string' ? fields.template_key : null
    if (templateKey) {
      const tpl = getBuiltInTemplate(templateKey)
      if (tpl) {
        if (!('name' in fields)) fields.name = tpl.name
        if (!('emoji' in fields)) fields.emoji = tpl.emoji
        if (!('description' in fields)) fields.description = tpl.description
        if (!('system_prompt' in fields)) fields.system_prompt = tpl.systemPrompt
        if (!('tone' in fields)) fields.tone = tpl.tone
        if (!('greeting_message' in fields)) {
          fields.greeting_message = tpl.greetingMessage
        }
      }
    }

    if (!fields.name) return bad('name is required')
    if (!fields.system_prompt) return bad('system_prompt is required')

    if (handoffProvided && handoffAgentId) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', handoffAgentId)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
    }

    // Soft cap so one account can't accumulate unbounded rows.
    const { count } = await supabase
      .from('ai_bots')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if ((count ?? 0) >= MAX_BOTS_PER_ACCOUNT) {
      return bad(`An account can have at most ${MAX_BOTS_PER_ACCOUNT} bots`)
    }

    const { data, error } = await supabase
      .from('ai_bots')
      .insert({
        account_id: accountId,
        created_by: userId,
        ...fields,
        ...(handoffProvided ? { handoff_agent_id: handoffAgentId } : {}),
        is_active: false,
      })
      .select(BOT_SELECT_COLUMNS)
      .single()

    if (error) {
      console.error('[ai/bots POST] insert error:', error)
      return NextResponse.json({ error: 'Failed to create bot' }, { status: 500 })
    }

    return NextResponse.json({ bot: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

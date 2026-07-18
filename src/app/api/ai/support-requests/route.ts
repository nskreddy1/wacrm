import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

const TOPICS = ['setup_help', 'api_key', 'prompt_tuning', 'handoff', 'other'] as const
type Topic = (typeof TOPICS)[number]

/**
 * GET /api/ai/support-requests
 *
 * The account's own AI-configuration support requests, newest first —
 * shown under the "Need help configuring AI?" card so requesters can
 * see status without asking again. RLS scopes reads to the account.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_support_requests')
      .select('id, topic, message, contact_info, status, created_at, updated_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[ai/support-requests GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load support requests' },
        { status: 500 },
      )
    }
    return NextResponse.json({ requests: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/support-requests
 *
 * Any member may ask for help configuring AI (deliberately NOT admin-
 * gated — agents hit setup friction too). Admin-only responses happen
 * on the super-admin side.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount()

    // Support requests notify humans — keep the volume sane.
    const limit = checkRateLimit(
      `ai-support-req:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const topic = TOPICS.includes(body.topic as Topic)
      ? (body.topic as Topic)
      : null
    if (!topic) return bad(`topic must be one of: ${TOPICS.join(', ')}`)

    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) return bad('message is required')
    if (message.length > 4000) return bad('message must be ≤ 4000 characters')

    const contactInfo =
      typeof body.contact_info === 'string' ? body.contact_info.trim() : ''
    if (contactInfo.length > 200) {
      return bad('contact_info must be ≤ 200 characters')
    }

    // Bound open requests per account so the admin queue can't be
    // flooded (resolved ones don't count).
    const { count } = await supabase
      .from('ai_support_requests')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .in('status', ['pending', 'in_progress'])
    if ((count ?? 0) >= 5) {
      return bad(
        'You already have 5 open support requests — please wait for a response.',
      )
    }

    const { data, error } = await supabase
      .from('ai_support_requests')
      .insert({
        account_id: accountId,
        user_id: userId,
        topic,
        message,
        contact_info: contactInfo || null,
      })
      .select('id, topic, message, contact_info, status, created_at, updated_at')
      .single()

    if (error) {
      console.error('[ai/support-requests POST] insert error:', error)
      return NextResponse.json(
        { error: 'Failed to submit support request' },
        { status: 500 },
      )
    }
    return NextResponse.json({ request: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

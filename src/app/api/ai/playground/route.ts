import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider — so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 },
      )
    }

    // Optional bot to impersonate — lets the Playground test ANY bot,
    // not just the active one. Absent/null = active bot (or bot-less).
    const botId =
      typeof body?.botId === 'string' && body.botId.trim() ? body.botId.trim() : null

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
      botId,
    }).catch((err) => {
      console.error('[ai/playground] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    // Mirror the live auto-reply path: honor the bot's KB toggle and
    // persona directives so the Playground shows exactly what a real
    // customer would get from this bot.
    const knowledge = config.useKnowledgeBase
      ? await retrieveKnowledge(supabase, accountId, config, latestUserMessage(messages))
      : []
    // Mirror the live auto-reply path: on the FIRST bot reply of a
    // conversation the configured greeting is prepended (auto-reply
    // checks ai_reply_count === 0; here "no prior assistant turn in the
    // transcript" is the stateless equivalent). Decided before generation
    // so the model is told not to greet again on top of it.
    const isFirstReply = !messages.some((m) => m.role === 'assistant')
    const greeting = config.greetingMessage?.trim()
    const willGreet = Boolean(greeting) && isFirstReply

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      tone: config.tone,
      language: config.language,
      greetingSent: willGreet,
    })

    const { text, handoff } = await generateReply({ config, systemPrompt, messages })

    const reply = greeting && willGreet && !handoff ? `${greeting}\n\n${text}` : text

    return NextResponse.json({ reply, handoff })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}

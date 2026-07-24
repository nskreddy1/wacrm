import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/features/auth/lib/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/features/whatsapp/lib/encryption'
import { validateAiCredentials } from '@/features/assistant/lib/ai/validate'
import {
  AiError,
  AI_PROVIDERS,
  isAiProvider,
  type AiProvider,
} from '@/features/assistant/lib/ai/types'
import { createValidationProof } from '@/features/assistant/lib/ai/validation-proof'
import { OLLAMA_PLACEHOLDER_KEY } from '@/features/assistant/lib/ai/defaults'

/**
 * POST /api/ai/test  (admin+)
 *
 * "Test key" button: validate a candidate provider/model/key against
 * the provider WITHOUT saving. When `api_key` is omitted the stored
 * key is used, so an admin can re-test an existing config (e.g. after
 * changing the model). Returns `{ ok: true }` on success, 400 with the
 * provider's message on failure.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if (!isAiProvider(body.provider)) {
      return NextResponse.json(
        { error: `provider must be one of: ${AI_PROVIDERS.join(', ')}` },
        { status: 400 },
      )
    }
    const provider: AiProvider = body.provider
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 })
    }

    // Custom OpenAI-compatible endpoint needs its base URL to be
    // testable (https-only). Ollama's is optional — http allowed since
    // the daemon typically runs on localhost or a private network.
    let baseUrl: string | null = null
    if (provider === 'custom' || provider === 'ollama') {
      const rawBaseUrl =
        typeof body.base_url === 'string' ? body.base_url.trim().replace(/\/+$/, '') : ''
      if (!rawBaseUrl && provider === 'custom') {
        return NextResponse.json(
          { error: 'base_url is required for the custom provider' },
          { status: 400 },
        )
      }
      if (rawBaseUrl) {
        try {
          const proto = new URL(rawBaseUrl).protocol
          if (provider === 'custom' && proto !== 'https:') throw new Error()
          if (proto !== 'https:' && proto !== 'http:') throw new Error()
        } catch {
          return NextResponse.json(
            { error: 'base_url must be a valid URL' },
            { status: 400 },
          )
        }
        baseUrl = rawBaseUrl
      }
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    let apiKeyPlain = rawKey
    // Ollama ignores auth — test with the placeholder when no key given.
    if (!apiKeyPlain && provider === 'ollama') {
      apiKeyPlain = OLLAMA_PLACEHOLDER_KEY
    }
    if (!apiKeyPlain) {
      const { data: existing } = await supabase
        .from('ai_configs')
        .select('api_key')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!existing?.api_key) {
        return NextResponse.json(
          { error: 'Enter an API key to test.' },
          { status: 400 },
        )
      }
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return NextResponse.json(
          { error: 'Stored API key could not be decrypted — re-enter your key.' },
          { status: 400 },
        )
      }
    }

    try {
      await validateAiCredentials({
        provider,
        model,
        apiKey: apiKeyPlain,
        baseUrl,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        autoReplyLimitMode: 'per_conversation',
        autoReplyScheduleStart: null,
        autoReplyScheduleEnd: null,
        autoReplyTimezone: null,
        handoffAgentId: null,
        embeddingsApiKey: null,
        keySource: 'account',
      })
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: 400 },
        )
      }
      console.error('[ai/test] validation error:', err)
      return NextResponse.json(
        { error: 'Could not validate the API key.' },
        { status: 400 },
      )
    }

    return NextResponse.json({
      ok: true,
      validation_proof: createValidationProof({
        accountId,
        provider,
        model,
        apiKey: apiKeyPlain,
        baseUrl,
      }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  loadAgentConfig,
  isAgentCapability,
} from '@/features/assistant/lib/ai/agents';
import { routeConversation } from '@/features/assistant/lib/ai/router';
import { retrieveKnowledge } from '@/features/assistant/lib/ai/knowledge';
import { generateReply } from '@/features/assistant/lib/ai/generate';
import { buildPromptParts } from '@/features/assistant/lib/ai/defaults';
import { latestUserMessage } from '@/features/assistant/lib/ai/query';
import { AiError, type ChatMessage } from '@/features/assistant/lib/ai/types';

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20;

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
    const { supabase, accountId, userId } = await requireRole('agent');

    const limit = await checkRateLimit(
      `ai-playground:${userId}`,
      RATE_LIMITS.aiDraft
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null;
    if (!rawMessages) {
      return NextResponse.json(
        { error: 'messages is required' },
        { status: 400 }
      );
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0
      )
      .slice(-MAX_TURNS);

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 }
      );
    }

    // Which capability is being exercised — the playground can test
    // either surface of the single agent. Default: autoreply (the
    // customer-facing one).
    const capability = isAgentCapability(body?.capability)
      ? body.capability
      : 'autoreply';

    // requireEnabled:false — "test before enabling" is the whole point
    // of a playground; a saved key/model is still required.
    const config = await loadAgentConfig(supabase, accountId, capability, {
      requireEnabled: false,
    }).catch((err) => {
      console.error('[ai/playground] loadAgentConfig error:', err);
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      });
    });
    if (!config) {
      return NextResponse.json(
        {
          error:
            'This agent is not configured yet. Finish its setup (provider, API key, model) first.',
          code: 'ai_not_configured',
        },
        { status: 400 }
      );
    }

    // Router → specialist handoff, exactly as in production: when
    // custom specialists exist, the same cheap routing pass picks who
    // answers — so the playground tests the full agentic path, not
    // just the default persona. Suggestions mode skips routing (drafts
    // are always the default agent's job).
    const { config: activeConfig, specialist } =
      capability === 'autoreply'
        ? await routeConversation(supabase, accountId, config, messages)
        : { config, specialist: null };

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages)
    );
    // Mirror the live auto-reply path exactly, including its
    // cache-aligned prompt — the playground must exercise what
    // customers will hit. The transcript is stateless client-side, but
    // the resent prefix is byte-identical each turn, so provider
    // caching still lands (cache key: per-account playground scope,
    // there's no conversation).
    const { text, handoff } = await generateReply({
      config: activeConfig,
      messages,
      promptParts: buildPromptParts({
        userPrompt: activeConfig.systemPrompt,
        // Exercise the same prompt mode the capability uses in production.
        mode: capability === 'suggestions' ? 'draft' : 'auto_reply',
        knowledge,
      }),
      cacheKey: `playground:${accountId}:${capability}:${specialist?.id ?? 'default'}`,
    });
    return NextResponse.json({
      reply: text,
      handoff,
      // Which agent answered — lets the playground UI show the routing
      // decision ("Routed to: Billing Specialist").
      routedTo: specialist ? specialist.display_name : null,
    });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    return toErrorResponse(err);
  }
}

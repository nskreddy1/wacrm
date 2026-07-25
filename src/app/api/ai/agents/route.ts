import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/features/auth/lib/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt } from '@/features/whatsapp/lib/encryption';
import {
  AGENT_COLUMNS,
  fetchAgentRow,
  toClientAgent,
  type AgentRow,
} from '@/features/assistant/lib/ai/agents';
import { parseAgentPayload, validateAgentCredentials } from './shared';

/**
 * GET /api/ai/agents
 *
 * Return the account's single default agent (or null before first
 * setup). Any member may read — the inbox banner and draft button need
 * to know whether the agent is live. Keys are reduced to has-flags,
 * never returned.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const row = await fetchAgentRow(supabase, accountId).catch((error) => {
      console.error('[ai/agents GET] fetch error:', error);
      throw new Error('fetch_failed');
    });

    return NextResponse.json({
      agent: row ? toClientAgent(row) : null,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'fetch_failed') {
      return NextResponse.json(
        { error: 'Failed to load the agent' },
        { status: 500 }
      );
    }
    return toErrorResponse(err);
  }
}

/**
 * POST /api/ai/agents  (admin+)
 *
 * First-time setup of the account's single default agent (unique per
 * account — a second create 409s; use PATCH /api/ai/agents/[id] to
 * edit). The provider key is validated live before persisting
 * ("verify before save", same discipline as the WhatsApp config with
 * Meta) and stored AES-256-GCM-encrypted.
 *
 * Capabilities start how the wizard sends them (suggestions_enabled /
 * autoreply_enabled booleans) — each is its own column, independently
 * toggleable later.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = checkRateLimit(
      `ai-agents:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    // Full-payload parse: create requires provider+model (+key for
    // non-Ollama). Field errors come back as {error} 400s.
    const parsed = await parseAgentPayload(body, {
      partial: false,
      supabase,
      accountId,
    });
    if ('errorResponse' in parsed) return parsed.errorResponse;
    const { values, plainApiKey } = parsed;

    // Verify the key actually works before we store it — a typo'd key
    // discovered at 2am by a customer talking to a dead bot is the
    // failure mode this prevents.
    const validation = await validateAgentCredentials(values, plainApiKey);
    if (validation) return validation;

    const { data, error } = await supabase
      .from('ai_agents')
      .insert({
        account_id: accountId,
        created_by: userId,
        kind: 'default',
        display_name: values.display_name,
        provider: values.provider,
        model: values.model,
        api_key: plainApiKey ? encrypt(plainApiKey) : null,
        base_url: values.base_url,
        system_prompt: values.system_prompt,
        is_enabled: values.is_enabled ?? true,
        suggestions_enabled: values.suggestions_enabled ?? true,
        autoreply_enabled: values.autoreply_enabled ?? false,
        settings: values.settings ?? {},
      })
      .select(AGENT_COLUMNS)
      .single();

    if (error) {
      // 23505 = unique_violation on (account_id, kind).
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'This account already has an agent — edit it instead.' },
          { status: 409 }
        );
      }
      console.error('[ai/agents POST] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create agent' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { agent: toClientAgent(data as AgentRow) },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

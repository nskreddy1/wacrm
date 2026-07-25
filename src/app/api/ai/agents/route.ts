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
  isAgentKind,
  toClientAgent,
  type AgentRow,
} from '@/features/assistant/lib/ai/agents';
import { parseAgentPayload, validateAgentCredentials } from './shared';

/**
 * GET /api/ai/agents
 *
 * List the account's agents (0–2 rows: copilot / autoreply). Any member
 * may read — the inbox banner and draft button need to know whether an
 * agent is live. Keys are reduced to has-flags, never returned.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('ai_agents')
      .select(AGENT_COLUMNS)
      .eq('account_id', accountId)
      .order('kind');

    if (error) {
      console.error('[ai/agents GET] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load agents' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      agents: (data as AgentRow[]).map(toClientAgent),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/ai/agents  (admin+)
 *
 * Create ONE agent of a given kind (unique per account+kind — a second
 * create of the same kind 409s; use PATCH /api/ai/agents/[id] to edit).
 * The provider key is validated live before persisting ("verify before
 * save", same discipline as the WhatsApp config with Meta) and stored
 * AES-256-GCM-encrypted.
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

    if (!isAgentKind(body.kind)) {
      return NextResponse.json(
        { error: "kind must be 'copilot' or 'autoreply'" },
        { status: 400 }
      );
    }

    // Full-payload parse: create requires provider+model (+key for
    // non-Ollama). Field errors come back as {error} 400s.
    const parsed = await parseAgentPayload(body, {
      kind: body.kind,
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
        kind: body.kind,
        display_name: values.display_name,
        provider: values.provider,
        model: values.model,
        api_key: plainApiKey ? encrypt(plainApiKey) : null,
        base_url: values.base_url,
        system_prompt: values.system_prompt,
        is_enabled: values.is_enabled ?? false,
        settings: values.settings ?? {},
      })
      .select(AGENT_COLUMNS)
      .single();

    if (error) {
      // 23505 = unique_violation on (account_id, kind).
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'An agent of this kind already exists — edit it instead.' },
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

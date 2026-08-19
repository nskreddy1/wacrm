import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { logAuditEvent } from '@/lib/audit-events';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt } from '@/lib/crypto/secrets';
import {
  AGENT_COLUMNS,
  fetchAllAgentRows,
  toClientAgent,
  type AgentRow,
} from '@/features/assistant/lib/ai/agents';
import { parseAgentPayload, validateAgentCredentials } from './shared';

/**
 * GET /api/ai/agents
 *
 * Return the account's agents: `agent` is the single default agent
 * (or null before first setup — kept as-is so existing consumers like
 * the inbox banner and playground don't break), and `specialists` is
 * the list of custom specialist agents the router can hand off to.
 * Any member may read. Keys are reduced to has-flags, never returned.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const rows = await fetchAllAgentRows(supabase, accountId).catch(
      (error) => {
        console.error('[ai/agents GET] fetch error:', error);
        throw new Error('fetch_failed');
      }
    );

    const defaultRow = rows.find((r) => r.kind === 'default') ?? null;
    const specialists = rows.filter((r) => r.kind === 'custom');

    return NextResponse.json({
      agent: defaultRow ? toClientAgent(defaultRow) : null,
      specialists: specialists.map(toClientAgent),
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
 * Creates either:
 *  - the account's single DEFAULT agent (first-time setup; unique per
 *    account — a second create 409s), or
 *  - a CUSTOM specialist agent (`kind: 'custom'` in the body) that the
 *    router can hand conversations to. Specialists need a
 *    `route_description` ("billing questions, refunds, invoices") and
 *    may omit provider credentials entirely — they then run on the
 *    default agent's connection with their own persona.
 *
 * Any provided provider key is validated live before persisting
 * ("verify before save") and stored AES-256-GCM-encrypted.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = await checkRateLimit(
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

    const isSpecialist = (body as Record<string, unknown>).kind === 'custom';

    // Specialists may ride the default agent's provider, so their
    // payload parses as partial (persona + routing only is valid).
    // The default agent must be complete: provider+model (+key for
    // non-Ollama). Field errors come back as {error} 400s.
    const parsed = await parseAgentPayload(body as Record<string, unknown>, {
      partial: isSpecialist,
      supabase,
      accountId,
    });
    if ('errorResponse' in parsed) return parsed.errorResponse;
    const { values, plainApiKey } = parsed;

    // Specialist-only field: when the router should pick this agent.
    const routeDescription =
      typeof (body as Record<string, unknown>).route_description === 'string'
        ? ((body as Record<string, unknown>).route_description as string)
            .trim()
            .slice(0, 500)
        : '';
    if (isSpecialist && !routeDescription) {
      return NextResponse.json(
        {
          error:
            'Describe when this specialist should take over (e.g. "billing questions, refunds, invoices").',
        },
        { status: 400 }
      );
    }
    if (isSpecialist && !values.display_name?.trim()) {
      return NextResponse.json(
        { error: 'Give the specialist a name.' },
        { status: 400 }
      );
    }

    // Verify any provided key actually works before we store it — a
    // typo'd key discovered at 2am by a customer talking to a dead bot
    // is the failure mode this prevents. Specialists without their own
    // provider skip this (they use the default agent's connection).
    if (!isSpecialist || values.provider) {
      const validation = await validateAgentCredentials(values, plainApiKey);
      if (validation) return validation;
    }

    const { data, error } = await supabase
      .from('ai_agents')
      .insert({
        account_id: accountId,
        created_by: userId,
        kind: isSpecialist ? 'custom' : 'default',
        display_name: values.display_name,
        provider: values.provider ?? null,
        model: values.model ?? null,
        api_key: plainApiKey ? encrypt(plainApiKey) : null,
        base_url: values.base_url,
        system_prompt: values.system_prompt,
        route_description: isSpecialist ? routeDescription : null,
        is_enabled: values.is_enabled ?? true,
        // Capability columns only govern the default agent's surfaces;
        // specialists are reached exclusively through the router.
        suggestions_enabled: isSpecialist
          ? false
          : (values.suggestions_enabled ?? true),
        autoreply_enabled: isSpecialist
          ? false
          : (values.autoreply_enabled ?? false),
        settings: values.settings ?? {},
      })
      .select(AGENT_COLUMNS)
      .single();

    if (error) {
      // 23505 = unique_violation on the partial default-agent index.
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

    const created = data as AgentRow;
    await logAuditEvent(supabase, {
      accountId,
      actorId: userId,
      action: 'agent.created',
      entity: `ai_agent:${created.id}`,
      meta: { name: created.display_name, kind: created.kind },
    });

    return NextResponse.json(
      { agent: toClientAgent(created) },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

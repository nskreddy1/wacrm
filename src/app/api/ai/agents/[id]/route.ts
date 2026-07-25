import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/features/whatsapp/lib/encryption';
import {
  AGENT_COLUMNS,
  toClientAgent,
  type AgentRow,
} from '@/features/assistant/lib/ai/agents';
import { parseAgentPayload, validateAgentCredentials } from '../shared';

function notFound() {
  return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
}

/**
 * PATCH /api/ai/agents/[id]  (admin+)
 *
 * Partial update of one agent. Only fields present in the body are
 * touched — a toggle flip sends `{is_enabled}` alone and never
 * re-demands the API key. Credentials are re-verified with the
 * provider only when something affecting reachability changed
 * (key / provider / model / base URL).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    // Scope by account_id as well as id — belt on top of the RLS
    // braces, and the source of the existing values we merge into.
    const { data: existing, error: findErr } = await supabase
      .from('ai_agents')
      .select(AGENT_COLUMNS)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (findErr) {
      console.error('[ai/agents PATCH] fetch error:', findErr);
      return NextResponse.json(
        { error: 'Failed to load agent' },
        { status: 500 }
      );
    }
    if (!existing) return notFound();
    const row = existing as AgentRow;

    const parsed = await parseAgentPayload(body, {
      partial: true,
      supabase,
      accountId,
    });
    if ('errorResponse' in parsed) return parsed.errorResponse;
    const { values, plainApiKey, provided } = parsed;

    // ---- merge: only provided fields override the stored row ------
    const patch: Record<string, unknown> = {};
    if (provided.has('display_name') && values.display_name) {
      patch.display_name = values.display_name;
    }
    if (provided.has('provider')) patch.provider = values.provider;
    if (provided.has('model')) patch.model = values.model;
    if (provided.has('base_url') || provided.has('provider')) {
      patch.base_url = values.base_url;
    }
    if (provided.has('system_prompt')) {
      patch.system_prompt = values.system_prompt;
    }
    // Specialist-only routing hint — ignored for the default agent.
    if (provided.has('route_description') && row.kind === 'custom') {
      const rawRoute =
        typeof (body as Record<string, unknown>).route_description === 'string'
          ? ((body as Record<string, unknown>).route_description as string)
              .trim()
              .slice(0, 500)
          : '';
      if (!rawRoute) {
        return NextResponse.json(
          { error: 'Describe when this specialist should take over.' },
          { status: 400 }
        );
      }
      patch.route_description = rawRoute;
    }
    if (typeof values.is_enabled === 'boolean') {
      patch.is_enabled = values.is_enabled;
    }
    // The two capabilities are independent first-class columns — each
    // toggle patches only its own flag.
    if (typeof values.suggestions_enabled === 'boolean') {
      patch.suggestions_enabled = values.suggestions_enabled;
    }
    if (typeof values.autoreply_enabled === 'boolean') {
      patch.autoreply_enabled = values.autoreply_enabled;
    }
    if (values.settings && Object.keys(values.settings).length > 0) {
      // Shallow-merge jsonb: untouched settings keys survive.
      patch.settings = { ...(row.settings ?? {}), ...values.settings };
    }
    if (plainApiKey) patch.api_key = encrypt(plainApiKey);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: 'Nothing to update' },
        { status: 400 }
      );
    }

    // ---- re-verify credentials only when reachability changed ------
    const effProvider = (patch.provider ?? row.provider) as string | null;
    const effModel = (patch.model ?? row.model) as string | null;
    const effBaseUrl = (
      'base_url' in patch ? patch.base_url : row.base_url
    ) as string | null;
    const credentialsChanged =
      Boolean(plainApiKey) ||
      effProvider !== row.provider ||
      effModel !== row.model ||
      effBaseUrl !== (row.base_url ?? null);

    // Enabling a half-configured agent is refused with a clear message
    // instead of letting the runtime silently no-op later.
    const turningSomethingOn =
      patch.is_enabled === true ||
      patch.suggestions_enabled === true ||
      patch.autoreply_enabled === true;
    if (
      turningSomethingOn &&
      (!effProvider || !effModel || (!row.api_key && !plainApiKey && effProvider !== 'ollama'))
    ) {
      return NextResponse.json(
        { error: 'Finish setup (provider, model, API key) before enabling.' },
        { status: 400 }
      );
    }

    if (credentialsChanged && effProvider && effModel) {
      let keyForValidation = plainApiKey;
      if (!keyForValidation && row.api_key) {
        try {
          keyForValidation = decrypt(row.api_key);
        } catch {
          return NextResponse.json(
            { error: 'Stored API key could not be decrypted — re-enter your key.' },
            { status: 400 }
          );
        }
      }
      const validation = await validateAgentCredentials(
        {
          ...values,
          provider: effProvider as typeof values.provider,
          model: effModel,
          base_url: effBaseUrl,
        },
        keyForValidation
      );
      if (validation) return validation;
    }

    const { data, error } = await supabase
      .from('ai_agents')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(AGENT_COLUMNS)
      .single();

    if (error) {
      console.error('[ai/agents PATCH] update error:', error);
      return NextResponse.json(
        { error: 'Failed to update agent' },
        { status: 500 }
      );
    }

    return NextResponse.json({ agent: toClientAgent(data as AgentRow) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/ai/agents/[id]  (admin+)
 *
 * Removes the agent (turns it off and forgets its key). Usage history
 * survives — `ai_usage_log.agent_id` is ON DELETE SET NULL.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');

    const { data, error } = await supabase
      .from('ai_agents')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id');

    if (error) {
      console.error('[ai/agents DELETE] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete agent' },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) return notFound();
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

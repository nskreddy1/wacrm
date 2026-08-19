// ============================================================
// GET /api/ai/models?provider=…[&base_url=…]  (admin+)
//
// Which models the account's own key may call, so the agent form can
// offer a real list instead of asking an operator to recall
// `meta-llama/Llama-3.3-70B-Instruct-Turbo` from memory.
//
// Uses the key ALREADY STORED on the account's default agent — no key
// is ever accepted in a query string (it would land in access logs).
// The consequence, deliberately: a provider the account has not saved
// a key for yet answers `needsKey: true` and the form falls back to
// free text, which is also the first-run path.
//
// Never 500s on a provider problem: a failed listing returns 200 with
// `error` set so the picker degrades to a text field rather than
// blocking the save of a perfectly valid model id.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { decrypt } from '@/lib/crypto/secrets';
import { fetchAgentRow } from '@/features/assistant/lib/ai/agents';
import { listProviderModels } from '@/features/assistant/lib/ai/model-catalog';
import { AiError, isAiProvider } from '@/features/assistant/lib/ai/types';

export async function GET(request: Request) {
  try {
    // admin+: the response enumerates the provider inventory the
    // account's key unlocks, which is configuration, not inbox data.
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = await checkRateLimit(
      `ai-models:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const url = new URL(request.url);
    const provider = url.searchParams.get('provider');
    if (!isAiProvider(provider)) {
      return NextResponse.json(
        { error: 'A known provider is required' },
        { status: 400 }
      );
    }

    const row = await fetchAgentRow(supabase, accountId).catch(() => null);

    // The stored key only applies to the provider it was saved for.
    // Switching the picker to a provider with no key yet is a normal
    // state, not an error — the form stays on free text.
    let apiKey = '';
    if (row?.api_key && row.provider === provider) {
      try {
        apiKey = decrypt(row.api_key);
      } catch {
        return NextResponse.json({
          models: [],
          needsKey: true,
          error: 'The stored API key could not be decrypted — re-enter it.',
        });
      }
    }
    if (!apiKey && provider !== 'ollama') {
      return NextResponse.json({ models: [], needsKey: true });
    }

    // Base URL is only meaningful for custom/ollama endpoints; take the
    // in-progress form value so the picker works before the first save.
    const baseUrl =
      provider === 'custom' || provider === 'ollama'
        ? (url.searchParams.get('base_url') ?? row?.base_url ?? null)
        : null;

    try {
      const models = await listProviderModels({ provider, apiKey, baseUrl });
      return NextResponse.json({ models, needsKey: false });
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({
          models: [],
          needsKey: err.code === 'missing_key',
          error: err.message,
          code: err.code,
        });
      }
      console.error('[ai/models] listing error:', err);
      return NextResponse.json({
        models: [],
        needsKey: false,
        error: 'Could not load the model list.',
      });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

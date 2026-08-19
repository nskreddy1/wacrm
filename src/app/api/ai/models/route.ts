// ============================================================
// GET  /api/ai/models?provider=…[&base_url=…]          (admin+)
// POST /api/ai/models  { provider, api_key?, base_url? } (admin+)
//
// Which models the account's own key may call, so the agent form can
// offer a real list instead of asking an operator to recall
// `meta-llama/Llama-3.3-70B-Instruct-Turbo` from memory.
//
// GET uses the key ALREADY STORED on the account's default agent, and
// a provider the account has not saved a key for yet answers
// `needsKey: true`. That is also the first-run path, which is why POST
// exists (ADR-005 D2): the in-progress key travels in the JSON BODY —
// never a query string, which would land it in access logs. The key is
// not persisted, not logged and not echoed.
//
// Both verbs share `handleListModels` so the auth guard and the
// response contract cannot drift between them (ADR-005 F2). Both spend
// the SAME rate-limit key, so the two verbs share one budget.
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
import { handleListModels } from '@/features/assistant/lib/ai/list-models';
import { isAiProvider } from '@/features/assistant/lib/ai/types';

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

    return await handleListModels({
      db: supabase,
      accountId,
      provider,
      baseUrl: url.searchParams.get('base_url'),
      // No key is ever accepted from a URL.
      bodyApiKey: undefined,
      logLabel: 'ai/models',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    // Same guard and the same rate-limit key as GET — one budget for
    // both verbs (ADR-005 F2/F3).
    const { supabase, accountId, userId } = await requireRole('admin');

    const limit = await checkRateLimit(
      `ai-models:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      provider?: unknown;
      api_key?: unknown;
      base_url?: unknown;
    } | null;

    const provider = typeof body?.provider === 'string' ? body.provider : null;
    if (!isAiProvider(provider)) {
      return NextResponse.json(
        { error: 'A known provider is required' },
        { status: 400 }
      );
    }

    return await handleListModels({
      db: supabase,
      accountId,
      provider,
      baseUrl: typeof body?.base_url === 'string' ? body.base_url : null,
      bodyApiKey: typeof body?.api_key === 'string' ? body.api_key : null,
      logLabel: 'ai/models',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ============================================================
// GET /api/admin/ai-models?provider=…&account_id=…[&base_url=…]
//
// Super-admin twin of /api/ai/models: the same live provider catalogue,
// but reading the TARGET workspace's stored key so the platform console
// can pick a model on a customer's behalf.
//
// Same contract as the tenant route — never 500s on a provider
// problem, answers `needsKey` when the workspace has no key for the
// selected provider yet — so both forms share one client component.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/features/auth/lib/account';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { platformAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto/secrets';
import { fetchAgentRow } from '@/features/assistant/lib/ai/agents';
import { listProviderModels } from '@/features/assistant/lib/ai/model-catalog';
import { AiError, isAiProvider } from '@/features/assistant/lib/ai/types';

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const url = new URL(request.url);
    const provider = url.searchParams.get('provider');
    const accountId = url.searchParams.get('account_id');
    if (!isAiProvider(provider)) {
      return NextResponse.json(
        { error: 'A known provider is required' },
        { status: 400 }
      );
    }
    if (!accountId) {
      return NextResponse.json(
        { error: 'account_id is required' },
        { status: 400 }
      );
    }

    const row = await fetchAgentRow(admin, accountId).catch(() => null);

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
      console.error('[admin/ai-models] listing error:', err);
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

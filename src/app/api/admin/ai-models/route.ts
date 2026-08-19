// ============================================================
// GET  /api/admin/ai-models?provider=…&account_id=…[&base_url=…]
// POST /api/admin/ai-models  { provider, account_id, api_key?, base_url? }
//
// Super-admin twin of /api/ai/models: the same live provider catalogue,
// but reading the TARGET workspace's stored key so the platform console
// can pick a model on a customer's behalf.
//
// Same contract as the tenant route — never 500s on a provider
// problem, answers `needsKey` when the workspace has no key for the
// selected provider yet — so both forms share one client component.
//
// POST accepts an in-progress key in the JSON BODY (ADR-005 D2/D5) so
// the console can list models for a provider the workspace has not
// saved a key for yet. `account_id` stays REQUIRED on both verbs
// (ADR-005 F2): the target workspace is never inferred.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/features/auth/lib/account';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { platformAdmin } from '@/lib/supabase/admin';
import { handleListModels } from '@/features/assistant/lib/ai/list-models';
import { isAiProvider } from '@/features/assistant/lib/ai/types';

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

    return await handleListModels({
      db: admin,
      accountId,
      provider,
      baseUrl: url.searchParams.get('base_url'),
      // No key is ever accepted from a URL.
      bodyApiKey: undefined,
      logLabel: 'admin/ai-models',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const body = (await request.json().catch(() => null)) as {
      provider?: unknown;
      account_id?: unknown;
      api_key?: unknown;
      base_url?: unknown;
    } | null;

    const provider = typeof body?.provider === 'string' ? body.provider : null;
    const accountId =
      typeof body?.account_id === 'string' && body.account_id
        ? body.account_id
        : null;
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

    return await handleListModels({
      db: admin,
      accountId,
      provider,
      baseUrl: typeof body?.base_url === 'string' ? body.base_url : null,
      bodyApiKey: typeof body?.api_key === 'string' ? body.api_key : null,
      logLabel: 'admin/ai-models',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

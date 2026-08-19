// ============================================================
// GET / POST /api/admin/ai-models — ADR-005 D5 / F1 / F2.
//
// The super-admin twin lists on a customer's behalf, so the two things
// that must never slip are pinned here: `requireSuperAdmin()` guards
// BOTH verbs, and `account_id` is required on both (the target
// workspace is never inferred from the caller).
// ============================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const SECRET_KEY = 'sk-live-ADMIN-CONSOLE-KEY-4242';

let isSuperAdmin = true;
let storedRow: {
  provider: string | null;
  api_key: string | null;
  base_url: string | null;
} | null = null;
let seenKeys: string[] = [];
let seenAccountIds: string[] = [];

vi.mock('@/features/auth/lib/super-admin', () => ({
  requireSuperAdmin: async () => {
    if (!isSuperAdmin) throw new Error('Super admin access required');
    return { userId: 'super-1', supabase: {} as never };
  },
}));

vi.mock('@/features/auth/lib/account', () => ({
  toErrorResponse: (err: unknown) =>
    NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 403 }
    ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  platformAdmin: () => ({}) as never,
}));

vi.mock('@/features/assistant/lib/ai/agents', () => ({
  fetchAgentRow: async (_db: unknown, accountId: string) => {
    seenAccountIds.push(accountId);
    return storedRow;
  },
}));

vi.mock('@/lib/crypto/secrets', () => ({
  decrypt: (value: string) => `decrypted:${value}`,
}));

vi.mock('@/features/assistant/lib/ai/model-catalog', () => ({
  listProviderModels: async ({ apiKey }: { apiKey: string }) => {
    seenKeys.push(apiKey);
    return [{ id: 'claude-sonnet-4', label: 'Claude Sonnet 4', reasoning: true }];
  },
}));

function post(body: unknown): Request {
  return new Request('http://localhost/api/admin/ai-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/admin/ai-models', () => {
  beforeEach(() => {
    isSuperAdmin = true;
    storedRow = null;
    seenKeys = [];
    seenAccountIds = [];
  });

  it('POST lists the target workspace with a draft key and no stored row', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      post({ provider: 'anthropic', account_id: 'acc-9', api_key: SECRET_KEY })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toHaveLength(1);
    expect(seenAccountIds).toEqual(['acc-9']);
    expect(seenKeys).toEqual([SECRET_KEY]);
    expect(JSON.stringify(body)).not.toContain(SECRET_KEY);
  });

  it('POST requires account_id — the target workspace is never inferred', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ provider: 'anthropic', api_key: SECRET_KEY }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/account_id/);
    expect(seenKeys).toEqual([]);
  });

  it('rejects both verbs without super-admin (F2)', async () => {
    isSuperAdmin = false;
    const { GET, POST } = await import('./route');

    const getRes = await GET(
      new Request(
        'http://localhost/api/admin/ai-models?provider=anthropic&account_id=acc-9'
      )
    );
    const postRes = await POST(
      post({ provider: 'anthropic', account_id: 'acc-9', api_key: SECRET_KEY })
    );

    expect(getRes.status).toBe(403);
    expect(postRes.status).toBe(403);
    expect(seenKeys).toEqual([]);
  });

  it('POST with an empty api_key falls back to the stored key, exactly as GET', async () => {
    storedRow = { provider: 'anthropic', api_key: 'cipher', base_url: null };
    const { GET, POST } = await import('./route');

    const postRes = await POST(
      post({ provider: 'anthropic', account_id: 'acc-9', api_key: '' })
    );
    const getRes = await GET(
      new Request(
        'http://localhost/api/admin/ai-models?provider=anthropic&account_id=acc-9'
      )
    );

    expect(seenKeys).toEqual(['decrypted:cipher', 'decrypted:cipher']);
    expect(await postRes.json()).toEqual(await getRes.json());
  });
});

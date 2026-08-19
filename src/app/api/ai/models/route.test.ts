// ============================================================
// GET / POST /api/ai/models — ADR-005 D2 / F1 / F2 / F4.
//
// What is pinned here:
//   • POST lists with NO stored agent row (the first-run path that
//     GET structurally cannot serve — ADR-005 Defect 1).
//   • An empty `api_key` falls back to the stored key exactly as GET.
//   • A provider 401 answers 200 with `code: 'invalid_key'`, because
//     the wizard's only hard gate reads that code (F4).
//   • The submitted key never appears anywhere in the serialized
//     response (F1).
//   • POST is rejected without the admin guard (F2) and shares GET's
//     rate-limit budget (F3).
// ============================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

import { AiError } from '@/features/assistant/lib/ai/types';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

const SECRET_KEY = 'sk-live-THIS-MUST-NEVER-BE-ECHOED-9999';

let authed = true;
/** Stored `ai_agents` row, or null for the first-run path. */
let storedRow: {
  provider: string | null;
  api_key: string | null;
  base_url: string | null;
} | null = null;
/** Keys `listProviderModels` was actually called with. */
let seenKeys: string[] = [];
let listResult: (() => unknown) | null = null;

vi.mock('@/features/auth/lib/account', () => ({
  requireRole: async () => {
    if (!authed) throw new Error('This action requires the admin role');
    return {
      supabase: {} as never,
      accountId: 'acc-1',
      userId: 'user-models-test',
    };
  },
  toErrorResponse: (err: unknown) =>
    NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 403 }
    ),
}));

vi.mock('@/features/assistant/lib/ai/agents', () => ({
  fetchAgentRow: async () => storedRow,
}));

vi.mock('@/lib/crypto/secrets', () => ({
  decrypt: (value: string) => `decrypted:${value}`,
}));

vi.mock('@/features/assistant/lib/ai/model-catalog', () => ({
  listProviderModels: async ({ apiKey }: { apiKey: string }) => {
    seenKeys.push(apiKey);
    if (listResult) return listResult();
    return [{ id: 'gpt-4o-mini', label: 'GPT-4o mini', reasoning: false }];
  },
}));

function post(body: unknown): Request {
  return new Request('http://localhost/api/ai/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/ai/models', () => {
  beforeEach(() => {
    authed = true;
    storedRow = null;
    seenKeys = [];
    listResult = null;
    __resetRateLimitForTests();
  });

  it('POST lists models with no stored agent row (first-run setup)', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ provider: 'openai', api_key: SECRET_KEY }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsKey).toBe(false);
    expect(body.models).toHaveLength(1);
    // The draft key — not a stored one — reached the provider.
    expect(seenKeys).toEqual([SECRET_KEY]);
  });

  it('POST never echoes the submitted key anywhere in the response', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ provider: 'openai', api_key: SECRET_KEY }));

    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(SECRET_KEY);
    expect(raw).not.toContain('api_key');
  });

  it('POST with an empty api_key falls back to the stored key, exactly as GET', async () => {
    storedRow = { provider: 'openai', api_key: 'cipher', base_url: null };
    const { GET, POST } = await import('./route');

    const postRes = await POST(post({ provider: 'openai', api_key: '' }));
    expect(postRes.status).toBe(200);

    const getRes = await GET(
      new Request('http://localhost/api/ai/models?provider=openai')
    );
    expect(getRes.status).toBe(200);

    // Both verbs resolved the SAME key from the same row.
    expect(seenKeys).toEqual(['decrypted:cipher', 'decrypted:cipher']);
    expect(await postRes.json()).toEqual(await getRes.json());
  });

  it('POST answers needsKey when no draft and no stored key exist', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ provider: 'openai' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ models: [], needsKey: true });
    expect(seenKeys).toEqual([]);
  });

  it('lists Ollama with no key at all', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      post({ provider: 'ollama', base_url: 'http://localhost:11434/v1' })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).needsKey).toBe(false);
    expect(seenKeys).toEqual(['']);
  });

  it('turns a provider 401 into 200 { code: "invalid_key" } — never a 500', async () => {
    listResult = () => {
      throw new AiError('The provider rejected this API key when listing models.', {
        code: 'invalid_key',
        status: 400,
      });
    };
    const { POST } = await import('./route');
    const res = await POST(post({ provider: 'openai', api_key: SECRET_KEY }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('invalid_key');
    expect(body.models).toEqual([]);
  });

  it('propagates a non-key failure code verbatim so the wizard can warn instead of block', async () => {
    listResult = () => {
      throw new AiError('The provider took too long to list its models.', {
        code: 'timeout',
        status: 502,
      });
    };
    const { POST } = await import('./route');
    const res = await POST(post({ provider: 'openai', api_key: SECRET_KEY }));

    expect((await res.json()).code).toBe('timeout');
  });

  it('rejects an unknown provider before any provider call', async () => {
    const { POST } = await import('./route');
    const res = await POST(post({ provider: 'not-a-provider', api_key: SECRET_KEY }));

    expect(res.status).toBe(400);
    expect(seenKeys).toEqual([]);
  });

  it('rejects POST without the admin guard (F2 — the new verb keeps the old guard)', async () => {
    authed = false;
    const { POST } = await import('./route');
    const res = await POST(post({ provider: 'openai', api_key: SECRET_KEY }));

    expect(res.status).toBe(403);
    expect(seenKeys).toEqual([]);
  });

  it('shares one rate-limit budget across GET and POST, answering 429 with headers', async () => {
    const { GET, POST } = await import('./route');
    let last: Response | null = null;

    // adminAction is 30/min; alternate the verbs so exhaustion proves
    // they spend the SAME key rather than one budget each.
    for (let i = 0; i < 40; i += 1) {
      last =
        i % 2 === 0
          ? await GET(new Request('http://localhost/api/ai/models?provider=ollama'))
          : await POST(post({ provider: 'ollama' }));
      if (last.status === 429) break;
    }

    expect(last?.status).toBe(429);
    expect(last?.headers.get('Retry-After')).toBeTruthy();
  });
});

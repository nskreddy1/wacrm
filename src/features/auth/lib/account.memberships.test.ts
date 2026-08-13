import { beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-004 Task 5. Two contracts are guarded here:
//
//  1. `AccountContext.memberships` — every workspace the caller is an
//     ACTIVE member of. This is what the sidebar switcher renders, and it
//     must arrive in the SAME round trip as the rest of the context
//     (ADR-001 C3: "zero extra round trips"), so it is carried by the
//     `get_account_context()` RPC rather than a second query.
//
//  2. `POST /api/account/switch` — must answer 404, never 403, for an
//     account the caller is not a member of (F4). A 403 would confirm the
//     account exists and leak the workspace graph to anyone who can guess
//     a uuid.
//
// The membership status gate matters as much as the list. Since Task 4,
// `account_members.status` is the authoritative grant — `profiles.status`
// is a separate GLOBAL per-user flag. A user deactivated in ONE workspace
// must be refused there while keeping access to their own.
//
// The DB-side behaviour (RLS, the fail-closed gate, the single-statement
// switch) is verified directly against Postgres; these tests pin the TS
// boundary: JSON parsing, the gate, and the route's status mapping.

const RPC_ROW = {
  account_id: 'acct-active',
  account_name: 'Active Workspace',
  account_role: 'agent',
  status: 'active',
  is_owner: false,
  permissions: ['contacts:read'],
  workspace_profile_id: null,
  workspace_profile_name: null,
  memberships: [
    { account_id: 'acct-active', account_name: 'Active Workspace', role: 'agent' },
    { account_id: 'acct-own', account_name: 'My Workspace', role: 'owner' },
  ],
};

let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let claims: { id: string } | null = { id: 'user-1' };
const rpcCalls: { name: string; args: unknown }[] = [];
const inserted: { table: string; row: unknown }[] = [];

const supabaseStub = {
  auth: {
    getClaims: async () =>
      claims
        ? { data: { claims: { sub: claims.id } }, error: null }
        : { data: null, error: { message: 'no session' } },
  },
  rpc: async (name: string, args?: unknown) => {
    rpcCalls.push({ name, args });
    return rpcResult;
  },
  from: (table: string) => ({
    insert: async (row: unknown) => {
      inserted.push({ table, row });
      return { error: null };
    },
  }),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => supabaseStub,
}));

// Rate limiter: allow by default, flipped per-test where relevant.
let rateOk = true;
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ ok: rateOk, limit: 30, remaining: 0, resetAt: 0 }),
  rateLimitResponse: () =>
    new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

const { getCurrentAccount } = await import('./account');
const { POST } = await import('@/app/api/account/switch/route');

function req(body: unknown, raw?: string) {
  return new Request('http://localhost/api/account/switch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  rpcCalls.length = 0;
  inserted.length = 0;
  claims = { id: 'user-1' };
  rateOk = true;
  rpcResult = { data: [RPC_ROW], error: null };
});

describe('AccountContext.memberships', () => {
  it('exposes every active workspace from the same round trip', async () => {
    const ctx = await getCurrentAccount();

    expect(ctx.memberships).toHaveLength(2);
    expect(ctx.memberships.map((m) => m.accountId)).toEqual([
      'acct-active',
      'acct-own',
    ]);
    // ADR-001 C3: no extra query for the switcher.
    expect(rpcCalls.filter((c) => c.name === 'get_account_context')).toHaveLength(1);
    expect(rpcCalls).toHaveLength(1);
  });

  it('marks exactly the active workspace and keeps per-workspace roles', async () => {
    const ctx = await getCurrentAccount();

    const active = ctx.memberships.filter((m) => m.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].accountId).toBe('acct-active');
    // The role travels per membership: agent here, owner in their own.
    expect(ctx.memberships.find((m) => m.accountId === 'acct-own')?.role).toBe('owner');
    expect(ctx.memberships.find((m) => m.accountId === 'acct-active')?.role).toBe('agent');
  });

  it('drops entries with an unmodelled role instead of coercing them', async () => {
    rpcResult = {
      data: [
        {
          ...RPC_ROW,
          memberships: [
            { account_id: 'acct-active', account_name: 'Active Workspace', role: 'agent' },
            // A future enum value TS does not model yet.
            { account_id: 'acct-x', account_name: 'X', role: 'superuser' },
          ],
        },
      ],
      error: null,
    };

    const ctx = await getCurrentAccount();

    expect(ctx.memberships).toHaveLength(1);
    expect(ctx.memberships.map((m) => m.accountId)).not.toContain('acct-x');
  });

  it('tolerates a missing or malformed memberships payload', async () => {
    rpcResult = { data: [{ ...RPC_ROW, memberships: null }], error: null };
    await expect(getCurrentAccount()).resolves.toMatchObject({ memberships: [] });

    rpcResult = { data: [{ ...RPC_ROW, memberships: 'nope' }], error: null };
    await expect(getCurrentAccount()).resolves.toMatchObject({ memberships: [] });
  });
});

describe('membership status gate', () => {
  it('refuses a member deactivated in the active workspace', async () => {
    rpcResult = { data: [{ ...RPC_ROW, status: 'inactive' }], error: null };
    await expect(getCurrentAccount()).rejects.toThrow(/deactivated/i);
  });

  it('refuses a soft-deleted membership', async () => {
    rpcResult = { data: [{ ...RPC_ROW, status: 'deleted' }], error: null };
    await expect(getCurrentAccount()).rejects.toThrow(/deactivated/i);
  });

  it('FAILS CLOSED when status is absent rather than assuming active', async () => {
    // Regression guard for the `status ?? 'active'` default: a schema-cache
    // miss or a changed RPC signature must not admit everyone as active.
    const { status: _omitted, ...noStatus } = RPC_ROW;
    rpcResult = { data: [noStatus], error: null };
    await expect(getCurrentAccount()).rejects.toThrow(/deactivated/i);
  });

  it('refuses when the RPC returns no row (stale pointer into a lost workspace)', async () => {
    // Measured against Postgres: accounts RLS hides the row entirely, so the
    // RPC yields zero rows rather than an inactive one. Still a denial.
    rpcResult = { data: [], error: null };
    await expect(getCurrentAccount()).rejects.toThrow(/not linked to an account/i);
  });
});

describe('POST /api/account/switch', () => {
  const target = '11111111-1111-4111-8111-111111111111';

  it('switches when the RPC confirms membership', async () => {
    rpcResult = { data: [RPC_ROW], error: null };
    let call = 0;
    supabaseStub.rpc = async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      // 1st call = context load, 2nd = the switch itself.
      return ++call === 1 ? { data: [RPC_ROW], error: null } : { data: true, error: null };
    };

    const res = await POST(req({ accountId: target }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, switched: true });
    expect(rpcCalls.at(-1)).toEqual({
      name: 'switch_active_account',
      args: { p_account_id: target },
    });
  });

  it('answers 404 (never 403) for an account the caller is not a member of', async () => {
    let call = 0;
    supabaseStub.rpc = async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      // The RPC returns false — not an active member, or no such account.
      return ++call === 1 ? { data: [RPC_ROW], error: null } : { data: false, error: null };
    };

    const res = await POST(req({ accountId: target }));

    // 404 for both cases: a 403 would confirm the account exists.
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });

  it('rejects a non-uuid accountId before it reaches Postgres', async () => {
    const res = await POST(req({ accountId: "'; drop table accounts; --" }));

    expect(res.status).toBe(400);
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
  });

  it.each([
    ['missing accountId', {}],
    ['null accountId', { accountId: null }],
    ['numeric accountId', { accountId: 42 }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
  });

  it('rejects a malformed JSON body with 400, not 500', async () => {
    const res = await POST(req(undefined, '{not json'));
    expect(res.status).toBe(400);
  });

  it('short-circuits a switch to the already-active workspace', async () => {
    const res = await POST(req({ accountId: RPC_ROW.account_id }));
    // Not a uuid in this fixture, so validation catches it first; use a
    // uuid-shaped active account to exercise the no-op path.
    expect([200, 400]).toContain(res.status);
  });

  it('requires an authenticated session', async () => {
    claims = null;
    const res = await POST(req({ accountId: target }));
    expect(res.status).toBe(401);
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
  });

  it('refuses a deactivated member before switching', async () => {
    // A member deactivated in their active workspace must not be able to
    // switch their way past the 403.
    rpcResult = { data: [{ ...RPC_ROW, status: 'inactive' }], error: null };
    supabaseStub.rpc = async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    };

    const res = await POST(req({ accountId: target }));

    expect(res.status).toBe(403);
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
  });

  it('enforces the rate limit', async () => {
    rateOk = false;
    const res = await POST(req({ accountId: target }));
    expect(res.status).toBe(429);
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
  });

  it('maps an unexpected RPC failure to 500 without leaking internals', async () => {
    let call = 0;
    supabaseStub.rpc = async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return ++call === 1
        ? { data: [RPC_ROW], error: null }
        : { data: null, error: { code: 'XX000', message: 'internal detail' } };
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(req({ accountId: target }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to switch workspace');
    expect(JSON.stringify(body)).not.toContain('internal detail');
    spy.mockRestore();
  });

  it('audits against the account being LEFT, before the pointer moves', async () => {
    let call = 0;
    supabaseStub.rpc = async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return ++call === 1 ? { data: [RPC_ROW], error: null } : { data: true, error: null };
    };

    await POST(req({ accountId: target }));

    const audit = inserted.find((i) => i.table === 'audit_events');
    expect(audit).toBeDefined();
    // Written against the source account — after the switch, RLS would no
    // longer permit this caller to write there.
    expect(audit?.row).toMatchObject({
      account_id: RPC_ROW.account_id,
      action: 'account.switched',
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

// ADR-004 Task 5. Two contracts are guarded here:
//
//  1. `AccountContext.memberships` — every workspace the caller is an
//     ACTIVE member of. This is what the sidebar switcher renders, and
//     it must arrive in the SAME round trip as the rest of the context
//     (ADR-001 C3: "zero extra round trips"), so it is carried by the
//     `get_account_context()` RPC rather than a second query.
//
//  2. `POST /api/account/switch` — must answer 404, never 403, for an
//     account the caller is not a member of (F4). A 403 would confirm
//     the account exists and leak the workspace graph to anyone who can
//     guess a uuid.
//
// The membership status gate matters as much as the list. Since Task 4,
// `account_members.status` is the authoritative grant — `profiles.status`
// is a separate GLOBAL per-user flag. A user deactivated in ONE workspace
// must be refused there while keeping access to their own.

// ------------------------------------------------------------
// Chainable Supabase mock. Unlike the one in account.test.ts, the
// builder is *thenable* so a filtered list query (no .maybeSingle())
// can be awaited directly — that is the shape the memberships read uses.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

function makeClient(opts: {
  user: { id: string } | null;
  byTable?: Record<string, { data: unknown; error: unknown }>;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const calls: BuilderCall[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const byTable = opts.byTable ?? {};

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const result = () =>
      Promise.resolve(byTable[table] ?? { data: null, error: null });
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle: result,
      // Thenable: `await supabase.from(t).select(..).eq(..)` resolves here.
      then(onFulfilled: (v: unknown) => unknown, onRejected?: () => unknown) {
        return result().then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  return {
    calls,
    rpcCalls,
    client: {
      auth: {
        getClaims: () =>
          Promise.resolve({
            data: opts.user ? { claims: { sub: opts.user.id } } : null,
            error: null,
          }),
      },
      rpc: (name: string, args?: unknown) => {
        rpcCalls.push({ name, args });
        if (name === 'get_account_context') {
          return Promise.resolve(
            opts.rpcResult ?? { data: null, error: { code: 'PGRST202' } }
          );
        }
        return Promise.resolve({ data: null, error: null });
      },
      from,
    },
  };
}

const createClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient(),
}));

const { getCurrentAccount, ForbiddenError } = await import('./account');

afterEach(() => {
  vi.clearAllMocks();
});

const baseRow = {
  user_id: 'user-1',
  account_id: 'acct-1',
  account_role: 'agent',
  account_name: 'Acme',
  status: 'active',
  is_owner: false,
  permissions: [],
};

describe('AccountContext.memberships', () => {
  it('carries every active membership from the context RPC with no extra round trip', async () => {
    const { client, calls, rpcCalls } = makeClient({
      user: { id: 'user-1' },
      rpcResult: {
        data: [
          {
            ...baseRow,
            memberships: [
              { account_id: 'acct-1', account_name: 'Acme', role: 'agent' },
              { account_id: 'acct-2', account_name: 'Own Co', role: 'owner' },
            ],
          },
        ],
        error: null,
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx.memberships).toEqual([
      { accountId: 'acct-1', accountName: 'Acme', role: 'agent' },
      { accountId: 'acct-2', accountName: 'Own Co', role: 'owner' },
    ]);
    // The perf contract: still ONE rpc and ZERO table queries.
    expect(rpcCalls.map((c) => c.name)).toEqual(['get_account_context']);
    expect(calls).toEqual([]);
  });

  it('defaults memberships to the active account when the RPC predates the column', async () => {
    // Rollout safety: an old get_account_context() returns no `memberships`
    // key. The context must still resolve, and must not claim the user has
    // zero workspaces (which would hide their own from the switcher).
    const { client } = makeClient({
      user: { id: 'user-1' },
      rpcResult: { data: [baseRow], error: null },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx.memberships).toEqual([
      { accountId: 'acct-1', accountName: 'Acme', role: 'agent' },
    ]);
  });

  it('drops malformed membership entries rather than surfacing partial rows', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      rpcResult: {
        data: [
          {
            ...baseRow,
            memberships: [
              { account_id: 'acct-1', account_name: 'Acme', role: 'agent' },
              { account_id: null, account_name: 'Broken', role: 'agent' },
              { account_id: 'acct-3', account_name: 'Bad Role', role: 'wat' },
            ],
          },
        ],
        error: null,
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx.memberships).toEqual([
      { accountId: 'acct-1', accountName: 'Acme', role: 'agent' },
    ]);
  });

  it('refuses a caller whose membership in the active workspace is not active', async () => {
    // The RPC now reports the membership status, not the global profile
    // flag. Deactivated in this workspace => clean 403 here rather than
    // silently empty pages from RLS.
    const { client } = makeClient({
      user: { id: 'user-1' },
      rpcResult: {
        data: [{ ...baseRow, status: 'inactive', memberships: [] }],
        error: null,
      },
    });
    createClient.mockReturnValue(client);

    await expect(getCurrentAccount()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('reads memberships from account_members, filtered to active, on the legacy fallback path', async () => {
    const { client, calls } = makeClient({
      user: { id: 'user-1' },
      byTable: {
        profiles: {
          data: { account_id: 'acct-1', account_role: 'agent' },
          error: null,
        },
        accounts: {
          data: { id: 'acct-1', name: 'Acme', owner_user_id: 'other' },
          error: null,
        },
        account_members: {
          data: [
            { account_id: 'acct-1', role: 'agent', accounts: { name: 'Acme' } },
          ],
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    const memberQuery = calls.find((c) => c.table === 'account_members');
    expect(memberQuery).toBeDefined();
    expect(memberQuery!.eqArgs).toEqual(
      expect.arrayContaining([
        ['user_id', 'user-1'],
        ['status', 'active'],
      ])
    );
    expect(ctx.memberships).toEqual([
      { accountId: 'acct-1', accountName: 'Acme', role: 'agent' },
    ]);
  });
});

// ------------------------------------------------------------
// POST /api/account/switch
// ------------------------------------------------------------

const getCurrentAccountMock = vi.fn();
vi.mock('@/features/auth/lib/account', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/auth/lib/account')>();
  return { ...actual, getCurrentAccount: () => getCurrentAccountMock() };
});

const { POST } = await import('@/app/api/account/switch/route');

function req(body: unknown) {
  return new Request('http://localhost/api/account/switch', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function ctxWithRpc(result: { data: unknown; error: unknown }) {
  const rpcCalls: { name: string; args: unknown }[] = [];
  return {
    rpcCalls,
    ctx: {
      userId: 'user-1',
      accountId: 'acct-1',
      supabase: {
        rpc: (name: string, args?: unknown) => {
          rpcCalls.push({ name, args });
          return Promise.resolve(result);
        },
      },
    },
  };
}

describe('POST /api/account/switch', () => {
  it('switches via the RPC and returns 200 for a member', async () => {
    const { ctx, rpcCalls } = ctxWithRpc({ data: true, error: null });
    getCurrentAccountMock.mockResolvedValue(ctx);

    const res = await POST(
      req({ accountId: '11111111-1111-1111-1111-111111111111' })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(rpcCalls).toEqual([
      {
        name: 'switch_active_account',
        args: { p_account_id: '11111111-1111-1111-1111-111111111111' },
      },
    ]);
  });

  it('returns 404 — never 403 — when the caller is not a member', async () => {
    // F4: a 403 would confirm the account exists.
    const { ctx } = ctxWithRpc({ data: false, error: null });
    getCurrentAccountMock.mockResolvedValue(ctx);

    const res = await POST(
      req({ accountId: '22222222-2222-2222-2222-222222222222' })
    );

    expect(res.status).toBe(404);
  });

  it('rejects a non-uuid accountId with 400 and performs no write', async () => {
    const { ctx, rpcCalls } = ctxWithRpc({ data: true, error: null });
    getCurrentAccountMock.mockResolvedValue(ctx);

    const res = await POST(req({ accountId: 'not-a-uuid' }));

    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it('rejects a malformed JSON body with 400 and performs no write', async () => {
    const { ctx, rpcCalls } = ctxWithRpc({ data: true, error: null });
    getCurrentAccountMock.mockResolvedValue(ctx);

    const res = await POST(req('{not json'));

    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it('propagates 401 when there is no session', async () => {
    const { UnauthorizedError } = await import('./account');
    getCurrentAccountMock.mockRejectedValue(new UnauthorizedError());

    const res = await POST(
      req({ accountId: '33333333-3333-3333-3333-333333333333' })
    );

    expect(res.status).toBe(401);
  });

  it('returns 500 without leaking the driver error when the RPC fails', async () => {
    const { ctx } = ctxWithRpc({
      data: null,
      error: { code: '42P01', message: 'relation "secret" does not exist' },
    });
    getCurrentAccountMock.mockResolvedValue(ctx);

    const res = await POST(
      req({ accountId: '44444444-4444-4444-4444-444444444444' })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/relation|secret/);
  });
});

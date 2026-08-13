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

// Real uuids, not 'acct-active' placeholders: the switch route validates
// uuid shape, so a placeholder id would make every request stop at
// validation and silently skip the behaviour under test.
const ACTIVE_ID = '22222222-2222-4222-8222-222222222222';
const OWN_ID = '33333333-3333-4333-8333-333333333333';

const RPC_ROW = {
  account_id: ACTIVE_ID,
  account_name: 'Active Workspace',
  account_role: 'agent',
  status: 'active',
  is_owner: false,
  permissions: ['contacts:read'],
  workspace_profile_id: null,
  workspace_profile_name: null,
  memberships: [
    { account_id: ACTIVE_ID, account_name: 'Active Workspace', role: 'agent' },
    { account_id: OWN_ID, account_name: 'My Workspace', role: 'owner' },
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
// The field is `success`, matching the real RateLimitResult — an `ok`
// stub would be silently falsy and 429 every request, which is how this
// mock first went wrong.
let rateOk = true;
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({
    success: rateOk,
    limit: 30,
    remaining: 0,
    reset: 0,
  }),
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
      ACTIVE_ID,
      OWN_ID,
    ]);
    // ADR-001 C3: no extra query for the switcher.
    expect(rpcCalls.filter((c) => c.name === 'get_account_context')).toHaveLength(1);
    expect(rpcCalls).toHaveLength(1);
  });

  it('marks exactly the active workspace and keeps per-workspace roles', async () => {
    const ctx = await getCurrentAccount();

    const active = ctx.memberships.filter((m) => m.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].accountId).toBe(ACTIVE_ID);
    // The role travels per membership: agent here, owner in their own.
    expect(ctx.memberships.find((m) => m.accountId === OWN_ID)?.role).toBe('owner');
    expect(ctx.memberships.find((m) => m.accountId === ACTIVE_ID)?.role).toBe('agent');
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

  /**
   * Authenticate the caller, then let the switch RPC answer `false`.
   * Needed because the route resolves the session BEFORE it validates the
   * body (see the ordering test below), so a request with no session never
   * reaches validation at all.
   */
  function authedThenRpc(switchResult: unknown = false) {
    let call = 0;
    supabaseStub.rpc = async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return ++call === 1
        ? { data: [RPC_ROW], error: null }
        : { data: switchResult, error: null };
    };
  }

  it('authenticates BEFORE validating the body', async () => {
    // Deliberate ordering, asserted so it cannot be "tidied" into
    // validate-first. With no session, a malformed body must still answer
    // 403 rather than 400: a 400 would tell an unauthenticated caller that
    // their payload was well-formed, turning this route into an oracle for
    // probing the API shape. Validation detail is only for callers who have
    // already proven they are entitled to an answer.
    supabaseStub.rpc = async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      return { data: [], error: null }; // no context -> denial
    };

    const res = await POST(req({ accountId: 'not-a-uuid' }));

    expect(res.status).not.toBe(400);
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
  });

  it('rejects a non-uuid accountId before it reaches Postgres', async () => {
    authedThenRpc();

    const res = await POST(req({ accountId: "'; drop table accounts; --" }));

    // 400, and critically the RPC is never called: the injection string
    // never reaches Postgres. (It would be harmless anyway — the arg is a
    // bound uuid parameter, not interpolated SQL — but failing on shape
    // keeps a client mistake from surfacing as a 22P02 cast error 500.)
    expect(res.status).toBe(400);
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
  });

  it.each([
    ['missing accountId', {}],
    ['null accountId', { accountId: null }],
    ['numeric accountId', { accountId: 42 }],
  ])('rejects %s with 400', async (_label, body) => {
    authedThenRpc();
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
  });

  it('rejects a malformed JSON body with 400, not 500', async () => {
    authedThenRpc();
    const res = await POST(req(undefined, '{not json'));
    expect(res.status).toBe(400);
  });

  it('short-circuits a switch to the already-active workspace', async () => {
    // RPC_ROW.account_id is uuid-shaped so this reaches the no-op path
    // instead of stopping at validation.
    authedThenRpc();

    const res = await POST(req({ accountId: RPC_ROW.account_id }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ switched: false });
    // No write, and no audit noise from a double-clicked menu item.
    expect(rpcCalls.some((c) => c.name === 'switch_active_account')).toBe(false);
    expect(inserted.some((i) => i.table === 'audit_events')).toBe(false);
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

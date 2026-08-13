// ============================================================
// POST /api/invitations/[token]/redeem — refusal contract.
//
// Pins the mapping from the RPC's SQLSTATE + message to an HTTP
// status and a STABLE machine-readable `reason`, because the join
// page needs to tell three different 42501s apart:
//
//   42501 'Unauthorized'                    -> 401 unauthorized
//   42501 '...different email address'      -> 403 email_mismatch
//   42501 'Confirm your email address...'   -> 403 email_unverified
//   42501 '...cannot grant ownership'       -> 403 forbidden
//   22023 (not found / used / expired / …)  -> 400 invalid
//
// The `reason` exists so the UI never has to string-match the
// database's prose. Verified against the LIVE function: these are
// the only errcodes redeem_invitation raises, and 23505 is gone
// (ADR-004 Task 3 made re-redemption idempotent), so the old 409
// "you already have data, sign up with another email" branch is
// unreachable and must not be reintroduced.
// ============================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';

const rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let authedUser: { id: string } | null = { id: 'user-1' };

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authedUser } }) },
    rpc: async () => rpcResult,
  }),
}));

// Seat-quota lookup uses the service role; keep it out of the way.
vi.mock('@/features/flows/lib/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }),
    }),
  }),
}));

vi.mock('@/lib/quotas', () => ({
  canAddResource: async () => ({ allowed: true }),
}));
vi.mock('@/lib/quotas/response', () => ({
  quotaExceededResponse: () => new Response('quota', { status: 402 }),
}));

let rateOk = true;
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({
    success: rateOk,
    limit: 10,
    remaining: 0,
    reset: 0,
  }),
  rateLimitResponse: () => new Response('rate limited', { status: 429 }),
  RATE_LIMITS: { invitationRedeem: { limit: 10, window: 60 } },
}));

vi.mock('@/features/auth/lib/invitations', () => ({
  hashInviteToken: (t: string) => `hash:${t}`,
}));

import { POST } from './route';

const req = () =>
  new Request('http://localhost/api/invitations/tok/redeem', { method: 'POST' });
const params = Promise.resolve({ token: 'tok' });

function rpcFails(code: string, message: string) {
  rpcResult.data = null;
  rpcResult.error = { code, message, details: '', hint: '' };
}

beforeEach(() => {
  rateOk = true;
  authedUser = { id: 'user-1' };
  rpcResult.data = 'acct-1';
  rpcResult.error = null;
});

describe('redeem refusal contract', () => {
  it('succeeds and returns the joined accountId', async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      accountId: 'acct-1',
    });
  });

  it('maps an email mismatch to 403 email_mismatch, NOT a bare 401', async () => {
    // Distinguishable from "not logged in": the caller IS authenticated,
    // just as the wrong person. A 401 would tell the UI to send them to
    // /login, where they would log in again as the same wrong user and
    // loop forever.
    rpcFails('42501', 'This invitation was sent to a different email address');

    const res = await POST(req(), { params });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      reason: 'email_mismatch',
    });
  });

  it('maps an unverified email to 403 email_unverified', async () => {
    rpcFails('42501', 'Confirm your email address before joining this workspace');

    const res = await POST(req(), { params });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      reason: 'email_unverified',
    });
  });

  it('maps an ownership-granting invite to 403 forbidden', async () => {
    rpcFails('42501', 'Invitations cannot grant ownership');

    const res = await POST(req(), { params });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ reason: 'forbidden' });
  });

  it('keeps a genuine auth failure as 401 unauthorized', async () => {
    rpcFails('42501', 'Unauthorized');

    const res = await POST(req(), { params });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      reason: 'unauthorized',
    });
  });

  it.each([
    ['Invitation not found'],
    ['Invitation has already been redeemed'],
    ['Invitation has expired'],
  ])('maps 22023 %s to 400 invalid', async (message) => {
    rpcFails('22023', message);

    const res = await POST(req(), { params });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ reason: 'invalid' });
  });

  it('NEVER returns 409 — the data-conflict refusal was removed in Task 3', async () => {
    // Guards the dead end. If a future change reintroduces a 23505 for
    // re-redemption, this fails rather than silently resurrecting the
    // "sign up with a different email" dialog the ADR deleted.
    rpcFails('23505', 'some unique violation');

    const res = await POST(req(), { params });

    expect(res.status).not.toBe(409);
    expect(res.status).toBe(500);
  });

  it('does not leak the raw database message on an unexpected error', async () => {
    rpcFails('XX000', 'relation "account_invitations" does not exist');

    const res = await POST(req(), { params });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(500);
    expect(body.error).not.toContain('account_invitations');
  });

  it('rejects an unauthenticated caller before touching the RPC', async () => {
    authedUser = null;

    const res = await POST(req(), { params });

    expect(res.status).toBe(401);
  });

  it('rate-limits before doing any work', async () => {
    rateOk = false;

    const res = await POST(req(), { params });

    expect(res.status).toBe(429);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  __setQuotaClientForTests,
  canAddResource,
  checkMonthlyQuota,
  consumeMonthlyQuota,
  tryConsume,
} from './index';

/**
 * Builds a stub Supabase client for the exact call shapes the quota
 * engine makes:
 *  - from('account_limit_overrides').select(col).eq().maybeSingle()
 *  - from('accounts').select('plan_id').eq().single()
 *  - from('plans').select(col).eq().single()
 *  - from(<live table>).select('*', {count}).eq()... (awaited builder)
 *  - from('usage_counters').select('used').eq()x3.maybeSingle()
 *  - rpc('increment_usage', args)
 */
function stubClient(opts: {
  planId?: string;
  planLimits?: Record<string, number | null>;
  override?: Record<string, number | boolean | null> | null;
  liveCount?: number;
  monthlyUsed?: number | null;
  rpcResult?: number;
  failWith?: Error;
}) {
  const {
    planId = 'free',
    planLimits = {},
    override = null,
    liveCount = 0,
    monthlyUsed = null,
    rpcResult = 1,
    failWith,
  } = opts;

  const rpcCalls: Array<{ fn: string; args: unknown }> = [];

  function makeCountBuilder() {
    // Awaitable builder: every .eq() returns itself; awaiting resolves.
    const builder: Record<string, unknown> = {};
    builder.eq = () => builder;
    builder.then = (
      resolve: (v: { count: number; error: null }) => void
    ) => resolve({ count: liveCount, error: null });
    return builder;
  }

  const client = {
    from(table: string) {
      if (failWith) throw failWith;
      if (table === 'account_limit_overrides') {
        return {
          select: (cols: string) => ({
            eq: () => ({
              // Real PostgREST returns one key per selected column —
              // mirror that by splitting the comma-separated list.
              maybeSingle: async () => ({
                data: override
                  ? Object.fromEntries(
                      cols
                        .split(',')
                        .map((c) => c.trim())
                        .map((c) => [c, override[c] ?? null])
                    )
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { plan_id: planId }, error: null }),
            }),
          }),
        };
      }
      if (table === 'plans') {
        return {
          select: (col: string) => ({
            eq: () => ({
              single: async () => ({
                data: { [col]: planLimits[col] ?? null },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'usage_counters') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: monthlyUsed === null ? null : { used: monthlyUsed },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      // live-count tables (contacts, flows, profiles, channel_connections)
      return { select: () => makeCountBuilder() };
    },
    rpc: async (fn: string, args: unknown) => {
      if (failWith) return { data: null, error: failWith };
      rpcCalls.push({ fn, args });
      return { data: rpcResult, error: null };
    },
    __rpcCalls: rpcCalls,
  };

  return client as unknown as SupabaseClient & {
    __rpcCalls: typeof rpcCalls;
  };
}

const ACCOUNT = '00000000-0000-0000-0000-000000000001';

afterEach(() => {
  __setQuotaClientForTests(null);
  vi.restoreAllMocks();
});

describe('canAddResource (point-in-time limits)', () => {
  it('allows when under the plan limit', async () => {
    __setQuotaClientForTests(
      stubClient({ planLimits: { max_contacts: 500 }, liveCount: 10 })
    );
    const d = await canAddResource(ACCOUNT, 'max_contacts');
    expect(d.allowed).toBe(true);
    expect(d.used).toBe(10);
    expect(d.remaining).toBe(490);
  });

  it('blocks at exactly the limit', async () => {
    __setQuotaClientForTests(
      stubClient({ planLimits: { max_contacts: 500 }, liveCount: 500 })
    );
    const d = await canAddResource(ACCOUNT, 'max_contacts');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('quota_exceeded');
    expect(d.remaining).toBe(0);
  });

  it('treats NULL limit as unlimited (ultra plan)', async () => {
    __setQuotaClientForTests(
      stubClient({
        planId: 'ultra',
        planLimits: { max_contacts: null },
        liveCount: 999999,
      })
    );
    const d = await canAddResource(ACCOUNT, 'max_contacts');
    expect(d.allowed).toBe(true);
    expect(d.limit).toBeNull();
  });

  it('override row beats plan value', async () => {
    __setQuotaClientForTests(
      stubClient({
        planLimits: { max_contacts: 500 },
        override: { max_contacts: 2000 },
        liveCount: 600,
      })
    );
    const d = await canAddResource(ACCOUNT, 'max_contacts');
    expect(d.allowed).toBe(true);
    expect(d.limit).toBe(2000);
  });

  it('unlimited_all override makes every limit unlimited', async () => {
    __setQuotaClientForTests(
      stubClient({
        planLimits: { max_contacts: 500 },
        override: { unlimited_all: true },
        liveCount: 999999,
      })
    );
    const d = await canAddResource(ACCOUNT, 'max_contacts');
    expect(d.allowed).toBe(true);
    expect(d.limit).toBeNull();
  });

  it('per-feature -1 sentinel makes that one feature unlimited', async () => {
    __setQuotaClientForTests(
      stubClient({
        planLimits: { max_contacts: 500 },
        override: { max_contacts: -1 },
        liveCount: 999999,
      })
    );
    const d = await canAddResource(ACCOUNT, 'max_contacts');
    expect(d.allowed).toBe(true);
    expect(d.limit).toBeNull();
  });

  it('respects bulk amount (batch add crossing the cap)', async () => {
    __setQuotaClientForTests(
      stubClient({ planLimits: { max_contacts: 500 }, liveCount: 495 })
    );
    const d = await canAddResource(ACCOUNT, 'max_contacts', 10);
    expect(d.allowed).toBe(false);
  });

  it('fails open when the check itself errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    __setQuotaClientForTests(stubClient({ failWith: new Error('boom') }));
    const d = await canAddResource(ACCOUNT, 'max_contacts');
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('check_failed');
  });
});

describe('checkMonthlyQuota', () => {
  it('allows under the monthly cap and reports remaining', async () => {
    __setQuotaClientForTests(
      stubClient({ planLimits: { monthly_messages: 1000 }, monthlyUsed: 400 })
    );
    const d = await checkMonthlyQuota(ACCOUNT, 'messages_sent');
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(600);
  });

  it('blocks when the month is exhausted', async () => {
    __setQuotaClientForTests(
      stubClient({ planLimits: { monthly_messages: 1000 }, monthlyUsed: 1000 })
    );
    const d = await checkMonthlyQuota(ACCOUNT, 'messages_sent');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('quota_exceeded');
  });

  it('treats a missing counter row as zero usage', async () => {
    __setQuotaClientForTests(
      stubClient({ planLimits: { monthly_messages: 1000 }, monthlyUsed: null })
    );
    const d = await checkMonthlyQuota(ACCOUNT, 'messages_sent');
    expect(d.used).toBe(0);
    expect(d.allowed).toBe(true);
  });
});

describe('consumeMonthlyQuota', () => {
  it('calls increment_usage with the right args and returns new total', async () => {
    const client = stubClient({ rpcResult: 42 });
    __setQuotaClientForTests(client);
    const used = await consumeMonthlyQuota(ACCOUNT, 'ai_replies', 2);
    expect(used).toBe(42);
    expect(client.__rpcCalls[0]).toEqual({
      fn: 'increment_usage',
      args: { p_account_id: ACCOUNT, p_metric: 'ai_replies', p_amount: 2 },
    });
  });

  it('returns null (never throws) when the write fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    __setQuotaClientForTests(stubClient({ failWith: new Error('down') }));
    const used = await consumeMonthlyQuota(ACCOUNT, 'ai_replies');
    expect(used).toBeNull();
  });
});

describe('tryConsume', () => {
  it('consumes when allowed', async () => {
    const client = stubClient({
      planLimits: { monthly_messages: 1000 },
      monthlyUsed: 10,
    });
    __setQuotaClientForTests(client);
    const d = await tryConsume(ACCOUNT, 'messages_sent');
    expect(d.allowed).toBe(true);
    expect(client.__rpcCalls).toHaveLength(1);
  });

  it('does NOT consume when blocked', async () => {
    const client = stubClient({
      planLimits: { monthly_messages: 1000 },
      monthlyUsed: 1000,
    });
    __setQuotaClientForTests(client);
    const d = await tryConsume(ACCOUNT, 'messages_sent');
    expect(d.allowed).toBe(false);
    expect(client.__rpcCalls).toHaveLength(0);
  });
});

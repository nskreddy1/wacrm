import { describe, it, expect, vi } from 'vitest';
import { logAiUsage } from './usage';
import type { SupabaseClient } from '@supabase/supabase-js';

function fakeDb() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const db = { from: vi.fn(() => ({ insert })) };
  return { db: db as unknown as SupabaseClient, insert, from: db.from };
}

describe('logAiUsage', () => {
  it('inserts a row mapping normalized usage to the log columns', async () => {
    const { db, insert, from } = fakeDb();
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    });
    expect(from).toHaveBeenCalledWith('ai_usage_log');
    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      prompt_tokens: 30,
      completion_tokens: 6,
      total_tokens: 36,
      // Null (not 0) when the provider reported no cache info —
      // telemetry must distinguish "no data" from "0% hit".
      cached_tokens: null,
      cache_write_tokens: null,
      // Defaults to the account's own BYO key when the caller doesn't
      // specify which key paid for the request.
      key_source: 'account',
    });
  });

  it('records provider cache telemetry when reported', async () => {
    const { db, insert } = fakeDb();
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      usage: {
        promptTokens: 1000,
        completionTokens: 50,
        totalTokens: 1050,
        cachedTokens: 800,
        cacheWriteTokens: 120,
      },
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ cached_tokens: 800, cache_write_tokens: 120 })
    );
  });

  it('is a no-op when the provider reported no usage', async () => {
    const { db, from } = fakeDb();
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: null,
      mode: 'draft',
      provider: 'openai',
      model: 'gpt-x',
      usage: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('never throws when the insert errors', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;
    await expect(
      logAiUsage(db, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        mode: 'draft',
        provider: 'openai',
        model: 'gpt-x',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })
    ).resolves.toBeUndefined();
  });
});

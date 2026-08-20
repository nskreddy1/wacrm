import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  CONSENT_BLOCKED_CODE,
  loadOptedOutContactIds,
  loadWhatsAppConsentBlocklist,
} from './consent-filter';
import { OutboundBlockedError } from './window-guard';

/**
 * Minimal query-builder double. Records the filters applied so the tests can
 * assert account scoping — the invariant that keeps one tenant's consent
 * state out of another tenant's broadcast plan.
 */
function fakeDb(
  result: { data?: unknown[]; error?: { message: string } },
  filters: Record<string, unknown> = {}
): SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = () => builder as never;
  Object.assign(builder, {
    select: chain,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return builder as never;
    },
    in: (col: string, vals: unknown) => {
      filters[col] = vals;
      return Promise.resolve(result) as never;
    },
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve),
  });
  return { from: () => builder } as unknown as SupabaseClient;
}

describe('loadWhatsAppConsentBlocklist (ADR-006 D8/D13)', () => {
  it('is a no-op query for an empty recipient list', async () => {
    const list = await loadWhatsAppConsentBlocklist(
      fakeDb({ data: [{ phone: '919999999999' }] }),
      'acct-1',
      []
    );
    expect(list.blocks('919999999999')).toBe(false);
  });

  it('blocks an opted-out number regardless of formatting', async () => {
    const list = await loadWhatsAppConsentBlocklist(
      fakeDb({ data: [{ phone: '+91 98765 43210' }] }),
      'acct-1',
      ['919876543210']
    );
    expect(list.blocks('919876543210')).toBe(true);
    expect(list.blocks('+91-98765-43210')).toBe(true);
    expect(list.blocks('919000000000')).toBe(false);
  });

  it('scopes the lookup to the account (F2)', async () => {
    const filters: Record<string, unknown> = {};
    await loadWhatsAppConsentBlocklist(fakeDb({ data: [] }, filters), 'acct-1', [
      '919876543210',
    ]);
    expect(filters.account_id).toBe('acct-1');
    expect(filters.whatsapp_opted_out).toBe(true);
  });

  it('fails closed when consent state cannot be read', async () => {
    await expect(
      loadWhatsAppConsentBlocklist(
        fakeDb({ error: { message: 'connection reset' } }),
        'acct-1',
        ['919876543210']
      )
    ).rejects.toMatchObject({
      name: 'OutboundBlockedError',
      code: CONSENT_BLOCKED_CODE,
      status: 409,
    });
  });

  it('borrows its refusal message from the one guard that owns the rule', async () => {
    const list = await loadWhatsAppConsentBlocklist(
      fakeDb({ data: [{ phone: '919876543210' }] }),
      'acct-1',
      ['919876543210']
    );
    const reason = list.reason();
    expect(reason).toBeInstanceOf(OutboundBlockedError);
    expect(reason.code).toBe('contact_opted_out');
    expect(reason.message).toMatch(/opted out/i);
  });
});

describe('loadOptedOutContactIds', () => {
  it('returns the opted-out subset, account-scoped', async () => {
    const filters: Record<string, unknown> = {};
    const ids = await loadOptedOutContactIds(
      fakeDb({ data: [{ id: 'ct-2' }] }, filters),
      'acct-1',
      ['ct-1', 'ct-2']
    );
    expect([...ids]).toEqual(['ct-2']);
    expect(filters.account_id).toBe('acct-1');
    expect(filters.id).toEqual(['ct-1', 'ct-2']);
  });

  it('skips the query when there are no contacts', async () => {
    const ids = await loadOptedOutContactIds(
      fakeDb({ data: [{ id: 'ct-9' }] }),
      'acct-1',
      []
    );
    expect(ids.size).toBe(0);
  });

  it('fails closed on a read error', async () => {
    await expect(
      loadOptedOutContactIds(
        fakeDb({ error: { message: 'timeout' } }),
        'acct-1',
        ['ct-1']
      )
    ).rejects.toMatchObject({ code: CONSENT_BLOCKED_CODE });
  });
});

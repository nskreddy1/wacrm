import { describe, expect, it } from 'vitest';
import { createSupabaseRecorder } from '@/lib/test/supabase-recorder';
import { buildAssistantTools } from './tools';

/**
 * Mira's catalog tools run with a Supabase client and an account id from the
 * caller's session. Account scoping is what stops one workspace's price list
 * from being read or edited through another workspace's assistant, and a
 * missing `.eq('account_id', …)` is invisible in review.
 *
 * These tests assert the filter is actually applied on every catalog tool,
 * including the existence check that makes a guessed id from another workspace
 * unprobeable.
 */

const ACCOUNT = 'acct-1111';
const OTHER_ITEM = '22222222-2222-4222-8222-222222222222';

function toolsWith(results: Array<{ data: unknown; error: unknown }> = []) {
  const db = createSupabaseRecorder(results);
  const tools = buildAssistantTools({
    supabase: db.client,
    accountId: ACCOUNT,
    userId: 'user-1',
  });
  return { db, tools };
}

/** The tool `execute` signatures carry AI SDK options we do not use here. */
async function run(
  tool: unknown,
  input: Record<string, unknown>
): Promise<unknown> {
  const execute = (tool as { execute: (i: unknown, o: unknown) => unknown })
    .execute;
  return await execute(input, {
    toolCallId: 'test',
    messages: [],
  });
}

describe('assistant catalog tools — account scoping', () => {
  it('scopes list_catalog_items to the caller account', async () => {
    const { db, tools } = toolsWith([{ data: [], error: null }]);

    await run(tools.list_catalog_items, {
      include_inactive: false,
      limit: 20,
    });

    expect(db.queries[0].table).toBe('catalog_items');
    expect(db.eqFilters(0)).toContainEqual(['account_id', ACCOUNT]);
  });

  it('stamps the account id on created items rather than trusting input', async () => {
    const { db, tools } = toolsWith([
      { data: { id: 'new-1', name: 'Course' }, error: null },
    ]);

    await run(tools.create_catalog_item, { name: 'Course', price: 10 });

    const insert = db.queries[0];
    expect(insert.operation).toBe('insert');
    expect(insert.payload).toMatchObject({
      account_id: ACCOUNT,
      created_by: 'user-1',
    });
  });

  it('omits currency on create so the column default applies', async () => {
    // Sending currency: null would overwrite the workspace default with null.
    const { db, tools } = toolsWith([{ data: { id: 'new-1' }, error: null }]);

    await run(tools.create_catalog_item, { name: 'Course', price: 10 });

    expect(db.queries[0].payload).not.toHaveProperty('currency');
  });

  it('refuses to update an item that is not in the caller account', async () => {
    // The existence check resolves to no row, which is what a cross-account id
    // looks like once the account filter is applied.
    const { db, tools } = toolsWith([{ data: null, error: null }]);

    const result = (await run(tools.update_catalog_item, {
      item_id: OTHER_ITEM,
      price: 1,
    })) as { error?: string };

    expect(result.error).toBe('Catalog item not found in this workspace.');
    // Critically: the lookup was account-scoped, and no UPDATE was attempted.
    expect(db.eqFilters(0)).toContainEqual(['account_id', ACCOUNT]);
    expect(db.queries.some((q) => q.operation === 'update')).toBe(false);
  });

  it('scopes the update itself, not just the existence check', async () => {
    const { db, tools } = toolsWith([
      { data: { id: OTHER_ITEM, name: 'Course' }, error: null },
      { data: { id: OTHER_ITEM, price: 5 }, error: null },
    ]);

    await run(tools.update_catalog_item, { item_id: OTHER_ITEM, price: 5 });

    const update = db.queries.find((q) => q.operation === 'update');
    expect(update, 'an update chain should have been issued').toBeDefined();
    // A WHERE on id alone would let a guessed id be written across accounts.
    expect(db.eqFilters(db.queries.indexOf(update!))).toContainEqual([
      'account_id',
      ACCOUNT,
    ]);
  });

  it('rejects an empty update instead of issuing a no-op write', async () => {
    const { db, tools } = toolsWith([
      { data: { id: OTHER_ITEM, name: 'Course' }, error: null },
    ]);

    const result = (await run(tools.update_catalog_item, {
      item_id: OTHER_ITEM,
    })) as { error?: string };

    expect(result.error).toBe(
      'Nothing to update — provide at least one field.'
    );
    expect(db.queries.some((q) => q.operation === 'update')).toBe(false);
  });
});

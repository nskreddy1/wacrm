import { describe, expect, it } from 'vitest';
import { READ_TOOL_NAMES, WRITE_TOOL_NAMES } from './tools';

/**
 * These lists are the security boundary for Mira's tools, not documentation.
 *
 *   - `WRITE_TOOL_NAMES` is what the chat route maps to `'user-approval'`
 *     (src/app/api/assistant/chat/route.ts), so a mutating tool missing from
 *     it would execute silently with no confirmation.
 *   - `READ_TOOL_NAMES` is what the MCP server exposes without approval, so a
 *     mutating tool leaking in there would be callable unattended by any
 *     account-level API key holder.
 *
 * A tool is registered in one file and gated in another, so nothing forces the
 * two to agree. These tests are that forcing function.
 */
describe('assistant tool registration', () => {
  const write = new Set<string>(WRITE_TOOL_NAMES);
  const read = new Set<string>(READ_TOOL_NAMES);

  it('gates every mutating tool behind user approval', () => {
    // Every tool that writes to the database belongs here. Adding a new
    // create_/update_/delete_ tool means adding it to this list too.
    for (const name of [
      'create_contact',
      'create_task',
      'add_contact_note',
      'create_catalog_item',
      'update_catalog_item',
      'create_workflow',
      'activate_workflow',
      'create_support_ticket',
    ]) {
      expect(write.has(name), `${name} must require approval`).toBe(true);
    }
  });

  it('never exposes a mutating tool as read-only', () => {
    const leaked = [...write].filter((name) => read.has(name));
    expect(leaked, 'write tools must not appear in READ_TOOL_NAMES').toEqual(
      []
    );
  });

  it('treats catalog reads as read-only and catalog edits as writes', () => {
    // The catalog is an internal price list: safe for Mira to read freely,
    // but a price change must never happen without the user seeing it.
    expect(read.has('list_catalog_items')).toBe(true);
    expect(write.has('list_catalog_items')).toBe(false);
    expect(write.has('create_catalog_item')).toBe(true);
    expect(write.has('update_catalog_item')).toBe(true);
  });

  it('keeps both lists free of duplicates', () => {
    expect(new Set(WRITE_TOOL_NAMES).size).toBe(WRITE_TOOL_NAMES.length);
    expect(new Set(READ_TOOL_NAMES).size).toBe(READ_TOOL_NAMES.length);
  });

  /**
   * The checks above compare the two lists against names written out here,
   * which cannot catch the dangerous case: a tool registered in
   * `buildAssistantTools` and added to NEITHER list. It is absent from
   * WRITE_TOOL_NAMES, so the route never gates it, and absent from the
   * hardcoded array above, so no assertion mentions it — a new mutating
   * tool would execute unattended and every test would still pass.
   *
   * This compares against the real registry instead, so the omission fails
   * here rather than in production.
   */
  it('classifies every registered tool as either read or write', async () => {
    const { buildAssistantTools } = await import('./tools');
    // Only the tool *names* are needed, and no tool executes, so a bare
    // context is enough — building the map never touches the database.
    const registered = Object.keys(
      buildAssistantTools({
        supabase: null,
        accountId: 'test-account',
        userId: 'test-user',
      } as unknown as Parameters<typeof buildAssistantTools>[0])
    );

    expect(registered.length).toBeGreaterThan(0);
    const unclassified = registered.filter(
      (name) => !write.has(name) && !read.has(name)
    );
    expect(
      unclassified,
      'every registered tool must be listed in WRITE_TOOL_NAMES (approval-gated) or READ_TOOL_NAMES (read-only)'
    ).toEqual([]);

    // And the reverse: a renamed or deleted tool left behind in a list
    // would gate a name that no longer exists, hiding the real one.
    const stale = [...write, ...read].filter(
      (name) => !registered.includes(name)
    );
    expect(stale, 'these listed tools are no longer registered').toEqual([]);
  });

  /**
   * A mutating tool must never be reachable through the MCP server, which
   * exposes READ_TOOL_NAMES without approval to any account API key holder.
   * Name-based rather than list-based, so it catches a write tool that was
   * mistakenly classified as a read.
   */
  it('keeps mutating verbs out of the read-only list', () => {
    const mutating = [...read].filter((name) =>
      /^(create|update|delete|activate|add|send|run)_/.test(name)
    );
    expect(
      mutating,
      'these look like mutating tools but are exposed as read-only'
    ).toEqual([]);
  });
});

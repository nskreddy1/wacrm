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
});

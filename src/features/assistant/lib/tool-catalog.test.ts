import { describe, expect, it } from 'vitest';
import { buildAssistantTools } from './tools';
import {
  isWriteTool,
  READ_TOOL_NAMES,
  TOOL_CATALOG,
  TOOL_LABELS,
  toolLabel,
  WRITE_TOOL_NAMES,
  WRITE_TOOLS,
} from './tool-catalog';

/**
 * The catalog is what the chat route gates on, what the MCP server exposes,
 * and what the widget labels tool steps with. Before it existed those three
 * consumers each kept their own hand-written list, and they drifted: six tools
 * had no UI entry (so the transcript showed `list_catalog_items` verbatim) and
 * three approval-gated writes were absent from the client write set, so their
 * steps rendered without the "awaiting approval" state.
 *
 * These tests are the forcing function that keeps one registry and one catalog
 * in agreement — a new tool fails here rather than shipping mislabelled or,
 * far worse, unclassified.
 */

/** Names actually registered in `buildAssistantTools`. Building the map never
 *  touches the database, so a bare context is enough. */
function registeredToolNames(): string[] {
  return Object.keys(
    buildAssistantTools({
      supabase: null,
      accountId: 'test-account',
      userId: 'test-user',
    } as unknown as Parameters<typeof buildAssistantTools>[0])
  );
}

describe('Mira tool catalog', () => {
  it('covers every registered tool', () => {
    const missing = registeredToolNames().filter((n) => !(n in TOOL_CATALOG));
    expect(
      missing,
      'these tools are registered but absent from TOOL_CATALOG, so they are neither gated nor labelled'
    ).toEqual([]);
  });

  it('has no entry for a tool that no longer exists', () => {
    const registered = new Set(registeredToolNames());
    const stale = Object.keys(TOOL_CATALOG).filter((n) => !registered.has(n));
    expect(stale, 'these catalog entries are no longer registered').toEqual([]);
  });

  it('gives every tool a human label that is not just its name', () => {
    for (const [name, entry] of Object.entries(TOOL_CATALOG)) {
      expect(entry.label.length, `${name} needs a label`).toBeGreaterThan(0);
      expect(entry.label, `${name} label should be human-readable`).not.toBe(
        name
      );
      expect(entry.label).not.toMatch(/_/);
    }
  });

  it('keeps the derived name lists disjoint and complete', () => {
    const overlap = WRITE_TOOL_NAMES.filter((n) => READ_TOOL_NAMES.includes(n));
    expect(overlap).toEqual([]);
    expect(WRITE_TOOL_NAMES.length + READ_TOOL_NAMES.length).toBe(
      Object.keys(TOOL_CATALOG).length
    );
  });

  it('classifies mutating verbs as writes', () => {
    // A tool named create_/update_/delete_/activate_/add_/send_/run_ that is
    // exposed as a read would be callable unattended over MCP.
    const misclassified = READ_TOOL_NAMES.filter((n) =>
      /^(create|update|delete|activate|add|send|run)_/.test(n)
    );
    expect(misclassified).toEqual([]);
  });

  it('treats an uncatalogued tool as a write rather than a silent read', () => {
    // Fail safe: if the server gains a tool before the catalog does, the UI
    // must claim it needs approval, never that it already ran on its own.
    expect(isWriteTool('some_future_tool')).toBe(true);
    expect(toolLabel('some_future_tool')).toBe('some_future_tool');
  });

  it('exposes the write set and labels the UI consumes', () => {
    for (const name of WRITE_TOOL_NAMES) {
      expect(WRITE_TOOLS.has(name)).toBe(true);
      expect(isWriteTool(name)).toBe(true);
      expect(TOOL_LABELS[name]).toBe(TOOL_CATALOG[name].label);
    }
    for (const name of READ_TOOL_NAMES) {
      expect(WRITE_TOOLS.has(name)).toBe(false);
      expect(isWriteTool(name)).toBe(false);
    }
  });
});

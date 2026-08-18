// ============================================================
// Mira tool catalog — the single source of truth for every tool
// the assistant can call, its access class, and its human label.
//
// Why this file exists separately from `tools.ts`:
//
//   - `tools.ts` builds the executable tools. It imports the AI SDK,
//     the Supabase client types, the flow validator and the integration
//     runner, so it can never be pulled into a client bundle.
//   - The chat widget still needs the same two facts about each tool:
//     what to call it on screen, and whether it mutates data (a write
//     renders an approval card and an "awaiting approval" step).
//
// Previously those facts were retyped by hand in
// `components/agent-parts.tsx`. The lists drifted: six tools had no
// entry at all, so the transcript showed raw snake_case names, and
// three approval-gated tools were missing from the client write set,
// so their steps rendered as if they ran unattended.
//
// Declaring access here — as pure data with no runtime imports — lets
// the server lists, the MCP exposure and the UI all derive from one
// place, and lets `tool-catalog.test.ts` assert the catalog covers the
// real registry exactly.
//
// ACCESS CLASS IS A SECURITY BOUNDARY, NOT A LABEL:
//   'write' → mapped to `'user-approval'` by the chat route and refused
//             by the MCP server.
//   'read'  → runs without a prompt and IS exposed over MCP to any
//             account-level API key holder.
// A mutating tool marked 'read' executes unattended. When in doubt,
// mark it 'write'.
// ============================================================

export type ToolAccess = 'read' | 'write';

export interface ToolCatalogEntry {
  /** Approval gating + MCP exposure. See the warning above. */
  access: ToolAccess;
  /**
   * Present-progressive for reads ("Reading contacts") because the step
   * is narrating something already happening; plain imperative for
   * writes ("Create a contact") because the same string titles the
   * approval card, where the user is authorising an action.
   */
  label: string;
}

export const TOOL_CATALOG: Record<string, ToolCatalogEntry> = {
  // ---------- READ ----------
  get_workspace_overview: {
    access: 'read',
    label: 'Reading workspace overview',
  },
  list_contacts: { access: 'read', label: 'Listing contacts' },
  get_contact_details: { access: 'read', label: 'Reading contact details' },
  search_contacts: { access: 'read', label: 'Searching contacts' },
  get_pipeline_summary: { access: 'read', label: 'Reading pipeline summary' },
  list_deals: { access: 'read', label: 'Reading deals' },
  list_recent_conversations: {
    access: 'read',
    label: 'Reading recent conversations',
  },
  get_conversation_messages: {
    access: 'read',
    label: 'Reading conversation messages',
  },
  list_upcoming_appointments: { access: 'read', label: 'Reading appointments' },
  list_catalog_items: { access: 'read', label: 'Reading products & services' },
  list_broadcasts: { access: 'read', label: 'Reading broadcasts' },
  list_templates: { access: 'read', label: 'Reading templates' },
  list_automations: { access: 'read', label: 'Reading workflows' },
  list_tasks: { access: 'read', label: 'Reading tasks' },
  list_support_tickets: { access: 'read', label: 'Reading support tickets' },
  get_ai_agent_status: { access: 'read', label: 'Checking AI agent status' },
  list_integration_operations: {
    access: 'read',
    label: 'Reading connected systems',
  },
  lookup_integration_records: {
    access: 'read',
    label: 'Looking up records in a connected system',
  },

  // ---------- WRITE (approval-gated) ----------
  create_contact: { access: 'write', label: 'Create a contact' },
  create_task: { access: 'write', label: 'Create a task' },
  add_contact_note: { access: 'write', label: 'Add a contact note' },
  create_catalog_item: {
    access: 'write',
    label: 'Add a product or service',
  },
  update_catalog_item: {
    access: 'write',
    label: 'Update a product or service',
  },
  create_workflow: { access: 'write', label: 'Create a workflow' },
  activate_workflow: { access: 'write', label: 'Change workflow status' },
  create_support_ticket: { access: 'write', label: 'Create a support ticket' },
  run_integration_write_operation: {
    access: 'write',
    label: 'Update a record in a connected system',
  },
};

function namesWithAccess(access: ToolAccess): string[] {
  return Object.entries(TOOL_CATALOG)
    .filter(([, entry]) => entry.access === access)
    .map(([name]) => name);
}

/** Tool names that mutate data — approval-gated in the chat route. */
export const WRITE_TOOL_NAMES: readonly string[] = namesWithAccess('write');

/** Read-only tool names — safe to expose on the MCP server without approval. */
export const READ_TOOL_NAMES: readonly string[] = namesWithAccess('read');

/** Set form for the O(1) membership checks the UI does per rendered part. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(WRITE_TOOL_NAMES);

/** Human labels keyed by tool name, for transcript steps and approval cards. */
export const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_CATALOG).map(([name, entry]) => [name, entry.label])
);

/** Label for a tool name, falling back to the raw name for anything
 *  unrecognised (a tool added server-side before the catalog caught up). */
export function toolLabel(name: string): string {
  return TOOL_CATALOG[name]?.label ?? name;
}

/** Whether a tool mutates data. Unknown names are treated as writes so an
 *  uncatalogued tool renders as needing approval rather than silently
 *  appearing to have run on its own. */
export function isWriteTool(name: string): boolean {
  return TOOL_CATALOG[name]?.access !== 'read';
}

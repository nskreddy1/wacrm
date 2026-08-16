// ============================================================
// Read-only tools — always registered.
//
// whoami + list/read of contacts, conversations, messages, and
// broadcast status. None of these change state, so they're safe to
// expose unconditionally. Each carries readOnlyHint so clients can
// surface them without a confirmation prompt.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { handle, jsonResult } from './shared.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

export function registerReadTools(
  server: McpServer,
  client: WacrmClient
): void {
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Verify the API key and show which wacrm account it is bound to and what scopes it carries. Call this first to discover what actions are possible.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Who am I' },
    },
    handle(async () => jsonResult(await client.me()))
  );

  server.registerTool(
    'list_integration_operations',
    {
      title: 'List integration operations',
      description:
        "List the named operations an admin has published against this account's connected business systems (for example an orders database or a fees API). Each entry shows its mode (read or write), the contact field its parameter binds to, and what it returns. Call this to discover what can be looked up before calling run_integration_operation.",
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'List integration operations' },
    },
    handle(async () => jsonResult(await client.listIntegrationOperations()))
  );

  server.registerTool(
    'run_integration_operation',
    {
      title: 'Run integration operation',
      description:
        "Run a published integration operation for one contact and return the matching records from the account's own business system. You choose the operation by name and identify the contact; you do NOT supply the lookup value. The parameter is filled server-side from the stored contact record (for example their phone number), so this can only ever return rows belonging to that contact. Write-mode operations additionally require the integrations:write scope and will be rejected without it; pass dry_run to preview one without applying it.",
      inputSchema: {
        operation: z
          .string()
          .describe('Operation key from list_integration_operations.'),
        contact_id: z
          .string()
          .describe('Id of the contact to run the operation for.'),
        dry_run: z
          .boolean()
          .optional()
          .describe(
            'Validate and plan a write operation without applying it. Ignored for read operations.'
          ),
      },
      annotations: {
        // Not flagged read-only: the same endpoint serves write-mode
        // operations when the key carries integrations:write, so clients
        // should keep their confirmation affordance available.
        readOnlyHint: false,
        openWorldHint: true,
        title: 'Run integration operation',
      },
    },
    handle(async (args) =>
      jsonResult(await client.runIntegrationOperation(args))
    )
  );

  server.registerTool(
    'list_contacts',
    {
      title: 'List contacts',
      description:
        'List contacts in the CRM, newest first. Optionally filter by a free-text search (matches name or phone) or by a tag id. Results are paginated: pass the returned next_cursor to fetch the next page.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Free-text search over name or phone number.'),
        tag: z.string().optional().describe('Tag id to filter by.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Page size, 1–100 (default 50).'),
        cursor: z
          .string()
          .optional()
          .describe('Opaque pagination cursor from a previous response.'),
      },
      annotations: { ...READ_ONLY, title: 'List contacts' },
    },
    handle(async (args) => jsonResult(await client.listContacts(args)))
  );

  server.registerTool(
    'get_contact',
    {
      title: 'Get contact',
      description: 'Read a single contact by its id.',
      inputSchema: {
        id: z.string().describe('Contact id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get contact' },
    },
    handle(async ({ id }) => jsonResult(await client.getContact(id)))
  );

  server.registerTool(
    'list_conversations',
    {
      title: 'List conversations',
      description:
        'List conversations, newest first. Optionally filter by status (open / pending / closed) or by contact id. Paginated.',
      inputSchema: {
        status: z
          .enum(['open', 'pending', 'closed'])
          .optional()
          .describe('Conversation status filter.'),
        contact_id: z
          .string()
          .optional()
          .describe('Only conversations for this contact.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List conversations' },
    },
    handle(async (args) => jsonResult(await client.listConversations(args)))
  );

  server.registerTool(
    'get_conversation',
    {
      title: 'Get conversation',
      description:
        'Read a single conversation by id, including its contact and tags.',
      inputSchema: {
        id: z.string().describe('Conversation id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get conversation' },
    },
    handle(async ({ id }) => jsonResult(await client.getConversation(id)))
  );

  server.registerTool(
    'list_messages',
    {
      title: 'List messages',
      description:
        'List the messages in a conversation, newest first. Each message includes its direction (inbound/outbound), delivery status, and content. Paginated.',
      inputSchema: {
        conversation_id: z
          .string()
          .describe('The conversation to read messages from.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Page size, 1–100 (default 50).'),
        cursor: z.string().optional().describe('Opaque pagination cursor.'),
      },
      annotations: { ...READ_ONLY, title: 'List messages' },
    },
    handle(async ({ conversation_id, limit, cursor }) =>
      jsonResult(
        await client.listConversationMessages(conversation_id, {
          limit,
          cursor,
        })
      )
    )
  );

  server.registerTool(
    'get_broadcast',
    {
      title: 'Get broadcast status',
      description:
        'Read a broadcast campaign by id — its status and delivered / read / rejected counts. Use this to poll progress after launching one.',
      inputSchema: {
        id: z.string().describe('Broadcast id.'),
      },
      annotations: { ...READ_ONLY, title: 'Get broadcast status' },
    },
    handle(async ({ id }) => jsonResult(await client.getBroadcast(id)))
  );
}

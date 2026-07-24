// ============================================================
// MCP server — exposes the workspace's agent tools to external
// MCP clients (Claude, Cursor, custom agents, etc.).
//
// Endpoint: POST /api/mcp/mcp  (streamable HTTP transport)
//
// Auth: existing platform API keys (Authorization: Bearer wak_...).
// Authorization is scopes-only, mirroring the public REST API:
//   - read tools  -> requires the 'contacts:read' scope
//   - write tools -> additionally requires 'contacts:write'
// The key pins the account, so every tool call is scoped to that
// workspace exactly like the in-app helper agent.
// ============================================================

import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { z } from 'zod'

import { requireApiKey } from '@/features/auth/lib/api-context'
import { hasScope } from '@/features/api-keys/lib/scopes'
import {
  buildAssistantTools,
  WRITE_TOOL_NAMES,
  type AssistantToolContext,
} from '@/features/assistant/lib/tools'

export const runtime = 'nodejs'
export const maxDuration = 60

const WRITE_NAMES: readonly string[] = WRITE_TOOL_NAMES

// Schemas/descriptions don't depend on the caller — build one
// template set for registration. `execute` is never invoked on it.
const TOOL_TEMPLATE = buildAssistantTools({
  supabase: null as never,
  accountId: '',
  userId: null,
})

type ToolName = keyof typeof TOOL_TEMPLATE

const handler = createMcpHandler(
  (server) => {
    for (const [name, def] of Object.entries(TOOL_TEMPLATE)) {
      const schema = def.inputSchema as z.ZodObject<z.ZodRawShape>
      server.tool(
        name,
        typeof def.description === 'string' ? def.description : name,
        schema instanceof z.ZodObject ? schema.shape : {},
        async (args: Record<string, unknown>, extra) => {
          const auth = extra.authInfo
          const accountId =
            typeof auth?.extra?.accountId === 'string'
              ? auth.extra.accountId
              : null
          const supabase = auth?.extra?.supabase as
            | AssistantToolContext['supabase']
            | undefined
          if (!auth || !accountId || !supabase) {
            return {
              content: [{ type: 'text' as const, text: 'Unauthorized' }],
              isError: true,
            }
          }

          // Write tools need the write scope; in-chat approval doesn't
          // exist over MCP, so the scope IS the standing approval the
          // key's creator granted when minting it.
          if (
            WRITE_NAMES.includes(name) &&
            !hasScope(auth.scopes ?? [], 'contacts:write')
          ) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: "This API key is missing the 'contacts:write' scope required for write tools.",
                },
              ],
              isError: true,
            }
          }

          const tools = buildAssistantTools({
            supabase,
            accountId,
            userId: null,
          })
          const impl = tools[name as ToolName]
          if (!impl?.execute) {
            return {
              content: [{ type: 'text' as const, text: 'Unknown tool' }],
              isError: true,
            }
          }

          try {
            const result = await (
              impl.execute as unknown as (
                a: Record<string, unknown>,
                o: { toolCallId: string; messages: never[] },
              ) => Promise<unknown>
            )(args, { toolCallId: `mcp_${Date.now()}`, messages: [] })
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    typeof result === 'string'
                      ? result
                      : JSON.stringify(result, null, 2),
                },
              ],
            }
          } catch (err) {
            console.error(`[mcp] tool ${name} failed:`, err)
            return {
              content: [
                { type: 'text' as const, text: 'Tool execution failed' },
              ],
              isError: true,
            }
          }
        },
      )
    }
  },
  {
    serverInfo: { name: 'wacrm-workspace', version: '1.0.0' },
  },
  {
    basePath: '/api/mcp',
    maxDuration: 60,
    verboseLogs: false,
  },
)

// Reuse the platform API-key auth (hashing, revocation, expiry, per-key
// rate limiting). Read scope is the entry requirement; write scope is
// checked per-tool above.
const verifyToken = async (req: Request): Promise<AuthInfo | undefined> => {
  try {
    const ctx = await requireApiKey(req, 'contacts:read')
    return {
      token: 'redacted', // never re-expose the presented key
      clientId: ctx.keyId,
      scopes: ctx.scopes,
      extra: {
        accountId: ctx.accountId,
        keyId: ctx.keyId,
        supabase: ctx.supabase,
      },
    }
  } catch {
    return undefined
  }
}

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
})

export { authHandler as GET, authHandler as POST }

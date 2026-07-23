import { tool } from 'ai'
import { z } from 'zod'
import type { AccountContext } from '@/lib/auth/account'

// ============================================================
// Platform assistant tools.
//
// Access model (user requirement):
//   - READ tools: always allowed. They run on the caller's own
//     RLS-scoped Supabase client, so the agent can never see more
//     than the signed-in user could see themselves.
//   - WRITE tools: NEVER run silently. Every write is approval-gated
//     via ToolLoopAgent `toolApproval: 'user-approval'` in the chat
//     route — the user grants access per call, in the chat.
//
// Every tool result is rendered in the chat transcript ("tools used"
// visibility), so the user always sees what the agent looked at.
// ============================================================

export function buildAssistantTools(ctx: AccountContext) {
  const db = ctx.supabase

  return {
    // ---------- READ TOOLS (no approval needed) ----------

    search_contacts: tool({
      description:
        'Search the workspace contacts by name or phone number. Read-only.',
      inputSchema: z.object({
        query: z.string().min(1).max(80).describe('Name or phone fragment'),
      }),
      execute: async ({ query }) => {
        const { data, error } = await db
          .from('contacts')
          .select('id, name, phone, email, created_at')
          .eq('account_id', ctx.accountId)
          .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
          .order('created_at', { ascending: false })
          .limit(5)
        if (error) return { error: 'Could not search contacts.' }
        return {
          count: data.length,
          contacts: data.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            email: c.email,
          })),
        }
      },
    }),

    list_recent_conversations: tool({
      description:
        'List the most recent WhatsApp conversations with their status. Read-only.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ limit }) => {
        const { data, error } = await db
          .from('conversations')
          .select('id, status, last_message_at, contacts(name, phone)')
          .eq('account_id', ctx.accountId)
          .order('last_message_at', { ascending: false })
          .limit(limit)
        if (error) return { error: 'Could not load conversations.' }
        return {
          conversations: data.map((c) => {
            const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts
            return {
              id: c.id,
              status: c.status,
              contact: contact?.name ?? contact?.phone ?? 'Unknown',
              last_message_at: c.last_message_at,
            }
          }),
        }
      },
    }),

    list_deals: tool({
      description:
        'List deals in the CRM pipeline, optionally filtered by title. Read-only.',
      inputSchema: z.object({
        query: z
          .string()
          .max(80)
          .optional()
          .describe('Optional title filter'),
      }),
      execute: async ({ query }) => {
        let q = db
          .from('deals')
          .select('id, title, value, currency, status, pipeline_stages(name)')
          .eq('account_id', ctx.accountId)
          .order('created_at', { ascending: false })
          .limit(10)
        if (query) q = q.ilike('title', `%${query}%`)
        const { data, error } = await q
        if (error) return { error: 'Could not load deals.' }
        return {
          deals: data.map((d) => {
            const stage = Array.isArray(d.pipeline_stages)
              ? d.pipeline_stages[0]
              : d.pipeline_stages
            return {
              id: d.id,
              title: d.title,
              value: d.value,
              currency: d.currency,
              status: d.status,
              stage: stage?.name ?? null,
            }
          }),
        }
      },
    }),

    list_upcoming_appointments: tool({
      description: 'List upcoming appointments for this workspace. Read-only.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ limit }) => {
        const { data, error } = await db
          .from('appointments')
          .select('id, title, starts_at, status, contacts(name)')
          .eq('account_id', ctx.accountId)
          .gte('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true })
          .limit(limit)
        if (error) return { error: 'Could not load appointments.' }
        return {
          appointments: data.map((a) => {
            const contact = Array.isArray(a.contacts) ? a.contacts[0] : a.contacts
            return {
              id: a.id,
              title: a.title,
              starts_at: a.starts_at,
              status: a.status,
              contact: contact?.name ?? null,
            }
          }),
        }
      },
    }),

    get_ai_agent_status: tool({
      description:
        'Check whether the workspace WhatsApp AI agent is configured and active, and which provider/model it uses. Read-only.',
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await db
          .from('ai_configs')
          .select('provider, model, is_active, auto_reply_enabled')
          .eq('account_id', ctx.accountId)
          .maybeSingle()
        if (error) return { error: 'Could not load agent status.' }
        if (!data) return { configured: false }
        return {
          configured: true,
          provider: data.provider,
          model: data.model,
          active: data.is_active,
          auto_reply: data.auto_reply_enabled,
        }
      },
    }),

    // ---------- WRITE TOOLS (approval-gated in the chat route) ----------

    create_support_ticket: tool({
      description:
        'Create a support ticket for the founder/support team. Use when the user asks for human help, reports a bug, or the question cannot be answered. WRITE action — requires user approval.',
      inputSchema: z.object({
        subject: z.string().min(3).max(200),
        category: z
          .enum(['billing', 'technical', 'channel_setup', 'agent_help', 'other'])
          .default('other'),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
        description: z
          .string()
          .min(10)
          .max(2000)
          .describe('Detailed description of the issue for the support team'),
      }),
      execute: async ({ subject, category, priority, description }) => {
        const { data: ticket, error } = await db
          .from('support_tickets')
          .insert({
            account_id: ctx.accountId,
            created_by: ctx.userId,
            subject,
            category,
            priority,
          })
          .select('id')
          .single()
        if (error || !ticket) return { error: 'Could not create the ticket.' }

        const { error: msgError } = await db
          .from('support_ticket_messages')
          .insert({
            ticket_id: ticket.id,
            author_id: ctx.userId,
            is_admin_reply: false,
            body: description,
          })
        if (msgError) {
          return {
            ticket_id: ticket.id,
            warning:
              'Ticket created, but the description could not be attached. Please add it manually.',
          }
        }
        return {
          ticket_id: ticket.id,
          status: 'open',
          message:
            'Ticket created and routed to the founder support team. They will reply in Support.',
        }
      },
    }),

    add_contact_note: tool({
      description:
        'Add an internal note to a contact record. WRITE action — requires user approval.',
      inputSchema: z.object({
        contact_id: z.string().uuid().describe('Contact id from search_contacts'),
        note: z.string().min(1).max(1000),
      }),
      execute: async ({ contact_id, note }) => {
        // RLS + explicit account scope: the note can only land on a
        // contact the caller's workspace owns.
        const { data: contact } = await db
          .from('contacts')
          .select('id, name')
          .eq('account_id', ctx.accountId)
          .eq('id', contact_id)
          .maybeSingle()
        if (!contact) return { error: 'Contact not found in this workspace.' }

        const { error } = await db.from('contact_notes').insert({
          contact_id,
          user_id: ctx.userId,
          note_text: note,
        })
        if (error) return { error: 'Could not save the note.' }
        return { saved: true, contact: contact.name }
      },
    }),
  }
}

/** Tool names that mutate data — approval-gated in the chat route. */
export const WRITE_TOOL_NAMES = [
  'create_support_ticket',
  'add_contact_note',
] as const

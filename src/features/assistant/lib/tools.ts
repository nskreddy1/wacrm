import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Platform assistant tools — full application coverage.
//
// Access model (user requirement):
//   - READ tools: always allowed. Every query is EXPLICITLY scoped
//     to the caller's account via `.eq('account_id', ...)`, so the
//     same tool set is safe on both the RLS-scoped client (widget)
//     and the service-role client (MCP server, where the API key
//     already proved account membership).
//   - WRITE tools: NEVER run silently. Every write is approval-gated
//     in the chat route — the user grants access per call, in chat.
//
// Every tool result renders in the transcript ("tools used"
// visibility), so the user always sees what the agent looked at.
// ============================================================

export interface AssistantToolContext {
  supabase: SupabaseClient;
  accountId: string;
  /** Null for MCP callers authenticated by account-level API key. */
  userId: string | null;
}

/** The filter builder shape countRows callers narrow with. Keeping it
 *  structural (rather than importing PostgrestFilterBuilder's five type
 *  params) keeps call sites simple while staying fully typed. */
type CountQuery = {
  eq(column: string, value: string): CountQuery;
  gte(column: string, value: string): CountQuery;
  in(column: string, values: string[]): CountQuery;
  then<T>(
    onfulfilled: (value: { count: number | null; error: unknown }) => T
  ): Promise<T>;
};

/** Count helper: exact count without fetching rows. */
async function countRows(
  db: SupabaseClient,
  table: string,
  accountId: string,
  extra?: (q: CountQuery) => CountQuery
): Promise<number | null> {
  let q = db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId) as unknown as CountQuery;
  if (extra) q = extra(q);
  const { count, error } = await q.then((res) => res);
  return error ? null : (count ?? 0);
}

export function buildAssistantTools(ctx: AssistantToolContext) {
  const db = ctx.supabase;

  return {
    // ---------- READ TOOLS (no approval needed) ----------

    get_workspace_overview: tool({
      description:
        'Get workspace-wide counts: total contacts, deals, open conversations, upcoming appointments, broadcasts, templates, automations, open tasks and open support tickets. Use this FIRST for any "how many…" question. Read-only.',
      inputSchema: z.object({}),
      execute: async () => {
        const nowIso = new Date().toISOString();
        const [
          contacts,
          deals,
          openConversations,
          upcomingAppointments,
          broadcasts,
          templates,
          flows,
          openTasks,
          openTickets,
        ] = await Promise.all([
          countRows(db, 'contacts', ctx.accountId),
          countRows(db, 'deals', ctx.accountId),
          countRows(db, 'conversations', ctx.accountId, (q) =>
            q.eq('status', 'open')
          ),
          countRows(db, 'appointments', ctx.accountId, (q) =>
            q.gte('starts_at', nowIso)
          ),
          countRows(db, 'broadcasts', ctx.accountId),
          countRows(db, 'message_templates', ctx.accountId),
          countRows(db, 'flows', ctx.accountId),
          countRows(db, 'tasks', ctx.accountId, (q) => q.eq('status', 'open')),
          countRows(db, 'support_tickets', ctx.accountId, (q) =>
            q.in('status', ['open', 'pending'])
          ),
        ]);
        return {
          contacts,
          deals,
          open_conversations: openConversations,
          upcoming_appointments: upcomingAppointments,
          broadcasts,
          message_templates: templates,
          workflows: flows,
          open_tasks: openTasks,
          open_support_tickets: openTickets,
        };
      },
    }),

    list_contacts: tool({
      description:
        'List workspace contacts with pagination and the exact total count. Optionally filter by name/phone/email. Use for "how many contacts", "show my contacts", etc. Read-only.',
      inputSchema: z.object({
        search: z.string().max(80).optional().describe('Optional filter'),
        page: z.number().int().min(1).default(1),
        page_size: z.number().int().min(1).max(25).default(10),
      }),
      execute: async ({ search, page, page_size }) => {
        let q = db
          .from('contacts')
          .select('id, name, phone, email, created_at', { count: 'exact' })
          .eq('account_id', ctx.accountId)
          .order('created_at', { ascending: false })
          .range((page - 1) * page_size, page * page_size - 1);
        if (search) {
          q = q.or(
            `name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
          );
        }
        const { data, count, error } = await q;
        if (error) return { error: 'Could not list contacts.' };
        return {
          total_contacts: count ?? 0,
          page,
          contacts: (data ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            email: c.email,
          })),
        };
      },
    }),

    get_contact_details: tool({
      description:
        'Full profile of one contact: their deals (with values and stages), recent notes, tasks and upcoming appointments. Use when asked whether a contact has deals, or for any per-contact question. Accepts a contact id OR a name/phone to look up. Read-only.',
      inputSchema: z.object({
        contact_id: z.string().uuid().optional(),
        query: z
          .string()
          .max(80)
          .optional()
          .describe('Name or phone if id is unknown'),
      }),
      execute: async ({ contact_id, query }) => {
        let contact: {
          id: string;
          name: string | null;
          phone: string | null;
          email: string | null;
        } | null = null;

        if (contact_id) {
          const { data } = await db
            .from('contacts')
            .select('id, name, phone, email')
            .eq('account_id', ctx.accountId)
            .eq('id', contact_id)
            .maybeSingle();
          contact = data;
        } else if (query) {
          const { data } = await db
            .from('contacts')
            .select('id, name, phone, email')
            .eq('account_id', ctx.accountId)
            .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
            .limit(1)
            .maybeSingle();
          contact = data;
        }
        if (!contact) {
          return { error: 'Contact not found. Provide contact_id or query.' };
        }

        const [deals, notes, tasks, appointments] = await Promise.all([
          db
            .from('deals')
            .select('id, title, value, currency, status, pipeline_stages(name)')
            .eq('account_id', ctx.accountId)
            .eq('contact_id', contact.id)
            .limit(10),
          db
            .from('contact_notes')
            .select('note_text, created_at')
            .eq('contact_id', contact.id)
            .order('created_at', { ascending: false })
            .limit(5),
          db
            .from('tasks')
            .select('title, status, due_at')
            .eq('account_id', ctx.accountId)
            .eq('contact_id', contact.id)
            .limit(5),
          db
            .from('appointments')
            .select('title, starts_at, status')
            .eq('account_id', ctx.accountId)
            .eq('contact_id', contact.id)
            .gte('starts_at', new Date().toISOString())
            .limit(5),
        ]);

        return {
          contact,
          has_deals: (deals.data?.length ?? 0) > 0,
          deals: (deals.data ?? []).map((d) => {
            const stage = Array.isArray(d.pipeline_stages)
              ? d.pipeline_stages[0]
              : d.pipeline_stages;
            return {
              title: d.title,
              value: d.value,
              currency: d.currency,
              status: d.status,
              stage: (stage as { name?: string } | null)?.name ?? null,
            };
          }),
          recent_notes: notes.data ?? [],
          tasks: tasks.data ?? [],
          upcoming_appointments: appointments.data ?? [],
        };
      },
    }),

    search_contacts: tool({
      description:
        'Quick contact search by name or phone (top 5 matches). Read-only.',
      inputSchema: z.object({
        query: z.string().min(1).max(80).describe('Name or phone fragment'),
      }),
      execute: async ({ query }) => {
        const { data, error } = await db
          .from('contacts')
          .select('id, name, phone, email')
          .eq('account_id', ctx.accountId)
          .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
          .order('created_at', { ascending: false })
          .limit(5);
        if (error) return { error: 'Could not search contacts.' };
        return { count: data.length, contacts: data };
      },
    }),

    get_pipeline_summary: tool({
      description:
        'Summarize the CRM pipeline: deals per stage with total values, plus won/lost/open counts. Use for "summarize my pipeline" or revenue questions. Read-only.',
      inputSchema: z.object({}),
      execute: async () => {
        const [dealsRes, stagesRes] = await Promise.all([
          db
            .from('deals')
            .select('id, value, currency, status, stage_id')
            .eq('account_id', ctx.accountId)
            .limit(1000),
          db.from('pipeline_stages').select('id, name').limit(100),
        ]);
        if (dealsRes.error) return { error: 'Could not load deals.' };
        const stageName = new Map(
          (stagesRes.data ?? []).map((s) => [s.id, s.name as string])
        );
        const byStage: Record<
          string,
          { deals: number; total_value: number; currency: string | null }
        > = {};
        let won = 0;
        let lost = 0;
        let open = 0;
        for (const d of dealsRes.data ?? []) {
          const key = stageName.get(d.stage_id) ?? 'No stage';
          byStage[key] ??= { deals: 0, total_value: 0, currency: null };
          byStage[key].deals += 1;
          byStage[key].total_value += Number(d.value ?? 0);
          byStage[key].currency ??= d.currency ?? null;
          if (d.status === 'won') won += 1;
          else if (d.status === 'lost') lost += 1;
          else open += 1;
        }
        return {
          total_deals: dealsRes.data?.length ?? 0,
          open,
          won,
          lost,
          stages: byStage,
        };
      },
    }),

    list_deals: tool({
      description:
        'List deals with contact, value and stage, optionally filtered by title. Read-only.',
      inputSchema: z.object({
        query: z.string().max(80).optional().describe('Optional title filter'),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ query, limit }) => {
        let q = db
          .from('deals')
          .select(
            'id, title, value, currency, status, pipeline_stages(name), contacts(name)'
          )
          .eq('account_id', ctx.accountId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (query) q = q.ilike('title', `%${query}%`);
        const { data, error } = await q;
        if (error) return { error: 'Could not load deals.' };
        return {
          count: data.length,
          deals: data.map((d) => {
            const stage = Array.isArray(d.pipeline_stages)
              ? d.pipeline_stages[0]
              : d.pipeline_stages;
            const contact = Array.isArray(d.contacts)
              ? d.contacts[0]
              : d.contacts;
            return {
              id: d.id,
              title: d.title,
              value: d.value,
              currency: d.currency,
              status: d.status,
              stage: (stage as { name?: string } | null)?.name ?? null,
              contact: (contact as { name?: string } | null)?.name ?? null,
            };
          }),
        };
      },
    }),

    list_recent_conversations: tool({
      description:
        'List the most recent WhatsApp conversations with status and contact. Read-only.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(15).default(5),
        status: z.enum(['open', 'closed', 'all']).default('all'),
      }),
      execute: async ({ limit, status }) => {
        let q = db
          .from('conversations')
          .select('id, status, last_message_at, contacts(name, phone)')
          .eq('account_id', ctx.accountId)
          .order('last_message_at', { ascending: false })
          .limit(limit);
        if (status !== 'all') q = q.eq('status', status);
        const { data, error } = await q;
        if (error) return { error: 'Could not load conversations.' };
        return {
          conversations: data.map((c) => {
            const contact = Array.isArray(c.contacts)
              ? c.contacts[0]
              : c.contacts;
            const ct = contact as { name?: string; phone?: string } | null;
            return {
              id: c.id,
              status: c.status,
              contact: ct?.name ?? ct?.phone ?? 'Unknown',
              last_message_at: c.last_message_at,
            };
          }),
        };
      },
    }),

    get_conversation_messages: tool({
      description:
        'Read the latest messages of one conversation (id from list_recent_conversations). Read-only.',
      inputSchema: z.object({
        conversation_id: z.string().uuid(),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ conversation_id, limit }) => {
        // Ownership check first: the conversation must belong to this
        // workspace (messages has no account_id of its own).
        const { data: convo } = await db
          .from('conversations')
          .select('id')
          .eq('account_id', ctx.accountId)
          .eq('id', conversation_id)
          .maybeSingle();
        if (!convo)
          return { error: 'Conversation not found in this workspace.' };

        const { data, error } = await db
          .from('messages')
          .select('sender_type, content_type, content_text, status, created_at')
          .eq('conversation_id', conversation_id)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) return { error: 'Could not load messages.' };
        return { messages: (data ?? []).reverse() };
      },
    }),

    list_upcoming_appointments: tool({
      description: 'List upcoming appointments for this workspace. Read-only.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(15).default(5),
      }),
      execute: async ({ limit }) => {
        const { data, error } = await db
          .from('appointments')
          .select('id, title, starts_at, status, contacts(name)')
          .eq('account_id', ctx.accountId)
          .gte('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true })
          .limit(limit);
        if (error) return { error: 'Could not load appointments.' };
        return {
          appointments: data.map((a) => {
            const contact = Array.isArray(a.contacts)
              ? a.contacts[0]
              : a.contacts;
            return {
              id: a.id,
              title: a.title,
              starts_at: a.starts_at,
              status: a.status,
              contact: (contact as { name?: string } | null)?.name ?? null,
            };
          }),
        };
      },
    }),

    list_broadcasts: tool({
      description:
        'List broadcast campaigns with status and recipient counts. Read-only.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(15).default(5),
      }),
      execute: async ({ limit }) => {
        const { data, error } = await db
          .from('broadcasts')
          .select(
            'id, name, status, total_recipients, scheduled_at, created_at'
          )
          .eq('account_id', ctx.accountId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) return { error: 'Could not load broadcasts.' };
        return { broadcasts: data ?? [] };
      },
    }),

    list_templates: tool({
      description:
        'List WhatsApp message templates with category and status. Read-only.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ limit }) => {
        const { data, error } = await db
          .from('message_templates')
          .select('id, name, category, language, status')
          .eq('account_id', ctx.accountId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) return { error: 'Could not load templates.' };
        return { templates: data ?? [] };
      },
    }),

    list_automations: tool({
      description:
        'List workflows (flows) with their trigger and status. Read-only.',
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await db
          .from('flows')
          .select('id, name, status, trigger_type')
          .eq('account_id', ctx.accountId)
          .order('updated_at', { ascending: false })
          .limit(30);
        if (error) return { error: 'Could not load workflows.' };
        return { workflows: data ?? [] };
      },
    }),

    list_tasks: tool({
      description: 'List CRM tasks, filterable by status. Read-only.',
      inputSchema: z.object({
        status: z.enum(['open', 'done', 'all']).default('open'),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ status, limit }) => {
        let q = db
          .from('tasks')
          .select('id, title, status, priority, due_at, contacts(name)')
          .eq('account_id', ctx.accountId)
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(limit);
        if (status !== 'all') q = q.eq('status', status);
        const { data, error } = await q;
        if (error) return { error: 'Could not load tasks.' };
        return {
          tasks: (data ?? []).map((t) => {
            const contact = Array.isArray(t.contacts)
              ? t.contacts[0]
              : t.contacts;
            return {
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              due_at: t.due_at,
              contact: (contact as { name?: string } | null)?.name ?? null,
            };
          }),
        };
      },
    }),

    list_support_tickets: tool({
      description:
        "List this workspace's support tickets and their status. Read-only.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(15).default(5),
      }),
      execute: async ({ limit }) => {
        const { data, error } = await db
          .from('support_tickets')
          .select('id, subject, category, priority, status, created_at')
          .eq('account_id', ctx.accountId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) return { error: 'Could not load tickets.' };
        return { tickets: data ?? [] };
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
          .maybeSingle();
        if (error) return { error: 'Could not load agent status.' };
        if (!data) return { configured: false };
        return {
          configured: true,
          provider: data.provider,
          model: data.model,
          active: data.is_active,
          auto_reply: data.auto_reply_enabled,
        };
      },
    }),

    // ---------- WRITE TOOLS (approval-gated in the chat route) ----------

    create_contact: tool({
      description:
        'Create a new contact in the CRM. WRITE action — requires user approval.',
      inputSchema: z.object({
        name: z.string().min(1).max(120),
        phone: z.string().min(5).max(30),
        email: z.string().email().optional(),
      }),
      execute: async ({ name, phone, email }) => {
        const { data: existing } = await db
          .from('contacts')
          .select('id')
          .eq('account_id', ctx.accountId)
          .eq('phone', phone)
          .maybeSingle();
        if (existing) {
          return { error: 'A contact with this phone number already exists.' };
        }
        const { data, error } = await db
          .from('contacts')
          .insert({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            name,
            phone,
            email: email ?? null,
          })
          .select('id')
          .single();
        if (error || !data) return { error: 'Could not create the contact.' };
        return { created: true, contact_id: data.id, name };
      },
    }),

    create_task: tool({
      description:
        'Create a CRM task, optionally linked to a contact. WRITE action — requires user approval.',
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        notes: z.string().max(1000).optional(),
        due_at: z
          .string()
          .datetime()
          .optional()
          .describe('ISO timestamp, optional'),
        priority: z.enum(['low', 'medium', 'high']).default('medium'),
        contact_id: z.string().uuid().optional(),
      }),
      execute: async ({ title, notes, due_at, priority, contact_id }) => {
        if (contact_id) {
          const { data: contact } = await db
            .from('contacts')
            .select('id')
            .eq('account_id', ctx.accountId)
            .eq('id', contact_id)
            .maybeSingle();
          if (!contact)
            return { error: 'Contact not found in this workspace.' };
        }
        const { data, error } = await db
          .from('tasks')
          .insert({
            account_id: ctx.accountId,
            created_by: ctx.userId,
            title,
            notes: notes ?? null,
            due_at: due_at ?? null,
            priority,
            contact_id: contact_id ?? null,
          })
          .select('id')
          .single();
        if (error || !data) return { error: 'Could not create the task.' };
        return { created: true, task_id: data.id, title };
      },
    }),

    add_contact_note: tool({
      description:
        'Add an internal note to a contact record. WRITE action — requires user approval.',
      inputSchema: z.object({
        contact_id: z
          .string()
          .uuid()
          .describe('Contact id from search_contacts'),
        note: z.string().min(1).max(1000),
      }),
      execute: async ({ contact_id, note }) => {
        const { data: contact } = await db
          .from('contacts')
          .select('id, name')
          .eq('account_id', ctx.accountId)
          .eq('id', contact_id)
          .maybeSingle();
        if (!contact) return { error: 'Contact not found in this workspace.' };

        const { error } = await db.from('contact_notes').insert({
          contact_id,
          user_id: ctx.userId,
          note_text: note,
        });
        if (error) return { error: 'Could not save the note.' };
        return { saved: true, contact: contact.name };
      },
    }),

    create_workflow: tool({
      description:
        'Create a complete WhatsApp workflow (flow) end-to-end: trigger + a linear sequence of steps, saved as a draft the user can open, edit and activate in the visual builder. Use when the user asks to "create a workflow/flow/automation" like a welcome message, keyword auto-reply, follow-up sequence, or office-hours responder. WRITE action — requires user approval.',
      inputSchema: z.object({
        name: z.string().min(2).max(120).describe('Workflow name'),
        description: z.string().max(300).optional(),
        trigger: z
          .enum([
            'keyword',
            'first_inbound_message',
            'new_message_received',
            'new_contact_created',
            'manual',
          ])
          .describe('What starts the workflow'),
        keywords: z
          .array(z.string().min(1).max(50))
          .max(10)
          .optional()
          .describe('Required when trigger is "keyword"'),
        steps: z
          .array(
            z.discriminatedUnion('type', [
              z.object({
                type: z.literal('send_message'),
                text: z
                  .string()
                  .min(1)
                  .max(1000)
                  .describe(
                    'Message text. Supports {{vars.x}} interpolation.'
                  ),
              }),
              z.object({
                type: z.literal('send_template'),
                template_name: z.string().min(1).max(120),
                language: z.string().max(10).default('en_US'),
              }),
              z.object({
                type: z.literal('collect_input'),
                question: z.string().min(1).max(500),
                save_key: z
                  .string()
                  .min(1)
                  .max(40)
                  .describe('Variable name the reply is saved under'),
              }),
              z.object({
                type: z.literal('wait'),
                amount: z.number().int().min(1).max(720),
                unit: z.enum(['minutes', 'hours', 'days']),
              }),
              z.object({
                type: z.literal('close_conversation'),
              }),
              z.object({
                type: z.literal('handoff'),
                note: z.string().max(300).optional(),
              }),
            ])
          )
          .min(1)
          .max(15)
          .describe('Linear step sequence, executed in order'),
      }),
      execute: async ({ name, description, trigger, keywords, steps }) => {
        if (trigger === 'keyword' && (!keywords || keywords.length === 0)) {
          return { error: 'Keyword trigger requires at least one keyword.' };
        }

        // Build the node chain: step-1 → step-2 → … → end. Keys are
        // deterministic so the summary reads cleanly in the builder.
        const nodeKeys = steps.map((s, i) => `step-${i + 1}-${s.type}`);
        const nodes: {
          node_key: string;
          node_type: string;
          config: Record<string, unknown>;
        }[] = steps.map((step, i) => {
          const next = nodeKeys[i + 1] ?? 'end';
          let config: Record<string, unknown>;
          switch (step.type) {
            case 'send_message':
              config = { text: step.text, next_node_key: next };
              break;
            case 'send_template':
              config = {
                template_name: step.template_name,
                language: step.language,
                variables: {},
                next_node_key: next,
              };
              break;
            case 'collect_input':
              config = {
                question: step.question,
                save_key: step.save_key,
                next_node_key: next,
              };
              break;
            case 'wait':
              config = {
                amount: step.amount,
                unit: step.unit,
                next_node_key: next,
              };
              break;
            case 'close_conversation':
              config = { next_node_key: next };
              break;
            case 'handoff':
              config = { note: step.note ?? '' };
              break;
          }
          return { node_key: nodeKeys[i], node_type: step.type, config };
        });
        nodes.push({ node_key: 'end', node_type: 'end', config: {} });

        const trigger_config: Record<string, unknown> =
          trigger === 'keyword'
            ? { keywords: keywords!.map((k) => k.trim().toLowerCase()) }
            : {};

        const { data: flow, error: flowErr } = await db
          .from('flows')
          .insert({
            account_id: ctx.accountId,
            user_id: ctx.userId,
            name: name.trim(),
            description: description ?? null,
            status: 'draft',
            trigger_type: trigger,
            trigger_config,
            entry_node_id: nodeKeys[0],
          })
          .select('id')
          .single();
        if (flowErr || !flow) {
          return { error: 'Could not create the workflow.' };
        }

        const { error: nodesErr } = await db.from('flow_nodes').insert(
          nodes.map((n) => ({
            flow_id: flow.id,
            node_key: n.node_key,
            node_type: n.node_type,
            config: n.config,
          }))
        );
        if (nodesErr) {
          // Roll back so a half-created workflow doesn't linger.
          await db.from('flows').delete().eq('id', flow.id);
          return { error: 'Could not save the workflow steps.' };
        }

        return {
          created: true,
          flow_id: flow.id,
          name,
          status: 'draft',
          steps: nodes.length,
          open_url: `/flows/${flow.id}`,
          message:
            'Workflow created as a draft. Open it in the builder to review and activate.',
        };
      },
    }),

    activate_workflow: tool({
      description:
        'Activate (or pause) an existing workflow by id or name so it starts (or stops) running. WRITE action — requires user approval.',
      inputSchema: z.object({
        flow_id: z.string().uuid().optional(),
        name: z
          .string()
          .max(120)
          .optional()
          .describe('Workflow name if the id is unknown'),
        action: z.enum(['activate', 'pause']).default('activate'),
      }),
      execute: async ({ flow_id, name, action }) => {
        let q = db
          .from('flows')
          .select('id, name, status, entry_node_id')
          .eq('account_id', ctx.accountId)
          .limit(1);
        if (flow_id) q = q.eq('id', flow_id);
        else if (name) q = q.ilike('name', `%${name}%`);
        else return { error: 'Provide flow_id or name.' };

        const { data: flow } = await q.maybeSingle();
        if (!flow) return { error: 'Workflow not found in this workspace.' };
        if (action === 'activate' && !flow.entry_node_id) {
          return {
            error:
              'This workflow has no entry step yet — open it in the builder first.',
          };
        }
        const nextStatus = action === 'activate' ? 'active' : 'paused';
        const { error } = await db
          .from('flows')
          .update({ status: nextStatus })
          .eq('id', flow.id)
          .eq('account_id', ctx.accountId);
        if (error) return { error: 'Could not update the workflow status.' };
        return { updated: true, name: flow.name, status: nextStatus };
      },
    }),

    create_support_ticket: tool({
      description:
        'Create a support ticket for the founder/support team. Use when the user asks for human help, reports a bug, or the question cannot be answered. WRITE action — requires user approval.',
      inputSchema: z.object({
        subject: z.string().min(3).max(200),
        category: z
          .enum([
            'billing',
            'technical',
            'channel_setup',
            'agent_help',
            'other',
          ])
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
          .single();
        if (error || !ticket) return { error: 'Could not create the ticket.' };

        const { error: msgError } = await db
          .from('support_ticket_messages')
          .insert({
            ticket_id: ticket.id,
            author_id: ctx.userId,
            is_admin_reply: false,
            body: description,
          });
        if (msgError) {
          return {
            ticket_id: ticket.id,
            warning:
              'Ticket created, but the description could not be attached. Please add it manually.',
          };
        }
        return {
          ticket_id: ticket.id,
          status: 'open',
          message:
            'Ticket created and routed to the founder support team. They will reply in Support.',
        };
      },
    }),
  };
}

/** Tool names that mutate data — approval-gated in the chat route. */
export const WRITE_TOOL_NAMES = [
  'create_contact',
  'create_task',
  'add_contact_note',
  'create_workflow',
  'activate_workflow',
  'create_support_ticket',
] as const;

/** Read-only tool names — safe to expose on the MCP server without approval. */
export const READ_TOOL_NAMES = [
  'get_workspace_overview',
  'list_contacts',
  'get_contact_details',
  'search_contacts',
  'get_pipeline_summary',
  'list_deals',
  'list_recent_conversations',
  'get_conversation_messages',
  'list_upcoming_appointments',
  'list_broadcasts',
  'list_templates',
  'list_automations',
  'list_tasks',
  'list_support_tickets',
  'get_ai_agent_status',
] as const;

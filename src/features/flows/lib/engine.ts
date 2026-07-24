/**
 * Flow runner.
 *
 * The single entry point `dispatchInboundToFlows` is called by the
 * WhatsApp webhook on every inbound message *for an account that has
 * opted into the Flows beta*. It decides whether the message belongs
 * to an active conversation flow (advance it) or matches the entry
 * trigger of an active flow (start a new run) — and reports back to
 * the webhook so the webhook knows whether to also fire automations.
 *
 * Architecture in a sentence: the runner walks the customer through
 * a DB-stored node graph, suspending only at nodes that need
 * customer input. Each tap or text reply wakes it back up.
 *
 * What lives here vs elsewhere:
 *   - Pure decision logic (which button matched, where to advance to,
 *     when to fallback) — here.
 *   - DB shape (table reads/writes) — here.
 *   - Meta API calls — `meta-send.ts` (engineSendInteractive*).
 *   - Policy resolution (reprompt vs handoff vs end) — `fallback.ts`.
 *   - Type definitions — `types.ts`.
 *
 * Concurrency model:
 *   - Idempotency on `meta_message_id`: the legacy field stores any
 *     provider's external message ID, so retries cannot advance a run twice.
 *   - Optimistic UPDATE with `current_node_key` precondition: two
 *     simultaneous taps for the same run collide at the DB layer; the
 *     second is a no-op.
 *   - Partial unique index `idx_one_active_run_per_contact`: two
 *     simultaneous starts for the same contact collide; the second
 *     INSERT raises 23505 and the runner catches & exits.
 */

import { supabaseAdmin } from './admin-client';
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from './meta-send';
import { decideFallback, resolveFallbackPolicy } from './fallback';
import { executeActionNode, isActionNodeType } from './action-nodes';
import {
  type CollectInputNodeConfig,
  type ConditionNodeConfig,
  type DispatchInboundInput,
  type DispatchInboundResult,
  type FlowNodeRow,
  type FlowRow,
  type FlowRunRow,
  type ParsedInbound,
  type SendButtonsNodeConfig,
  type SendListNodeConfig,
  type SendMediaNodeConfig,
  type SendMessageNodeConfig,
  type SetTagNodeConfig,
  type StartNodeConfig,
  type KeywordTriggerConfig,
} from './types';

// ============================================================
// Pure helpers — extracted so engine.test.ts can exercise them
// without a Supabase / Meta mock.
// ============================================================

/**
 * Given a node + the customer's reply_id, return the next_node_key
 * to advance to, or `null` if no option matches.
 */
export function matchReplyId(
  node: { node_type: string; config: Record<string, unknown> },
  reply_id: string
): string | null {
  if (node.node_type === 'send_buttons') {
    const cfg = node.config as unknown as SendButtonsNodeConfig;
    const hit = cfg.buttons?.find((b) => b.reply_id === reply_id);
    return hit?.next_node_key ?? null;
  }
  if (node.node_type === 'send_list') {
    const cfg = node.config as unknown as SendListNodeConfig;
    for (const section of cfg.sections ?? []) {
      const hit = section.rows?.find((r) => r.reply_id === reply_id);
      if (hit) return hit.next_node_key;
    }
    return null;
  }
  return null;
}

/**
 * Case-insensitive contains/exact match against a list of keywords.
 * Used by the trigger evaluator. Stable enough that the v3 builder
 * UI can preview matches by passing canned strings.
 */
export function matchesKeywordTrigger(
  text: string,
  cfg: KeywordTriggerConfig
): boolean {
  if (!text || !cfg.keywords?.length) return false;
  const matchType = cfg.match_type ?? 'contains';
  const haystack = cfg.case_sensitive ? text : text.toLowerCase();
  for (const raw of cfg.keywords) {
    if (!raw) continue;
    const needle = cfg.case_sensitive ? raw : raw.toLowerCase();
    if (
      matchType === 'exact' ? haystack === needle : haystack.includes(needle)
    ) {
      return true;
    }
  }
  return false;
}

/** Nodes that advance to a next_node_key without waiting for input. */
export function isAutoAdvancing(node_type: string): boolean {
  return (
    node_type === 'start' ||
    node_type === 'send_message' ||
    node_type === 'send_media' ||
    node_type === 'condition' ||
    node_type === 'set_tag' ||
    // Absorbed action nodes auto-advance — except `wait`, which
    // parks the run until the cron sweep wakes it at wake_at.
    (isActionNodeType(node_type) && node_type !== 'wait')
  );
}

/** Nodes that send a prompt and suspend awaiting a customer reply. */
export function isSuspending(node_type: string): boolean {
  return (
    node_type === 'send_buttons' ||
    node_type === 'send_list' ||
    node_type === 'collect_input' ||
    // `wait` also suspends — resumed by time, not by a reply.
    node_type === 'wait'
  );
}

/** Nodes that end the run. */
export function isTerminal(node_type: string): boolean {
  return node_type === 'handoff' || node_type === 'end';
}

/**
 * Evaluate a `condition` node's predicate against the current run
 * state. Exported pure for unit testing — the engine wraps it with a
 * DB lookup for `tag` / `contact_field` subjects.
 */
export function evaluateConditionPredicate(args: {
  operator: ConditionNodeConfig['operator'];
  /**
   * Resolved value of the subject. `undefined` means the subject is
   * absent (no var with that key / no such tag / contact field is
   * null). Pure function: caller does the DB lookup.
   */
  subjectValue: string | undefined;
  /** The configured comparison value, when applicable. */
  configValue: string | undefined;
}): boolean {
  switch (args.operator) {
    case 'present':
      return args.subjectValue !== undefined && args.subjectValue !== '';
    case 'absent':
      return args.subjectValue === undefined || args.subjectValue === '';
    case 'equals':
      if (args.subjectValue === undefined) return false;
      return args.subjectValue === (args.configValue ?? '');
    case 'contains':
      if (args.subjectValue === undefined) return false;
      return args.subjectValue.includes(args.configValue ?? '');
  }
}

// ============================================================
// DB I/O — wrapped in tiny helpers so the dispatch flow stays
// readable. Errors surface as thrown — the entry point catches.
// ============================================================

type AdminClient = ReturnType<typeof supabaseAdmin>;

async function loadActiveRunForContact(
  db: AdminClient,
  accountId: string,
  contactId: string
): Promise<FlowRunRow | null> {
  // The partial unique index `idx_one_active_run_per_contact` was
  // rebuilt in migration 017 over `(account_id, contact_id)` — so
  // "two active runs for one contact in one account" is impossible
  // by design. But a future migration glitch or manual SQL could
  // create one, and .maybeSingle() throws on >1 row — which would
  // kill dispatch for that contact's webhook entirely. .limit(1) is
  // forgiving: pick the newest, let the cron sweep clean up the
  // stale one.
  const { data, error } = await db
    .from('flow_runs')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[flows] loadActiveRunForContact error:', error.message);
    return null;
  }
  const rows = (data as FlowRunRow[] | null) ?? [];
  return rows[0] ?? null;
}

async function loadFlow(
  db: AdminClient,
  flowId: string
): Promise<FlowRow | null> {
  const { data, error } = await db
    .from('flows')
    .select('*')
    .eq('id', flowId)
    .maybeSingle();
  if (error) {
    console.error('[flows] loadFlow error:', error.message);
    return null;
  }
  return (data as FlowRow | null) ?? null;
}

/**
 * Load every node of a flow in one round trip and key them by
 * `node_key`. The advance loop is then in-memory — a 5-node
 * auto-advancing chain costs one SELECT, not five.
 *
 * Returns an empty map on error so the caller can still dispatch
 * cleanly (every subsequent .get() returns undefined → the run
 * fails with node_not_found, same as the old per-node lookup).
 */
async function loadAllNodes(
  db: AdminClient,
  flowId: string
): Promise<Map<string, FlowNodeRow>> {
  const { data, error } = await db
    .from('flow_nodes')
    .select('*')
    .eq('flow_id', flowId);
  if (error) {
    console.error('[flows] loadAllNodes error:', error.message);
    return new Map();
  }
  const map = new Map<string, FlowNodeRow>();
  for (const row of (data ?? []) as FlowNodeRow[]) {
    map.set(row.node_key, row);
  }
  return map;
}

async function logEvent(
  db: AdminClient,
  flowRunId: string,
  event_type:
    | 'started'
    | 'node_entered'
    | 'message_sent'
    | 'reply_received'
    | 'fallback_fired'
    | 'handoff'
    | 'timeout'
    | 'error'
    | 'completed',
  node_key: string | null,
  payload: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await db.from('flow_run_events').insert({
    flow_run_id: flowRunId,
    event_type,
    node_key,
    payload,
  });
  if (error) {
    // Logging failure is non-fatal — surface but don't throw.
    console.error('[flows] logEvent error:', error.message);
  }
}

/**
 * Idempotency check — has a `reply_received` event with this Meta
 * message_id already been recorded for any of the contact's flow
 * runs? If yes, the inbound is a duplicate (Meta retry) and we
 * exit without re-advancing.
 *
 * Implementation note: scoped to runs belonging to this user/contact
 * so the lookup is cheap (the index on flow_run_events(flow_run_id,
 * event_type) plus the small set of runs per contact).
 */
async function isDuplicateInbound(
  db: AdminClient,
  accountId: string,
  contactId: string,
  metaMessageId: string
): Promise<boolean> {
  // Fetch ALL run ids for this contact in this account (active +
  // historical). Bounded by how many flows the customer has been
  // through — small.
  const { data: runs } = await db
    .from('flow_runs')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId);
  if (!runs?.length) return false;
  const runIds = runs.map((r) => (r as { id: string }).id);

  const { count } = await db
    .from('flow_run_events')
    .select('id', { count: 'exact', head: true })
    .in('flow_run_id', runIds)
    .eq('event_type', 'reply_received')
    .filter('payload->>meta_message_id', 'eq', metaMessageId);
  return (count ?? 0) > 0;
}

async function findEntryFlow(
  db: AdminClient,
  accountId: string,
  message: ParsedInbound,
  isFirstInbound: boolean
): Promise<FlowRow | null> {
  // Only text messages can match an entry trigger. Interactive replies
  // are responses to existing prompts; they never start a new flow.
  if (message.kind !== 'text') return null;

  // Pull all active flows for this account. Active set is bounded
  // (the builder discourages double-trigger overlap; partial index
  // makes the lookup index-supported).
  const { data: flows, error } = await db
    .from('flows')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (error || !flows) return null;

  const typed = flows as FlowRow[];
  for (const flow of typed) {
    if (flow.trigger_type === 'keyword') {
      if (
        matchesKeywordTrigger(
          message.text,
          flow.trigger_config as KeywordTriggerConfig
        )
      ) {
        return flow;
      }
    } else if (
      flow.trigger_type === 'first_inbound_message' &&
      isFirstInbound
    ) {
      return flow;
    } else if (flow.trigger_type === 'new_message_received') {
      // Absorbed automation trigger: fires on ANY inbound text (not
      // just the first). Keyword flows are checked earlier in the
      // loop, so a more specific match still wins by flow order.
      return flow;
    }
    // 'manual' / 'tag_added' / 'conversation_assigned' / 'scheduled' /
    // 'new_contact_created' / 'interactive_reply' start via
    // dispatchEventToFlows or the cron sweep, not inbound text.
  }
  return null;
}

// ============================================================
// Node executors — each handles ONE node type. send_buttons and
// send_list also persist `last_prompt_message_id` so the inbox
// thread can quote the prompt the customer is replying to.
// ============================================================

async function sendButtonsAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow
): Promise<{ outcome: 'advanced'; node_key: string }> {
  const cfg = node.config as unknown as SendButtonsNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveButtons({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    buttons: cfg.buttons.map((b) => ({ id: b.reply_id, title: b.title })),
  });
  await logEvent(db, run.id, 'message_sent', node.node_key, {
    node_type: 'send_buttons',
    whatsapp_message_id,
  });
  // Look up our internal message id so we can stash it on the run.
  // Cheap — indexed on `messages.message_id`.
  const { data: msg } = await db
    .from('messages')
    .select('id')
    .eq('message_id', whatsapp_message_id)
    .maybeSingle();
  await db
    .from('flow_runs')
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq('id', run.id);
  return { outcome: 'advanced', node_key: node.node_key };
}

async function sendListAndSuspend(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow
): Promise<{ outcome: 'advanced'; node_key: string }> {
  const cfg = node.config as unknown as SendListNodeConfig;
  const { whatsapp_message_id } = await engineSendInteractiveList({
    accountId: run.account_id,
    userId: run.user_id,
    conversationId: run.conversation_id!,
    contactId: run.contact_id!,
    bodyText: cfg.text,
    buttonLabel: cfg.button_label,
    headerText: cfg.header_text,
    footerText: cfg.footer_text,
    sections: cfg.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({
        id: r.reply_id,
        title: r.title,
        description: r.description,
      })),
    })),
  });
  await logEvent(db, run.id, 'message_sent', node.node_key, {
    node_type: 'send_list',
    whatsapp_message_id,
  });
  const { data: msg } = await db
    .from('messages')
    .select('id')
    .eq('message_id', whatsapp_message_id)
    .maybeSingle();
  await db
    .from('flow_runs')
    .update({
      last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
    })
    .eq('id', run.id);
  return { outcome: 'advanced', node_key: node.node_key };
}

async function executeHandoff(
  db: AdminClient,
  run: FlowRunRow,
  node: FlowNodeRow
): Promise<void> {
  const cfg = node.config as { assign_to?: string; note?: string };
  const convUpdate: Record<string, unknown> = {
    status: 'pending',
    updated_at: new Date().toISOString(),
  };
  if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;
  if (run.conversation_id) {
    await db
      .from('conversations')
      .update(convUpdate)
      .eq('id', run.conversation_id);
  }
  await logEvent(db, run.id, 'handoff', node.node_key, {
    note: cfg.note ?? null,
    assigned_to: cfg.assign_to ?? null,
  });
  await endRun(db, run.id, 'handed_off', 'handoff_node');
}

/**
 * Resolve a condition node's subject value from DB / run state, then
 * call the pure `evaluateConditionPredicate`. Splits out so the
 * predicate itself stays unit-testable without a Supabase mock.
 *
 * Subject sources:
 *   - `var` → `flow_runs.vars[subject_key]` (captured by collect_input
 *     or http_fetch in v2).
 *   - `tag` → present iff `contact_tags(contact_id, tag_id)` exists.
 *     `subject_key` IS the tag UUID; the SELECT returns 1 row or 0.
 *   - `contact_field` → one of name/email/phone/company on `contacts`.
 */
async function evaluateConditionNode(
  db: AdminClient,
  run: FlowRunRow,
  cfg: ConditionNodeConfig
): Promise<boolean> {
  let subjectValue: string | undefined;
  if (cfg.subject === 'var') {
    const v = run.vars[cfg.subject_key];
    subjectValue =
      typeof v === 'string' ? v : v === undefined ? undefined : String(v);
  } else if (cfg.subject === 'message_content') {
    // The triggering message text is mirrored into vars at run start
    // (`__message_text`), so no extra DB read is needed here.
    const v = run.vars.__message_text;
    subjectValue = typeof v === 'string' && v.length > 0 ? v : undefined;
  } else if (cfg.subject === 'time_of_day') {
    // subject_key encodes the window as "HH:mm-HH:mm". Inside the
    // window → subjectValue is set (`present` matches); outside →
    // undefined (`absent` matches). Midnight-crossing windows work.
    subjectValue = isNowInWindow(cfg.subject_key) ? cfg.subject_key : undefined;
  } else if (cfg.subject === 'tag') {
    const { count } = await db
      .from('contact_tags')
      .select('contact_id', { count: 'exact', head: true })
      .eq('contact_id', run.contact_id!)
      .eq('tag_id', cfg.subject_key);
    // For tags, "present" really is the only meaningful test — the
    // `present`/`absent` operators are the natural fit. equals/contains
    // against a tag UUID would still work mechanically (compare its
    // existence to the value).
    subjectValue = (count ?? 0) > 0 ? cfg.subject_key : undefined;
  } else {
    const ALLOWED = ['name', 'email', 'phone', 'company'] as const;
    type AllowedField = (typeof ALLOWED)[number];
    if (!ALLOWED.includes(cfg.subject_key as AllowedField)) {
      throw new Error(`unsupported contact_field: ${cfg.subject_key}`);
    }
    const { data } = await db
      .from('contacts')
      .select(cfg.subject_key)
      .eq('id', run.contact_id!)
      .maybeSingle();
    const raw = (data as Record<string, unknown> | null)?.[cfg.subject_key];
    subjectValue = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  }
  return evaluateConditionPredicate({
    operator: cfg.operator,
    subjectValue,
    configValue: cfg.value,
  });
}

/**
 * Parse "HH:mm-HH:mm" and test whether the current server time falls
 * inside the window. Windows that cross midnight ("22:00-06:00") are
 * handled by the wrap-around branch. Exported pure for unit tests.
 */
export function isNowInWindow(window: string, now: Date = new Date()): boolean {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(window.trim());
  if (!m) return false;
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (
    Number(m[1]) > 23 ||
    Number(m[3]) > 23 ||
    Number(m[2]) > 59 ||
    Number(m[4]) > 59
  ) {
    return false;
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // Wrap-around window, e.g. 22:00-06:00.
  return nowMin >= startMin || nowMin < endMin;
}

/**
 * Tiny `{{vars.foo}}` interpolation. Used by send_message + collect_input
 * prompt text so a captured `name` can show up in the next prompt
 * ("Thanks {{vars.name}}, what's your email?"). Missing vars render as
 * empty string — the same behavior as the automations engine.
 */
function interpolateVars(
  template: string,
  vars: Record<string, unknown>
): string {
  if (!template) return '';
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

async function endRun(
  db: AdminClient,
  runId: string,
  status: 'completed' | 'handed_off' | 'timed_out' | 'failed',
  reason: string
): Promise<void> {
  await db
    .from('flow_runs')
    .update({
      status,
      ended_at: new Date().toISOString(),
      end_reason: reason,
    })
    .eq('id', runId);
}

// ============================================================
// The synchronous advance loop. Walks through auto-advance nodes
// until it hits one that suspends (send_buttons/send_list) or
// terminates (handoff/end). Each suspending node persists the
// new current_node_key before returning.
// ============================================================

async function advanceFromNodeKey(
  db: AdminClient,
  run: FlowRunRow,
  startNodeKey: string,
  nodes: Map<string, FlowNodeRow>
): Promise<{ outcome: 'advanced' | 'completed' | 'handed_off' }> {
  let currentKey: string | null = startNodeKey;
  // Defensive cap — if a flow has a cycle (which the validator
  // SHOULD catch but doesn't yet in v1), we bail rather than loop.
  for (let safety = 0; safety < 64; safety += 1) {
    if (!currentKey) {
      await logEvent(db, run.id, 'error', null, {
        reason: 'next_node_key was null mid-advance',
      });
      await endRun(db, run.id, 'failed', 'missing_next_node');
      return { outcome: 'completed' };
    }
    const node: FlowNodeRow | null = nodes.get(currentKey) ?? null;
    if (!node) {
      await logEvent(db, run.id, 'error', currentKey, {
        reason: 'node_not_found',
      });
      await endRun(db, run.id, 'failed', 'node_not_found');
      return { outcome: 'completed' };
    }
    await logEvent(db, run.id, 'node_entered', node.node_key, {
      node_type: node.node_type,
    });

    if (node.node_type === 'start') {
      currentKey = (node.config as unknown as StartNodeConfig).next_node_key;
      continue;
    }
    if (node.node_type === 'send_message') {
      const cfg = node.config as unknown as SendMessageNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.text, run.vars),
        });
        await logEvent(db, run.id, 'message_sent', node.node_key, {
          node_type: 'send_message',
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, 'error', node.node_key, {
          reason: 'send_text_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, 'failed', 'send_text_failed');
        return { outcome: 'completed' };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === 'send_media') {
      const cfg = node.config as unknown as SendMediaNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendMedia({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          kind: cfg.media_type,
          link: cfg.media_url,
          caption: cfg.caption
            ? interpolateVars(cfg.caption, run.vars)
            : undefined,
          filename: cfg.filename,
        });
        await logEvent(db, run.id, 'message_sent', node.node_key, {
          node_type: 'send_media',
          media_type: cfg.media_type,
          whatsapp_message_id,
        });
      } catch (err) {
        await logEvent(db, run.id, 'error', node.node_key, {
          reason: 'send_media_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, 'failed', 'send_media_failed');
        return { outcome: 'completed' };
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === 'collect_input') {
      // Send the prompt and suspend. Customer's next TEXT reply will
      // wake us up via handleReplyForActiveRun's collect_input branch.
      const cfg = node.config as unknown as CollectInputNodeConfig;
      try {
        const { whatsapp_message_id } = await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
        await logEvent(db, run.id, 'message_sent', node.node_key, {
          node_type: 'collect_input',
          whatsapp_message_id,
        });
        const { data: msg } = await db
          .from('messages')
          .select('id')
          .eq('message_id', whatsapp_message_id)
          .maybeSingle();
        await db
          .from('flow_runs')
          .update({
            last_prompt_message_id: (msg as { id: string } | null)?.id ?? null,
          })
          .eq('id', run.id);
      } catch (err) {
        await logEvent(db, run.id, 'error', node.node_key, {
          reason: 'collect_input_prompt_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, 'failed', 'collect_input_prompt_failed');
        return { outcome: 'completed' };
      }
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key
      );
      if (!advanced) {
        await logEvent(db, run.id, 'error', node.node_key, {
          reason: 'lost_race_during_advance',
        });
      }
      return { outcome: 'advanced' };
    }
    if (node.node_type === 'condition') {
      const cfg = node.config as unknown as ConditionNodeConfig;
      let branch: 'true' | 'false';
      try {
        branch = (await evaluateConditionNode(db, run, cfg)) ? 'true' : 'false';
      } catch (err) {
        await logEvent(db, run.id, 'error', node.node_key, {
          reason: 'condition_evaluation_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
        await endRun(db, run.id, 'failed', 'condition_evaluation_failed');
        return { outcome: 'completed' };
      }
      currentKey = branch === 'true' ? cfg.true_next : cfg.false_next;
      await logEvent(db, run.id, 'node_entered', node.node_key, {
        condition_result: branch,
        advancing_to: currentKey,
      });
      continue;
    }
    if (node.node_type === 'set_tag') {
      const cfg = node.config as unknown as SetTagNodeConfig;
      try {
        if (cfg.mode === 'add') {
          await db
            .from('contact_tags')
            .upsert(
              { contact_id: run.contact_id!, tag_id: cfg.tag_id },
              { onConflict: 'contact_id,tag_id' }
            );
        } else {
          await db
            .from('contact_tags')
            .delete()
            .eq('contact_id', run.contact_id!)
            .eq('tag_id', cfg.tag_id);
        }
      } catch (err) {
        // Non-fatal — log + advance. A tag-write failure shouldn't
        // strand the customer mid-flow.
        await logEvent(db, run.id, 'error', node.node_key, {
          reason: 'set_tag_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
      currentKey = cfg.next_node_key;
      continue;
    }
    if (node.node_type === 'send_buttons') {
      await sendButtonsAndSuspend(db, run, node);
      // Persist the new current_node_key via optimistic UPDATE.
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key
      );
      if (!advanced) {
        await logEvent(db, run.id, 'error', node.node_key, {
          reason: 'lost_race_during_advance',
        });
      }
      return { outcome: 'advanced' };
    }
    if (node.node_type === 'send_list') {
      await sendListAndSuspend(db, run, node);
      const advanced = await advanceCurrentNodeKey(
        db,
        run.id,
        run.current_node_key,
        node.node_key
      );
      if (!advanced) {
        await logEvent(db, run.id, 'error', node.node_key, {
          reason: 'lost_race_during_advance',
        });
      }
      return { outcome: 'advanced' };
    }
    if (isActionNodeType(node.node_type)) {
      // Absorbed automation actions (Workflows unification) — one
      // reusable executor covers send_template / update_contact_field /
      // assign_conversation / create_deal / send_webhook /
      // close_conversation / wait. See lib/action-nodes.ts.
      const result = await executeActionNode(db, run, node);
      if (result.kind === 'advance') {
        await logEvent(db, run.id, 'node_entered', node.node_key, {
          node_type: node.node_type,
          detail: result.detail,
        });
        currentKey = result.next_node_key;
        continue;
      }
      if (result.kind === 'suspend') {
        // Wait node parked the run (status='waiting', wake_at set).
        await logEvent(db, run.id, 'node_entered', node.node_key, {
          node_type: 'wait',
          detail: result.detail,
        });
        return { outcome: 'advanced' };
      }
      await logEvent(db, run.id, 'error', node.node_key, {
        reason: result.reason,
        detail: result.detail,
      });
      await endRun(db, run.id, 'failed', result.reason);
      return { outcome: 'completed' };
    }
    if (node.node_type === 'handoff') {
      await executeHandoff(db, run, node);
      return { outcome: 'handed_off' };
    }
    if (node.node_type === 'end') {
      await logEvent(db, run.id, 'completed', node.node_key);
      await endRun(db, run.id, 'completed', 'end_node');
      return { outcome: 'completed' };
    }
    // Unknown node type — shouldn't happen given the CHECK constraint.
    await logEvent(db, run.id, 'error', node.node_key, {
      reason: `unknown_node_type:${node.node_type}`,
    });
    await endRun(db, run.id, 'failed', 'unknown_node_type');
    return { outcome: 'completed' };
  }
  // Safety break — log + fail.
  await logEvent(db, run.id, 'error', currentKey, {
    reason: 'advance_loop_safety_break',
  });
  await endRun(db, run.id, 'failed', 'advance_loop_overflow');
  return { outcome: 'completed' };
}

/**
 * Optimistic UPDATE — only advance current_node_key when it matches
 * the value we read at the top of dispatch. If another webhook beat
 * us, the row's pointer has already moved and our UPDATE returns
 * zero rows; we treat that as a no-op and let the other run continue.
 */
async function advanceCurrentNodeKey(
  db: AdminClient,
  runId: string,
  expectedOldKey: string | null,
  newKey: string
): Promise<boolean> {
  // PostgREST: when expectedOldKey is null we can't `.eq` (would match
  // any row); use `.is('current_node_key', null)` instead.
  let q = db
    .from('flow_runs')
    .update({
      current_node_key: newKey,
      last_advanced_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('status', 'active');
  if (expectedOldKey === null) {
    q = q.is('current_node_key', null);
  } else {
    q = q.eq('current_node_key', expectedOldKey);
  }
  const { data, error } = await q.select('id');
  if (error) {
    console.error('[flows] advanceCurrentNodeKey error:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// Public entry point — the webhook calls this on every inbound.
// ============================================================

export async function dispatchInboundToFlows(
  input: DispatchInboundInput & { isFirstInboundMessage: boolean }
): Promise<DispatchInboundResult> {
  const db = supabaseAdmin();
  try {
    const activeRun = await loadActiveRunForContact(
      db,
      input.accountId,
      input.contactId
    );

    // Idempotency — only matters if there's already a run for this
    // contact. For new runs, the partial unique index catches duplicate
    // starts at INSERT time.
    if (activeRun) {
      const dupe = await isDuplicateInbound(
        db,
        input.accountId,
        input.contactId,
        input.message.meta_message_id
      );
      if (dupe) {
        return {
          consumed: true,
          flow_run_id: activeRun.id,
          outcome: 'duplicate_inbound_ignored',
        };
      }
      // One SELECT for the whole flow's nodes — advance loop is now
      // in-memory. See loadAllNodes.
      const nodes = await loadAllNodes(db, activeRun.flow_id);
      return handleReplyForActiveRun(db, activeRun, input.message, nodes);
    }

    // No active run → look for a flow whose entry trigger matches.
    const flow = await findEntryFlow(
      db,
      input.accountId,
      input.message,
      input.isFirstInboundMessage
    );
    if (!flow || !flow.entry_node_id) {
      return { consumed: false, outcome: 'no_match' };
    }
    const nodes = await loadAllNodes(db, flow.id);
    return startNewRun(db, flow, input, nodes);
  } catch (err) {
    console.error(
      '[flows] dispatchInboundToFlows threw:',
      err instanceof Error ? err.message : err
    );
    return { consumed: false, outcome: 'no_match' };
  }
}

async function handleReplyForActiveRun(
  db: AdminClient,
  run: FlowRunRow,
  message: ParsedInbound,
  nodes: Map<string, FlowNodeRow>
): Promise<DispatchInboundResult> {
  // Note: we intentionally do NOT persist the raw customer text. A
  // `collect_input` prompt that asks "what's your card number?" would
  // otherwise leave the PAN sitting in flow_run_events.payload forever,
  // visible to anyone with access to the runs viewer or the events
  // table. Length is enough for "did they actually reply?" debugging;
  // for the captured value itself, the `node_entered` event already
  // records `captured_key` + `captured_length` after the var is stored.
  await logEvent(db, run.id, 'reply_received', run.current_node_key, {
    meta_message_id: message.meta_message_id,
    reply_kind: message.kind,
    reply_id: message.kind === 'interactive_reply' ? message.reply_id : null,
    text_length: message.kind === 'text' ? message.text.length : null,
  });

  if (!run.current_node_key) {
    // Defensive — a run with status='active' but no current node is
    // malformed. Fail the run rather than spin.
    await endRun(db, run.id, 'failed', 'active_run_missing_current_node');
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: 'no_match',
    };
  }

  const currentNode = nodes.get(run.current_node_key) ?? null;
  if (!currentNode) {
    await endRun(db, run.id, 'failed', 'current_node_not_found');
    return { consumed: true, flow_run_id: run.id, outcome: 'no_match' };
  }

  // Two ways a reply can advance:
  //   1. Interactive button/list tap on a send_buttons/send_list node.
  //   2. Text reply on a collect_input node — capture into vars.
  //
  // Everything else falls through to the fallback policy below.
  let matched: string | null = null;
  if (
    message.kind === 'interactive_reply' &&
    (currentNode.node_type === 'send_buttons' ||
      currentNode.node_type === 'send_list')
  ) {
    matched = matchReplyId(currentNode, message.reply_id);
  } else if (
    message.kind === 'text' &&
    currentNode.node_type === 'collect_input'
  ) {
    const cfg = currentNode.config as unknown as CollectInputNodeConfig;
    const captured = message.text.trim();
    if (captured.length > 0 && cfg.var_key) {
      // Persist captured value + reset reprompt count atomically.
      const newVars = { ...run.vars, [cfg.var_key]: captured };
      const { error: capErr } = await db
        .from('flow_runs')
        .update({
          vars: newVars,
          reprompt_count: 0,
        })
        .eq('id', run.id);
      if (!capErr) {
        // Mirror the UPDATE in-memory so downstream interpolation in
        // the advance loop sees the captured var without us having to
        // re-SELECT the whole row.
        run.vars = newVars;
        run.reprompt_count = 0;
        await logEvent(db, run.id, 'node_entered', currentNode.node_key, {
          captured_key: cfg.var_key,
          captured_length: captured.length,
        });
        matched = cfg.next_node_key;
      }
    }
  }

  if (matched) {
    // Reset reprompt count on a successful match. Skip the write when
    // already 0 — the collect_input capture branch above already
    // zeroed it, and interactive-reply matches against a fresh run
    // (post-prior-reset) are also already 0. The previous re-read of
    // the whole row was needed only because we weren't mirroring the
    // capture UPDATE into the in-memory `run`; now that we do, the
    // local copy is the source of truth.
    if (run.reprompt_count !== 0) {
      const { error } = await db
        .from('flow_runs')
        .update({ reprompt_count: 0 })
        .eq('id', run.id);
      if (!error) run.reprompt_count = 0;
    }
    const outcome = await advanceFromNodeKey(db, run, matched, nodes);
    return {
      consumed: true,
      flow_run_id: run.id,
      outcome: outcome.outcome,
    };
  }

  // No match → fallback. Apply the policy.
  const policy = resolveFallbackPolicy(
    (await loadFlow(db, run.flow_id))?.fallback_policy
  );
  const newReprompts = run.reprompt_count + 1;
  await db
    .from('flow_runs')
    .update({ reprompt_count: newReprompts })
    .eq('id', run.id);

  const action = decideFallback({ policy, reprompt_count: newReprompts });
  await logEvent(db, run.id, 'fallback_fired', run.current_node_key, {
    action: action.type,
    reprompt_count: newReprompts,
  });
  if (action.type === 'ignore') {
    // Don't consume — let automations have a shot at it.
    return { consumed: false, flow_run_id: run.id, outcome: 'no_match' };
  }
  if (action.type === 'reprompt') {
    // Re-send the same prompt. Same node, no current_node_key change.
    if (currentNode.node_type === 'send_buttons') {
      await sendButtonsAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === 'send_list') {
      await sendListAndSuspend(db, run, currentNode);
    } else if (currentNode.node_type === 'collect_input') {
      // Customer typed something we couldn't accept (empty after trim,
      // or var_key missing — rare). Re-send the prompt so they try again.
      const cfg = currentNode.config as unknown as CollectInputNodeConfig;
      try {
        await engineSendText({
          accountId: run.account_id,
          userId: run.user_id,
          conversationId: run.conversation_id!,
          contactId: run.contact_id!,
          text: interpolateVars(cfg.prompt_text, run.vars),
        });
      } catch (err) {
        await logEvent(db, run.id, 'error', currentNode.node_key, {
          reason: 'reprompt_send_failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { consumed: true, flow_run_id: run.id, outcome: 'fallback_fired' };
  }
  if (action.type === 'handoff') {
    if (run.conversation_id) {
      await db
        .from('conversations')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', run.conversation_id);
    }
    await logEvent(db, run.id, 'handoff', run.current_node_key, {
      reason: 'fallback_exhausted',
    });
    await endRun(db, run.id, 'handed_off', 'fallback_exhausted');
    return { consumed: true, flow_run_id: run.id, outcome: 'handed_off' };
  }
  // action.type === 'end'
  await endRun(db, run.id, 'completed', 'fallback_exhausted_end');
  return { consumed: true, flow_run_id: run.id, outcome: 'completed' };
}

async function startNewRun(
  db: AdminClient,
  flow: FlowRow,
  input: DispatchInboundInput,
  nodes: Map<string, FlowNodeRow>
): Promise<DispatchInboundResult> {
  // INSERT — partial unique index `idx_one_active_run_per_contact`
  // catches concurrent inserts with 23505. We catch and return as
  // consumed:true (the parallel webhook handles it).
  const { data: inserted, error: insErr } = await db
    .from('flow_runs')
    .insert({
      flow_id: flow.id,
      // Tenancy: NOT NULL post-017. The partial unique index
      // `idx_one_active_run_per_contact` is over (account_id,
      // contact_id) WHERE status='active', so two accounts sharing
      // a contact phone number each run their own flows independently.
      account_id: flow.account_id,
      // Audit: preserves the flow's author on the run row for log
      // attribution.
      user_id: flow.user_id,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      status: 'active',
      current_node_key: flow.entry_node_id,
      // Mirror the triggering text into vars so action nodes can
      // interpolate {{message.text}} without extra plumbing.
      vars:
        input.message.kind === 'text' && input.message.text
          ? { __message_text: input.message.text }
          : {},
    })
    .select('*')
    .maybeSingle();
  if (insErr) {
    // 23505 = unique_violation → another webhook is starting the run.
    const msg = insErr.message ?? '';
    if (msg.includes('23505') || msg.includes('duplicate key')) {
      return { consumed: true, outcome: 'duplicate_inbound_ignored' };
    }
    console.error('[flows] startNewRun insert error:', insErr.message);
    return { consumed: false, outcome: 'no_match' };
  }
  const run = inserted as FlowRunRow;
  await logEvent(db, run.id, 'started', flow.entry_node_id, {
    flow_id: flow.id,
    trigger_type: flow.trigger_type,
    meta_message_id: input.message.meta_message_id,
  });
  // Bump the flow's execution counter — used by the builder UI to
  // surface "X runs since activation" on the flow card.
  //
  // Atomic RPC (migration 012) rather than read-modify-write: two
  // concurrent webhooks starting runs for different contacts on the
  // same flow would otherwise both read N and both write N+1, losing
  // a count. Mirrors the automations engine's use of
  // `increment_automation_execution_count` (migration 007).
  const { error: incErr } = await db.rpc('increment_flow_execution_count', {
    p_flow_id: flow.id,
  });
  if (incErr) {
    // Non-fatal — the run itself succeeded; only the counter is off.
    console.error('[flows] execution_count rpc error:', incErr.message);
  }

  // Run the advance loop starting from the entry node.
  const outcome = await advanceFromNodeKey(db, run, flow.entry_node_id!, nodes);
  return {
    consumed: true,
    flow_run_id: run.id,
    outcome: outcome.outcome === 'advanced' ? 'started' : outcome.outcome,
  };
}

// ============================================================
// Event dispatch — absorbed automation triggers (Workflows).
// App events (contact created, tag added, conversation assigned)
// start flows here. Reuses startNewRun + the advance loop, so
// event-started runs behave identically to inbound-started ones:
// action nodes execute immediately; a suspending node parks the
// run and continues conversationally.
// ============================================================

export type FlowAppEvent =
  | { type: 'new_contact_created' }
  | { type: 'tag_added'; tag_id: string }
  | { type: 'conversation_assigned'; agent_id: string };

export interface DispatchEventInput {
  accountId: string;
  contactId: string;
  /** Required for conversation-scoped actions (send/assign/close). */
  conversationId: string;
  event: FlowAppEvent;
  /** Optional triggering text mirrored into vars.__message_text. */
  messageText?: string;
}

/**
 * Start every active flow whose trigger matches an app event.
 * Never rejects — callers run in webhook after() paths where a
 * downstream failure must not change the provider ack.
 */
export async function dispatchEventToFlows(
  input: DispatchEventInput
): Promise<{ started: number }> {
  const db = supabaseAdmin();
  let started = 0;
  try {
    const { data: flows, error } = await db
      .from('flows')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('status', 'active')
      .eq('trigger_type', input.event.type)
      .order('created_at', { ascending: true });
    if (error || !flows?.length) return { started };

    for (const flowRaw of flows as FlowRow[]) {
      if (!flowRaw.entry_node_id) continue;

      // Config filters — empty arrays mean "match any".
      const cfg = (flowRaw.trigger_config ?? {}) as {
        tag_ids?: string[];
        agent_ids?: string[];
      };
      if (
        input.event.type === 'tag_added' &&
        Array.isArray(cfg.tag_ids) &&
        cfg.tag_ids.length > 0 &&
        !cfg.tag_ids.includes(input.event.tag_id)
      ) {
        continue;
      }
      if (
        input.event.type === 'conversation_assigned' &&
        Array.isArray(cfg.agent_ids) &&
        cfg.agent_ids.length > 0 &&
        !cfg.agent_ids.includes(input.event.agent_id)
      ) {
        continue;
      }

      const nodes = await loadAllNodes(db, flowRaw.id);
      const result = await startNewRun(
        db,
        flowRaw,
        {
          accountId: input.accountId,
          userId: flowRaw.user_id,
          contactId: input.contactId,
          conversationId: input.conversationId,
          message: {
            kind: 'text',
            text: input.messageText ?? '',
            meta_message_id: `event:${input.event.type}:${crypto.randomUUID()}`,
          },
        },
        nodes
      );
      if (result.consumed) {
        started += 1;
        // One active run per contact (partial unique index) — once a
        // run starts, further event flows for this contact must wait.
        break;
      }
    }
  } catch (err) {
    console.error(
      '[flows] dispatchEventToFlows threw:',
      err instanceof Error ? err.message : err
    );
  }
  return { started };
}

// ============================================================
// Wake sweep — resumes `wait`-parked runs whose wake_at elapsed.
// Called by /api/flows/cron alongside the stale-run sweep.
// ============================================================

export async function resumeWaitingRuns(): Promise<{ resumed: number }> {
  const db = supabaseAdmin();
  let resumed = 0;
  try {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await db
      .from('flow_runs')
      .select('*')
      .eq('status', 'waiting')
      .lte('wake_at', nowIso)
      .limit(50);
    if (error || !due?.length) return { resumed };

    for (const runRaw of due as FlowRunRow[]) {
      // Claim atomically — the status precondition means two overlapping
      // cron ticks can't double-resume the same run.
      const { data: claimed } = await db
        .from('flow_runs')
        .update({
          status: 'active',
          wake_at: null,
          last_advanced_at: nowIso,
        })
        .eq('id', runRaw.id)
        .eq('status', 'waiting')
        .select('*')
        .maybeSingle();
      if (!claimed) continue;

      const run = claimed as FlowRunRow;
      const nodes = await loadAllNodes(db, run.flow_id);
      const waitNode = run.current_node_key
        ? nodes.get(run.current_node_key)
        : null;
      const nextKey =
        waitNode && waitNode.node_type === 'wait'
          ? (waitNode.config as { next_node_key?: string }).next_node_key
          : null;
      if (!nextKey) {
        await endRun(db, run.id, 'failed', 'wait_missing_next');
        continue;
      }
      await logEvent(db, run.id, 'node_entered', run.current_node_key, {
        node_type: 'wait',
        detail: 'woke',
      });
      await advanceFromNodeKey(db, run, nextKey, nodes);
      resumed += 1;
    }
  } catch (err) {
    console.error(
      '[flows] resumeWaitingRuns threw:',
      err instanceof Error ? err.message : err
    );
  }
  return { resumed };
}

// ============================================================
// Scheduled trigger — cron-tick starter (Workflows unification).
// A `scheduled` flow fires when the tick lands inside its HH:mm
// window (±10 min tolerance for slow crons). Audience: contacts
// with recent conversation activity (last 24h), so a schedule
// re-engages active threads instead of blasting the whole book.
// Dedupe: one run per flow+contact per period (day/week).
// ============================================================

const SCHEDULE_WINDOW_MIN = 10;
const SCHEDULE_AUDIENCE_CAP = 50;

export async function startScheduledFlows(
  now: Date = new Date()
): Promise<{ started: number }> {
  const db = supabaseAdmin();
  let started = 0;
  try {
    const { data: flows, error } = await db
      .from('flows')
      .select('*')
      .eq('status', 'active')
      .eq('trigger_type', 'scheduled');
    if (error || !flows?.length) return { started };

    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const flowRaw of flows as FlowRow[]) {
      if (!flowRaw.entry_node_id) continue;
      const cfg = (flowRaw.trigger_config ?? {}) as {
        frequency?: string;
        hour?: number;
        minute?: number;
        weekday?: number;
      };
      if (typeof cfg.hour !== 'number' || typeof cfg.minute !== 'number') {
        continue;
      }
      if (cfg.frequency === 'weekly' && now.getDay() !== (cfg.weekday ?? 1)) {
        continue;
      }
      const target = cfg.hour * 60 + cfg.minute;
      // Fire only within [target, target + window) — late ticks catch
      // up, early ones don't pre-fire.
      if (nowMin < target || nowMin >= target + SCHEDULE_WINDOW_MIN) continue;

      // Period start for dedupe: today 00:00 (daily) or 6 days back
      // (weekly) — one run per flow+contact per period.
      const periodStart = new Date(now);
      periodStart.setHours(0, 0, 0, 0);
      if (cfg.frequency === 'weekly') {
        periodStart.setDate(periodStart.getDate() - 6);
      }

      // Audience: recently-active conversations for this account.
      const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString();
      const { data: convos } = await db
        .from('conversations')
        .select('id, contact_id')
        .eq('account_id', flowRaw.account_id)
        .gte('last_message_at', dayAgo)
        .order('last_message_at', { ascending: false })
        .limit(SCHEDULE_AUDIENCE_CAP);
      if (!convos?.length) continue;

      // One query for all already-started contacts this period.
      const contactIds = convos
        .map((c) => c.contact_id as string)
        .filter(Boolean);
      const { data: prior } = await db
        .from('flow_runs')
        .select('contact_id')
        .eq('flow_id', flowRaw.id)
        .gte('started_at', periodStart.toISOString())
        .in('contact_id', contactIds);
      const alreadyRan = new Set(
        (prior ?? []).map((r) => r.contact_id as string)
      );

      const nodes = await loadAllNodes(db, flowRaw.id);
      for (const convo of convos) {
        const contactId = convo.contact_id as string;
        if (!contactId || alreadyRan.has(contactId)) continue;
        const result = await startNewRun(
          db,
          flowRaw,
          {
            accountId: flowRaw.account_id,
            userId: flowRaw.user_id,
            contactId,
            conversationId: convo.id as string,
            message: {
              kind: 'text',
              text: '',
              meta_message_id: `sched:${flowRaw.id}:${crypto.randomUUID()}`,
            },
          },
          nodes
        );
        if (result.consumed) started += 1;
      }
    }
  } catch (err) {
    console.error(
      '[flows] startScheduledFlows threw:',
      err instanceof Error ? err.message : err
    );
  }
  return { started };
}

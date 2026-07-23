import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { buildCrmContext } from './crm-context'
import { generateReply } from './generate'
import { buildPromptParts } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { isWithinAutoReplySchedule, startOfTodayUtc } from './schedule'
import { sendChannelMessage } from '@/lib/orchestration/outbound'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    // Auto-reply is independent from the inbox "Draft with AI" master
    // switch. Load the saved provider config even when `is_active` is off;
    // this worker is governed exclusively by `auto_reply_enabled`.
    const config = await loadAiConfig(db, accountId, { requireActive: false })
    if (!config || !config.autoReplyEnabled) return

    // Reply-hours window: outside the configured schedule the bot stands
    // down entirely and the inbound waits in the inbox for a human.
    if (!isWithinAutoReplySchedule(config)) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Reply-cap gate, by limit mode:
    //  - never:            no cap — the bot always replies.
    //  - per_conversation: lifetime cap; cheap early-out here, the
    //                      authoritative check is the atomic claim below.
    //  - per_day:          cap resets at midnight in the account's
    //                      timezone; counted from today's bot messages.
    if (
      config.autoReplyLimitMode === 'per_conversation' &&
      conv.ai_reply_count >= config.autoReplyMaxPerConversation
    ) {
      return
    }
    if (config.autoReplyLimitMode === 'per_day') {
      const dayStart = startOfTodayUtc(config.autoReplyTimezone)
      const { count, error: cntErr } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'bot')
        .eq('ai_generated', true)
        .gte('created_at', dayStart.toISOString())
      if (cntErr) {
        // Can't establish today's count — fail safe (don't reply) so a
        // transient DB error can never blow past the cap.
        console.error('[ai auto-reply] per-day count failed:', cntErr)
        return
      }
      if ((count ?? 0) >= config.autoReplyMaxPerConversation) return
    }

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base and the
    // contact's live CRM record (both best-effort, fetched in parallel).
    const [knowledge, crmContext] = await Promise.all([
      retrieveKnowledge(db, accountId, config, latestUserMessage(messages)),
      buildCrmContext(db, contactId),
    ])

    // Cache-aligned prompt (the only path — benchmarked at ~70% fewer
    // full-price input tokens than the legacy single-string prompt):
    // stable blocks become the system prefix and the retrieved
    // knowledge rides as the final user turn, so providers reuse the
    // cached prefix across replies.
    const { text, handoff, usage, sentiment, escalationReason } =
      await generateReply({
        config,
        messages,
        promptParts: buildPromptParts({
          userPrompt: config.systemPrompt,
          mode: 'auto_reply',
          knowledge,
          crmContext,
        }),
        cacheKey: conversationId,
      })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
      keySource: config.keySource,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation: the
      // explicitly configured handoff agent wins, else round-robin
      // across the account's members, else the shared queue — and
      // (c) leave a short internal note (with sentiment + reason) so
      // whoever picks it up has context. Assigning fires the
      // `on_conversation_assigned` trigger, which notifies the agent;
      // an unassigned escalation fans out to every member instead so an
      // empty queue never goes silent.
      const reason = escalationReason ?? (handoff ? 'human_requested' : 'out_of_scope')
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
        sentiment,
        escalationReason: reason,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
        ai_sentiment: sentiment,
        ai_escalation_reason: reason,
        ai_escalated_at: new Date().toISOString(),
      }
      // Never stomp an existing human assignment.
      let assignee: string | null = null
      if (!conv.assigned_agent_id) {
        if (config.handoffAgentId) {
          assignee = config.handoffAgentId
        } else {
          // Round-robin over the account's members. A missing RPC (mig-
          // ration not applied) or empty account degrades to unassigned.
          const { data: rrAgent, error: rrErr } = await db.rpc(
            'claim_round_robin_agent',
            { p_account_id: accountId },
          )
          if (rrErr) {
            console.error(
              '[ai auto-reply] claim_round_robin_agent failed (leaving unassigned):',
              rrErr,
            )
          } else if (typeof rrAgent === 'string' && rrAgent) {
            assignee = rrAgent
          }
        }
      }
      if (assignee) update.assigned_agent_id = assignee
      await db.from('conversations').update(update).eq('id', conversationId)

      // Unassigned escalation → notify every member of the account so
      // someone sees it (the assignment trigger only fires on assign).
      if (!assignee && !conv.assigned_agent_id) {
        await notifyAllMembersOfEscalation(db, {
          accountId,
          conversationId,
          contactId,
          sentiment,
          reason,
        })
      }
      return
    }

    // Non-escalated turn: keep the latest classified sentiment on the
    // conversation (cheap single UPDATE; best-effort).
    void db
      .from('conversations')
      .update({ ai_sentiment: sentiment })
      .eq('id', conversationId)
      .then(({ error }) => {
        if (error) {
          console.error('[ai auto-reply] sentiment update failed:', error)
        }
      })

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    // In per_day / never modes the lifetime counter must not block the
    // send (their gates already ran above), but we still claim a slot so
    // `ai_reply_count` keeps tracking total bot replies for the thread.
    const lifetimeCap =
      config.autoReplyLimitMode === 'per_conversation'
        ? config.autoReplyMaxPerConversation
        : 2147483647
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: lifetimeCap,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    // Channel-agnostic send: the orchestrator resolves the conversation's
    // channel connection (Meta / Twilio / legacy config) and persists the
    // message row. Replaces the Meta-hardcoded engineSendText path.
    await sendChannelMessage({
      accountId,
      conversationId,
      contactId,
      payload: { kind: 'text', text },
      senderType: 'bot',
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Escalation landed in the shared queue (no handoff agent configured,
 * round-robin found no member) — insert a notification for EVERY account
 * member so the escalation is never silent. Best-effort: a failure here
 * must not fail the escalation itself (the conversation is already
 * paused and annotated).
 */
async function notifyAllMembersOfEscalation(
  db: ReturnType<typeof supabaseAdmin>,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    sentiment: string
    reason: string
  },
): Promise<void> {
  try {
    const { data: members, error } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', args.accountId)
    if (error || !members || members.length === 0) return

    const readable = args.reason.replace(/_/g, ' ')
    const feeling =
      args.sentiment && args.sentiment !== 'neutral'
        ? ` — customer seems ${args.sentiment}`
        : ''
    const rows = members.map((m) => ({
      account_id: args.accountId,
      user_id: m.user_id,
      type: 'ai_escalation',
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      actor_user_id: null,
      title: 'Customer needs help',
      body: `AI escalated a conversation (${readable})${feeling} — unassigned in the shared queue.`,
    }))
    const { error: insErr } = await db.from('notifications').insert(rows)
    if (insErr) {
      console.error('[ai auto-reply] escalation fan-out insert failed:', insErr)
    }
  } catch (err) {
    console.error('[ai auto-reply] escalation fan-out threw:', err)
  }
}

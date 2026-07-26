import { supabaseAdmin } from './admin-client';
import { loadAgentConfig } from './agents';
import { routeConversation } from './router';
import { buildConversationContext } from './context';
import { retrieveKnowledge } from './knowledge';
import { buildCrmContext } from './crm-context';
import { generateReply } from './generate';
import { buildPromptParts } from './defaults';
import { buildHandoffSummary } from './handoff';
import { logAiUsage } from './usage';
import { latestUserMessage } from './query';
import { isWithinAutoReplySchedule, startOfTodayUtc } from './schedule';
import { sendChannelMessage } from '@/features/admin/lib/orchestration/outbound';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { checkMonthlyQuota, consumeMonthlyQuota } from '@/lib/quotas';

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string;
  conversationId: string;
  contactId: string;
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string;
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
  args: DispatchArgs
): Promise<void> {
  const { accountId, conversationId, contactId } = args;

  try {
    const db = supabaseAdmin();

    // Single default agent, "auto-reply" capability: only runs when the
    // agent's autoreply_enabled column is on. Unconfigured or switched
    // off → silent no-op (suggestions_enabled is irrelevant here).
    const config = await loadAgentConfig(db, accountId, 'autoreply');
    if (!config) return;

    // NOTE: the schedule gate runs AFTER routing (below) — each custom
    // agent can have its own on-duty hours, so a night-shift agent can
    // answer while the default agent is off the clock.

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. A flow with a
    // message-level trigger (`new_message_received` / `keyword`) may
    // still fire independently for this same inbound and send its own
    // reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('flows')
      .select('id')
      .eq('account_id', accountId)
      .eq('status', 'active')
      .in('trigger_type', ['new_message_received', 'keyword'])
      .limit(1);
    if (autoResponders && autoResponders.length > 0) return;

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr || !conv) return;
    if (conv.assigned_agent_id) return; // a human owns this thread
    if (conv.ai_autoreply_disabled) return; // handed off / turned off here

    const messages = await buildConversationContext(db, conversationId);
    if (messages.length === 0) return;

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = await checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount
    );
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`
      );
      return;
    }

    // Plan quota: monthly AI-reply budget. Webhook context — there is
    // no user to show a 402 to, so over-quota means the bot silently
    // stands down and the inbound waits in the inbox for a human,
    // exactly like the schedule and reply-cap gates below.
    const aiQuota = await checkMonthlyQuota(accountId, 'ai_replies');
    if (!aiQuota.allowed) {
      console.warn(
        `[ai auto-reply] account ${accountId} exhausted its monthly AI reply quota (${aiQuota.limit}) — skipping this inbound.`
      );
      return;
    }

    // Supervisor router (2026 agentic pattern): keyword triggers →
    // on-duty filter → LLM classifier → fallback to the default agent.
    // The routed agent's config carries ITS guardrails where it set
    // them (cap, schedule, escalation) and inherits the default's
    // where it didn't — so every gate below runs on activeConfig.
    // Fails open to the default agent; costs nothing when no custom
    // agents exist.
    const { config: activeConfig, specialist } = await routeConversation(
      db,
      accountId,
      config,
      messages
    );

    // Reply-hours window of WHOEVER is answering: outside the routed
    // agent's schedule the bot stands down and the inbound waits in
    // the inbox for a human.
    if (!isWithinAutoReplySchedule(activeConfig)) return;

    // Reply-cap gate, by the routed agent's limit mode:
    //  - never:            no cap — the bot always replies.
    //  - per_conversation: lifetime cap; cheap early-out here, the
    //                      authoritative check is the atomic claim below.
    //  - per_day:          cap resets at midnight in the agent's
    //                      timezone; counted from today's bot messages.
    if (
      activeConfig.autoReplyLimitMode === 'per_conversation' &&
      conv.ai_reply_count >= activeConfig.autoReplyMaxPerConversation
    ) {
      return;
    }
    if (activeConfig.autoReplyLimitMode === 'per_day') {
      const dayStart = startOfTodayUtc(activeConfig.autoReplyTimezone);
      const { count, error: cntErr } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'bot')
        .eq('ai_generated', true)
        .gte('created_at', dayStart.toISOString());
      if (cntErr) {
        // Can't establish today's count — fail safe (don't reply) so a
        // transient DB error can never blow past the cap.
        console.error('[ai auto-reply] per-day count failed:', cntErr);
        return;
      }
      if ((count ?? 0) >= activeConfig.autoReplyMaxPerConversation) return;
    }

    // Ground the reply in the account's knowledge base and the
    // contact's live CRM record (both best-effort, fetched in parallel).
    const [knowledge, crmContext] = await Promise.all([
      retrieveKnowledge(db, accountId, config, latestUserMessage(messages)),
      buildCrmContext(db, contactId),
    ]);

    // Cache-aligned prompt (the only path — benchmarked at ~70% fewer
    // full-price input tokens than the legacy single-string prompt):
    // stable blocks become the system prefix and the retrieved
    // knowledge rides as the final user turn, so providers reuse the
    // cached prefix across replies.
    const { text, handoff, usage, sentiment, escalationReason } =
      await generateReply({
        config: activeConfig,
        messages,
        promptParts: buildPromptParts({
          // The routed persona — the specialist's when matched, else
          // the default agent's.
          userPrompt: activeConfig.systemPrompt,
          mode: 'auto_reply',
          knowledge,
          crmContext,
        }),
        cacheKey: conversationId,
      });

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      // Attribute spend to the specialist that actually answered,
      // falling back to the default agent.
      agentId: specialist?.id ?? config.agentId,
      provider: activeConfig.provider,
      model: activeConfig.model,
      usage,
      keySource: config.keySource,
    });

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
      const reason =
        escalationReason ?? (handoff ? 'human_requested' : 'out_of_scope');
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
        sentiment,
        escalationReason: reason,
      });
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
        ai_sentiment: sentiment,
        ai_escalation_reason: reason,
        ai_escalated_at: new Date().toISOString(),
      };
      // Never stomp an existing human assignment.
      let assignee: string | null = null;
      if (!conv.assigned_agent_id) {
        // The routed agent's own escalation target wins; agents
        // without one inherit the default agent's.
        if (activeConfig.handoffAgentId) {
          assignee = activeConfig.handoffAgentId;
        } else {
          // Round-robin over the account's members. A missing RPC (mig-
          // ration not applied) or empty account degrades to unassigned.
          const { data: rrAgent, error: rrErr } = await db.rpc(
            'claim_round_robin_agent',
            { p_account_id: accountId }
          );
          if (rrErr) {
            console.error(
              '[ai auto-reply] claim_round_robin_agent failed (leaving unassigned):',
              rrErr
            );
          } else if (typeof rrAgent === 'string' && rrAgent) {
            assignee = rrAgent;
          }
        }
      }
      if (assignee) update.assigned_agent_id = assignee;
      await db.from('conversations').update(update).eq('id', conversationId);

      // WARM HANDOFF — the customer must never face silence or a cold
      // refusal. The model was instructed to write a bridge message
      // (acknowledge → collect details → promise follow-up) before the
      // sentinel; a legacy bare sentinel or empty output falls back to
      // a static bridge line. Best-effort: a failed send must not
      // block the escalation itself (already persisted above).
      const bridgeText =
        text ||
        'Thanks for reaching out — I want to make sure this is handled properly, so I\u2019m looping in a member of our team right now. If you can share any details that will help (like your order number or a photo of the issue), they\u2019ll pick it up from there and get back to you shortly.';
      try {
        await sendChannelMessage({
          accountId,
          conversationId,
          contactId,
          payload: { kind: 'text', text: bridgeText },
          senderType: 'bot',
          aiGenerated: true,
        });
      } catch (bridgeErr) {
        console.error(
          '[ai auto-reply] warm-handoff bridge send failed:',
          bridgeErr
        );
      }

      // Unassigned escalation → notify every member of the account so
      // someone sees it (the assignment trigger only fires on assign).
      if (!assignee && !conv.assigned_agent_id) {
        await notifyAllMembersOfEscalation(db, {
          accountId,
          conversationId,
          contactId,
          sentiment,
          reason,
        });
      }
      return;
    }

    // Non-escalated turn: keep the latest classified sentiment on the
    // conversation (cheap single UPDATE; best-effort).
    void db
      .from('conversations')
      .update({ ai_sentiment: sentiment })
      .eq('id', conversationId)
      .then(({ error }) => {
        if (error) {
          console.error('[ai auto-reply] sentiment update failed:', error);
        }
      });

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    // In per_day / never modes the lifetime counter must not block the
    // send (their gates already ran above), but we still claim a slot so
    // `ai_reply_count` keeps tracking total bot replies for the thread.
    const lifetimeCap =
      activeConfig.autoReplyLimitMode === 'per_conversation'
        ? activeConfig.autoReplyMaxPerConversation
        : 2147483647;
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: lifetimeCap,
      }
    );
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr);
      return;
    }
    if (claimed !== true) return; // lost the per-conversation cap race

    // Channel-agnostic send: the orchestrator resolves the conversation's
    // channel connection (Meta / Twilio / legacy config) and persists the
    // message row. Replaces the Meta-hardcoded engineSendText path.
    //
    // If the send FAILS, refund the slot we claimed above — otherwise a
    // provider outage (e.g. Twilio 21703) burns through the whole
    // per-conversation cap with zero messages delivered, and the bot
    // goes permanently silent on the thread.
    try {
      await sendChannelMessage({
        accountId,
        conversationId,
        contactId,
        payload: { kind: 'text', text },
        senderType: 'bot',
        aiGenerated: true,
      });
      // Meter the plan's monthly AI-reply budget only after the send
      // landed (fire-and-forget — metering loss never fails a reply).
      void consumeMonthlyQuota(accountId, 'ai_replies');
    } catch (sendErr) {
      const { error: releaseErr } = await db.rpc('release_ai_reply_slot', {
        conversation_id: conversationId,
      });
      if (releaseErr) {
        console.error(
          '[ai auto-reply] failed to refund reply slot after send failure:',
          releaseErr
        );
      }
      throw sendErr; // handled by the outer catch (logged, never thrown)
    }
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err);
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
    accountId: string;
    conversationId: string;
    contactId: string;
    sentiment: string;
    reason: string;
  }
): Promise<void> {
  try {
    const { data: members, error } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', args.accountId);
    if (error || !members || members.length === 0) return;

    const readable = args.reason.replace(/_/g, ' ');
    const feeling =
      args.sentiment && args.sentiment !== 'neutral'
        ? ` — customer seems ${args.sentiment}`
        : '';
    const rows = members.map((m) => ({
      account_id: args.accountId,
      user_id: m.user_id,
      type: 'ai_escalation',
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      actor_user_id: null,
      title: 'Customer needs help',
      body: `AI escalated a conversation (${readable})${feeling} — unassigned in the shared queue.`,
    }));
    const { error: insErr } = await db.from('notifications').insert(rows);
    if (insErr) {
      console.error(
        '[ai auto-reply] escalation fan-out insert failed:',
        insErr
      );
    }
  } catch (err) {
    console.error('[ai auto-reply] escalation fan-out threw:', err);
  }
}

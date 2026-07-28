import { supabaseAdmin } from './admin-client';
import { loadAgentConfig } from './agents';
import { routeConversation } from './router';
import { buildConversationContext } from './context';
import { retrieveKnowledge } from './knowledge';
import { buildCrmContext } from './crm-context';
import { generateReply } from './generate';
import { buildPromptParts } from './defaults';
import { buildHandoffSummary } from './handoff';
import {
  resolveHandoffPosture,
  waitingMinutes,
  caretakerPromptOverlay,
  fallbackCaretakerMessage,
  caretakerPolicyFor,
} from './caretaker';
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
 *   - a human has actually replied on this thread, or an operator used
 *     the Resume AI kill-switch (see `resolveHandoffPosture`)
 *   - the per-conversation reply cap is reached (caretaker turns exempt)
 *   - there's nothing to reply to
 *
 * Note that mere *assignment* is no longer a gate: an escalated thread
 * nobody has answered yet keeps the assistant on in caretaker mode, so
 * the customer is never left talking to no one.
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
/**
 * Why a dispatch did not produce a reply. Every early return below maps to
 * exactly one of these, so "the bot said nothing" is always explainable
 * from the logs instead of being indistinguishable from a crash.
 *
 * Ordered roughly by how often each is the real answer in practice.
 */
type SkipReason =
  /** No agent row, or its `autoreply` capability is switched off. */
  | 'agent_not_configured'
  /** An active keyword / new_message flow owns this inbound; flows win. */
  | 'flow_autoresponder_active'
  /** A human actually replied, or an operator hit "Resume AI". */
  | 'human_took_over'
  /** Outside the routed agent's on-duty hours. */
  | 'outside_schedule'
  /** Lifetime per-conversation reply cap reached. */
  | 'reply_cap_per_conversation'
  /** Today's per-day reply cap reached. */
  | 'reply_cap_per_day'
  /** Caretaker budget spent, or inside its cool-off window. */
  | 'caretaker_budget_spent'
  /** Per-account burst throttle on the shared BYO key. */
  | 'account_rate_limited'
  /** Plan's monthly AI-reply budget exhausted. */
  | 'monthly_quota_exhausted'
  /** Nothing to reply to. */
  | 'no_messages'
  /** Conversation row vanished (deleted mid-flight). */
  | 'conversation_missing'
  /** Lost the concurrent race for the last reply slot. */
  | 'reply_slot_lost'
  /** Query/RPC error — a real fault, not a policy decision. */
  | 'conversation_load_failed'
  | 'per_day_count_failed'
  | 'caretaker_claim_failed'
  | 'reply_slot_claim_failed'
  /** The provider call itself threw (bad key, quota, network). */
  | 'generation_failed';

/** Reasons that indicate a FAULT rather than a deliberate policy skip. */
const FAULT_REASONS = new Set<SkipReason>([
  'conversation_load_failed',
  'per_day_count_failed',
  'caretaker_claim_failed',
  'reply_slot_claim_failed',
  'generation_failed',
]);

export async function dispatchInboundToAiReply(
  args: DispatchArgs
): Promise<void> {
  const { accountId, conversationId, contactId } = args;

  /*
   * Exactly ONE structured line per dispatch, always.
   *
   * This function has a dozen legitimate reasons to stay quiet, and every
   * one of them used to be a bare `return`. In production that is
   * indistinguishable from a crash — which is precisely why an outage went
   * undiagnosed: "auto-reply stopped working" could equally have meant a
   * failed query, a flow taking precedence, or a reply cap doing its job.
   *
   * Grep `[ai auto-reply]` in production logs and the answer is the first
   * thing you read. Faults are console.error so they surface in alerting;
   * policy skips are console.log so they stay cheap and non-noisy.
   */
  const decide = (
    outcome: SkipReason | 'replied' | 'escalated',
    detail?: Record<string, unknown>
  ) => {
    const isFault = FAULT_REASONS.has(outcome as SkipReason);
    const line =
      `[ai auto-reply] ${isFault ? 'FAULT' : 'outcome'}=${outcome} ` +
      `conversation=${conversationId} account=${accountId}` +
      (detail ? ` ${JSON.stringify(detail)}` : '');
    if (isFault) console.error(line);
    else console.log(line);
  };

  try {
    const db = supabaseAdmin();

    // Single default agent, "auto-reply" capability: only runs when the
    // agent's autoreply_enabled column is on. Unconfigured or switched
    // off → silent no-op (suggestions_enabled is irrelevant here).
    const config = await loadAgentConfig(db, accountId, 'autoreply');
    if (!config) {
      // By far the most common cause of "auto-reply isn't working": the
      // account has an agent but its auto-reply capability is off, or no
      // API key is set, so loadAgentConfig returns null.
      decide('agent_not_configured');
      return;
    }

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
    if (autoResponders && autoResponders.length > 0) {
      // Second most common surprise: activating ONE keyword flow silences
      // the LLM for the entire account, by design (no double-texting).
      decide('flow_autoresponder_active', { flowId: autoResponders[0].id });
      return;
    }

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select(
        'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_handoff_state, ai_caretaker_count, ai_last_caretaker_at, ai_escalated_at, ai_escalation_reason, channel'
      )
      .eq('id', conversationId)
      .maybeSingle();
    // This gate was a SILENT return, and it cost us a full outage: the
    // column list above spans several migrations, so a single unapplied
    // one makes Postgres fail the whole SELECT (42703) and every inbound
    // message aborted here with zero diagnostics — indistinguishable
    // from "the AI chose not to reply". Never fail quietly on a query
    // error again; a missing row is normal, a query error is not.
    if (convErr) {
      decide('conversation_load_failed', {
        code: convErr.code,
        message: convErr.message,
        // 42703 = undefined_column: migrations are behind on THIS database.
        hint:
          convErr.code === '42703'
            ? 'undefined_column — run: pnpm db:doctor --url=<this app\u2019s database>'
            : undefined,
      });
      return;
    }
    if (!conv) {
      decide('conversation_missing');
      return;
    }

    /*
     * Who owns this thread right now?
     *
     * This replaces two gates that short-circuited on `assigned_agent_id`
     * and on `ai_autoreply_disabled`. Escalation sets both itself, so the
     * assistant muted itself the instant it announced the handoff and the
     * customer's next message got nothing — indefinitely, even when no
     * human had opened the thread.
     *
     * `resolveHandoffPosture` separates "a name is attached" from "a
     * person actually spoke", and only the latter silences us.
     */
    const posture = resolveHandoffPosture(conv);
    if (posture === 'silent') {
      decide('human_took_over', {
        handoffState: conv.ai_handoff_state,
        killSwitch: conv.ai_autoreply_disabled,
        assigned: Boolean(conv.assigned_agent_id),
      });
      return;
    }
    const isCaretaker = posture === 'caretaker';

    const messages = await buildConversationContext(db, conversationId);
    if (messages.length === 0) {
      decide('no_messages');
      return;
    }

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
      decide('account_rate_limited', {
        limit: RATE_LIMITS.aiAutoReplyAccount.limit,
        windowMs: RATE_LIMITS.aiAutoReplyAccount.windowMs,
      });
      return;
    }

    // Plan quota: monthly AI-reply budget. Webhook context — there is
    // no user to show a 402 to, so over-quota means the bot silently
    // stands down and the inbound waits in the inbox for a human,
    // exactly like the schedule and reply-cap gates below.
    const aiQuota = await checkMonthlyQuota(accountId, 'ai_replies');
    if (!aiQuota.allowed) {
      decide('monthly_quota_exhausted', { limit: aiQuota.limit });
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
    if (!isWithinAutoReplySchedule(activeConfig)) {
      decide('outside_schedule', {
        agent: specialist?.id ?? config.agentId,
        start: activeConfig.autoReplyScheduleStart,
        end: activeConfig.autoReplyScheduleEnd,
        timezone: activeConfig.autoReplyTimezone,
      });
      return;
    }

    // Reply-cap gate, by the routed agent's limit mode:
    //  - never:            no cap — the bot always replies.
    //  - per_conversation: lifetime cap; cheap early-out here, the
    //                      authoritative check is the atomic claim below.
    //  - per_day:          cap resets at midnight in the agent's
    //                      timezone; counted from today's bot messages.
    //
    // Caretaker turns are exempt from both caps: they have their own,
    // tighter per-channel budget (CARETAKER_POLICY, claimed atomically
    // below). Applying the normal cap here would recreate the original bug — a
    // thread that escalated *at* its reply limit would fall straight back
    // into silence while still waiting on a human.
    if (
      !isCaretaker &&
      activeConfig.autoReplyLimitMode === 'per_conversation' &&
      conv.ai_reply_count >= activeConfig.autoReplyMaxPerConversation
    ) {
      decide('reply_cap_per_conversation', {
        replyCount: conv.ai_reply_count,
        cap: activeConfig.autoReplyMaxPerConversation,
      });
      return;
    }
    if (!isCaretaker && activeConfig.autoReplyLimitMode === 'per_day') {
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
        decide('per_day_count_failed', {
          code: cntErr.code,
          message: cntErr.message,
        });
        return;
      }
      if ((count ?? 0) >= activeConfig.autoReplyMaxPerConversation) {
        decide('reply_cap_per_day', {
          today: count ?? 0,
          cap: activeConfig.autoReplyMaxPerConversation,
          timezone: activeConfig.autoReplyTimezone,
        });
        return;
      }
    }

    /*
     * CARETAKER TURN.
     *
     * The thread is escalated and no human has spoken yet. We keep the
     * customer company on a tight budget instead of leaving them talking
     * to nobody, then hand off cleanly to the SLA watchdog.
     *
     * The slot is claimed BEFORE the provider call, for two reasons:
     * it's the concurrency guard (two "hello?" messages landing together
     * can't both win), and it means a burst can't run up provider spend
     * producing holding messages we'd throw away.
     */
    if (isCaretaker) {
      // Budget is per-channel: an SMS hold costs the tenant per segment,
      // and a (future) live call needs a far tighter cadence than chat.
      const policy = caretakerPolicyFor(conv.channel);
      const { data: claimed, error: claimErr } = await db.rpc(
        'claim_ai_caretaker_slot',
        {
          p_conversation_id: conversationId,
          p_max_messages: policy.maxMessages,
          p_cooloff_seconds: policy.cooloffSeconds,
        }
      );
      if (claimErr) {
        // Migration not applied, or a transient DB error. Fail safe:
        // stay quiet rather than risk an unbounded holding-message loop.
        decide('caretaker_claim_failed', {
          code: claimErr.code,
          message: claimErr.message,
          hint:
            claimErr.code === '42883'
              ? 'undefined_function claim_ai_caretaker_slot — migrations are behind'
              : undefined,
        });
        return;
      }
      if (claimed !== true) {
        // Budget spent or inside cool-off. Expected and healthy — the SLA
        // watchdog owns the thread from here.
        decide('caretaker_budget_spent', {
          used: conv.ai_caretaker_count,
          maxMessages: policy.maxMessages,
          cooloffSeconds: policy.cooloffSeconds,
        });
        return;
      }

      const waited = waitingMinutes(conv);
      const [knowledge, crmContext] = await Promise.all([
        retrieveKnowledge(db, accountId, config, latestUserMessage(messages)),
        buildCrmContext(db, contactId),
      ]);

      let holdingText: string | null = null;
      try {
        const caretakerReply = await generateReply({
          config: activeConfig,
          messages,
          promptParts: buildPromptParts({
            userPrompt: activeConfig.systemPrompt,
            mode: 'auto_reply',
            knowledge,
            crmContext,
            // Constrains the model to acknowledge and gather detail
            // without re-promising resolution or inventing specifics.
            extraInstructions: caretakerPromptOverlay({
              waitedMinutes: waited,
              escalationReason: conv.ai_escalation_reason,
            }),
          }),
          cacheKey: conversationId,
        });

        void logAiUsage(db, {
          accountId,
          conversationId,
          mode: 'auto_reply',
          agentId: specialist?.id ?? config.agentId,
          provider: activeConfig.provider,
          model: activeConfig.model,
          usage: caretakerReply.usage,
          keySource: config.keySource,
        });

        // A second handoff signal here is meaningless — we're already
        // waiting on a human — so only the prose is used.
        holdingText = caretakerReply.text || null;
      } catch (genErr) {
        console.error(
          '[ai auto-reply] caretaker generation failed, using fallback:',
          genErr
        );
      }

      // A caretaker turn must never end in silence: that is the whole
      // point. If generation failed or returned nothing, send the static
      // line, which escalates in honesty as the wait grows.
      try {
        await sendChannelMessage({
          accountId,
          conversationId,
          contactId,
          payload: {
            kind: 'text',
            text: holdingText ?? fallbackCaretakerMessage(waited),
          },
          senderType: 'bot',
          aiGenerated: true,
        });
      } catch (sendErr) {
        console.error('[ai auto-reply] caretaker send failed:', sendErr);
      }
      decide('replied', { mode: 'caretaker', usedFallback: !holdingText });
      return;
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
    const {
      text,
      handoff,
      usage,
      sentiment,
      escalationReason,
      language,
      affect,
    } = await generateReply({
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

    // Append to the affective history (ADR-002 §3). APPEND, never
    // update: the single overwritten ai_sentiment column is what made
    // "is this customer getting angrier?" unanswerable. Fire-and-forget
    // — a lost event costs one data point, never a customer reply. Runs
    // on BOTH branches below (escalation and normal reply): the
    // escalation turn is the most emotionally informative one of all.
    if (affect) {
      void db
        .from('conversation_affective_events')
        .insert({
          account_id: accountId,
          conversation_id: conversationId,
          emotions: affect.emotions,
          source: affect.source,
          language,
        })
        .then(({ error }) => {
          if (error) {
            console.error('[ai auto-reply] affect event insert failed:', error);
          }
        });
    }

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
        // Enter the caretaker phase. Crucially this does NOT set
        // `ai_autoreply_disabled` — that flag is now purely the operator
        // kill-switch ("Resume AI"). Setting it here is what made the
        // assistant mute itself the instant it announced a handoff and
        // left the customer talking to nobody.
        ai_handoff_state: 'awaiting_human',
        ai_handoff_summary: summary,
        ai_sentiment: sentiment,
        ai_escalation_reason: reason,
        ai_escalated_at: new Date().toISOString(),
        // Fresh budget for this escalation, so a thread escalated twice
        // isn't silenced by holding messages spent the first time.
        ai_caretaker_count: 0,
        ai_last_caretaker_at: null,
        ai_sla_reminder_count: 0,
        ai_sla_last_reminder_at: null,
        // Only when classified this turn — never null out a previously
        // detected language just because the model omitted the tag once.
        ...(language ? { ai_language: language } : {}),
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
      // Errors here MUST be inspected. This single UPDATE carries the
      // whole escalation (handoff state, assignee, caretaker + SLA
      // budgets). Postgres aborts the entire statement on one bad
      // column (42703), so an unapplied migration silently left threads
      // in 'none' while the bridge message below still promised the
      // customer a human — a promise with no follow-through, and the
      // exact failure that made auto-reply look broken.
      const { error: escalateErr } = await db
        .from('conversations')
        .update(update)
        .eq('id', conversationId);
      if (escalateErr) {
        console.error(
          '[ai auto-reply] CRITICAL: escalation state failed to persist —',
          'thread is NOT marked awaiting_human; falling back to notifying',
          'every member so the customer is not left waiting:',
          escalateErr
        );
      }

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
      // Also when the UPDATE failed: no assignment was written, so no
      // trigger fired and nobody would otherwise learn about this.
      if (escalateErr || (!assignee && !conv.assigned_agent_id)) {
        await notifyAllMembersOfEscalation(db, {
          accountId,
          conversationId,
          contactId,
          sentiment,
          reason,
        });
      }
      decide('escalated', {
        reason,
        assignee: assignee ?? conv.assigned_agent_id ?? null,
        statePersisted: !escalateErr,
      });
      return;
    }

    // Non-escalated turn: keep the latest classified sentiment (and
    // language, when given) on the conversation (cheap single UPDATE;
    // best-effort).
    void db
      .from('conversations')
      .update({
        ai_sentiment: sentiment,
        ...(language ? { ai_language: language } : {}),
      })
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
      decide('reply_slot_claim_failed', {
        code: claimErr.code,
        message: claimErr.message,
        hint:
          claimErr.code === '42883'
            ? 'undefined_function claim_ai_reply_slot — migrations are behind'
            : undefined,
      });
      return;
    }
    if (claimed !== true) {
      decide('reply_slot_lost', { cap: lifetimeCap });
      return;
    }

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
      decide('replied', {
        mode: 'normal',
        agent: specialist?.id ?? config.agentId,
        chars: text.length,
      });
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
    // Contract with the webhook: this NEVER throws, so the 200 to Meta is
    // never at risk. But it must never be silent either — emit the same
    // structured line as every other exit so a grep for `[ai auto-reply]`
    // returns one row per inbound with no gaps.
    decide('generation_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
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

/**
 * Supervised handoff — caretaker posture.
 *
 * Escalating used to mute the assistant instantly, because the escalation
 * path set `ai_autoreply_disabled = true` and assigned an agent, and the
 * auto-reply entry gate bailed on either one. The customer's next message
 * hit silence — even when nobody had opened the thread yet.
 *
 * The fix is to stop treating *assignment* as *contact*. Only a real
 * human message (`sender_type = 'agent'`, closed by a DB trigger) ends
 * the assistant's watch. Until then it stays on as a caretaker.
 */

/** How the assistant should behave on this thread right now. */
export type HandoffPosture =
  /** Bot owns the thread: full auto-reply. */
  | 'normal'
  /** Escalated, no human yet: bounded holding messages only. */
  | 'caretaker'
  /** A human is handling it (or the operator switched us off): say nothing. */
  | 'silent';

/** Subset of `conversations` the posture decision needs. */
export interface HandoffPostureRow {
  ai_handoff_state?: string | null;
  ai_autoreply_disabled?: boolean | null;
  ai_caretaker_count?: number | null;
  ai_last_caretaker_at?: string | null;
  ai_escalated_at?: string | null;
}

/**
 * Caretaker budget.
 *
 * The point of a cap is credibility, not cost. An assistant that emits
 * "someone will be with you shortly!" ten times is worse than one that
 * stays quiet — it reads as a broken robot and destroys trust in the
 * promise. We cover the realistic window for a human to arrive, then
 * stop talking and let the SLA watchdog escalate internally instead.
 */
export interface CaretakerPolicy {
  /** Max holding messages per escalated thread. */
  maxMessages: number;
  /**
   * Minimum gap between them. Absorbs the common
   * "hello?" / "are you there?" / "??" burst into a single reply.
   */
  cooloffSeconds: number;
}

/**
 * Channels we can hold a customer on.
 *
 * `voice` is declared but intentionally not wired to any transport yet.
 * It exists so the *shape* of the decision is per-channel from the start:
 * a live call has no useful notion of a 90-second holding cadence, and
 * discovering that after voice ships would mean reworking this module
 * rather than adding a row to a table.
 */
export type ChannelKind = 'whatsapp' | 'sms' | 'email' | 'voice';

/**
 * Per-channel caretaker policy.
 *
 * Mirrors the `channel_kind` Postgres enum (`whatsapp`, `email`, `sms`),
 * plus `voice` which is declared ahead of any transport.
 *
 * Async chat tolerates a slow, sparse cadence — the customer is not
 * staring at the screen. Live audio is the opposite: dead air *is* the
 * failure, so a voice caretaker must speak sooner and more often, and
 * "3 messages then stop" would read as an abandoned call rather than a
 * bounded hold. Same state machine, different numbers.
 */
export const CARETAKER_POLICY: Record<ChannelKind, CaretakerPolicy> = {
  whatsapp: { maxMessages: 3, cooloffSeconds: 90 },
  // Metered per segment, so hold the line more sparingly.
  sms: { maxMessages: 2, cooloffSeconds: 120 },
  // Threaded and slow by nature; a second holding email is usually noise.
  email: { maxMessages: 1, cooloffSeconds: 900 },
  // Placeholder until a live-call adapter exists (see ADR-002 §11).
  voice: { maxMessages: 8, cooloffSeconds: 15 },
};

/** Resolve policy for a channel, defaulting to the async-chat shape. */
export function caretakerPolicyFor(channel?: string | null): CaretakerPolicy {
  if (channel && channel in CARETAKER_POLICY) {
    return CARETAKER_POLICY[channel as ChannelKind];
  }
  return CARETAKER_POLICY.whatsapp;
}

/**
 * Default budget.
 *
 * Retained as the async-chat baseline so callers that have no channel in
 * hand keep working unchanged; prefer `caretakerPolicyFor(channel)`.
 */
export const CARETAKER_LIMITS = CARETAKER_POLICY.whatsapp;

/**
 * Decide who owns the thread.
 *
 * Note what is deliberately NOT here: `assigned_agent_id`. Assignment
 * means a name is attached, not that anyone has spoken — conflating the
 * two is what caused the original silence. Only `human_active` (set by
 * the `close_handoff_on_agent_message` trigger) silences us.
 */
export function resolveHandoffPosture(row: HandoffPostureRow): HandoffPosture {
  // Manual operator kill-switch always wins.
  if (row.ai_autoreply_disabled) return 'silent';

  switch (row.ai_handoff_state) {
    case 'human_active':
      return 'silent';
    case 'awaiting_human':
      return 'caretaker';
    default:
      // 'none', null, or an unknown value from a future migration.
      // Defaulting to 'normal' preserves pre-migration behaviour rather
      // than silently muting every thread if the column is missing.
      return 'normal';
  }
}

/** Minutes the customer has been waiting on a human, if known. */
export function waitingMinutes(row: HandoffPostureRow): number | null {
  if (!row.ai_escalated_at) return null;
  const started = new Date(row.ai_escalated_at).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.floor((Date.now() - started) / 60_000));
}

/**
 * Extra system-prompt guidance for a caretaker turn.
 *
 * The hard rule is the no-new-promises one. Left unconstrained, a model
 * asked to be reassuring will invent specifics — "your refund has been
 * approved", "they'll call within 5 minutes" — that no human agreed to.
 * That converts a minor wait into a broken commitment, which is worse
 * than the silence we're fixing.
 */
export function caretakerPromptOverlay(args: {
  waitedMinutes: number | null;
  escalationReason?: string | null;
}): string {
  const { waitedMinutes, escalationReason } = args;

  const lines = [
    '',
    '## CURRENT SITUATION: waiting for a teammate',
    'This conversation has already been escalated to a human teammate who has NOT replied yet.',
    'You are keeping the customer company until they arrive. You are not resolving the issue.',
    '',
    'Rules for this reply:',
    '- Do NOT repeat that you are "looping in" or "escalating" — the customer was already told, and repeating it sounds broken.',
    '- Do NOT promise a specific time, outcome, refund, replacement, or compensation. A human decides those.',
    '- Do NOT invent order, account, or delivery details. Use only what is in the context you were given.',
    '- You MAY answer general questions (policies, how a process works) from the knowledge base.',
    '- You MAY collect information that will help the teammate (order number, photos, what they have already tried).',
    '- If there is genuinely nothing useful to add, keep it brief and human. One or two sentences.',
    '- Match the customer\u2019s emotional register. Someone angry does not want cheerfulness.',
  ];

  if (waitedMinutes !== null && waitedMinutes >= 15) {
    lines.push(
      '',
      `The customer has been waiting about ${waitedMinutes} minutes. Acknowledge the delay honestly and without excuses. Do not pretend it has been quick.`
    );
  }

  if (escalationReason) {
    lines.push(
      '',
      `They were escalated because: ${escalationReason.replace(/_/g, ' ')}.`
    );
  }

  return lines.join('\n');
}

/**
 * Static caretaker line, used when the model produced nothing usable.
 *
 * Escalates in honesty as the wait grows rather than repeating the same
 * cheerful holding phrase, which is what makes bots feel fake.
 */
export function fallbackCaretakerMessage(waitedMinutes: number | null): string {
  if (waitedMinutes !== null && waitedMinutes >= 30) {
    return "I'm sorry — this is taking longer than it should. Your message hasn't been forgotten, and I've flagged it again for our team. If it's urgent, replying here will keep it at the top of their queue.";
  }
  if (waitedMinutes !== null && waitedMinutes >= 10) {
    return "Thanks for waiting — my teammate hasn't picked this up yet, but your message is in the queue and hasn't been missed. If there's any extra detail you can share meanwhile, it'll help them move faster.";
  }
  return "Thanks for the extra detail — I've added it to the thread for my teammate. They'll pick this up shortly.";
}

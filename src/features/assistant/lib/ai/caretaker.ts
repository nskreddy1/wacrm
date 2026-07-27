/**
 * Handoff posture — who is allowed to speak to the customer right now.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Escalation used to mute the assistant permanently via two independent
 * gates in `auto-reply.ts`:
 *
 *   if (conv.assigned_agent_id) return;      // fires on auto-assignment
 *   if (conv.ai_autoreply_disabled) return;  // set true by the handoff
 *
 * Both are set by the escalation path itself, so the moment the AI said
 * "I'm looping in a teammate" it also silenced itself. Every later
 * customer message was a no-op. If the assigned agent never opened the
 * thread, the customer waited forever with no reply and no follow-up.
 *
 * The root confusion: "a human was ASSIGNED" is not "a human REPLIED".
 * Only the second one justifies silence. Between those two events the
 * customer is nobody's responsibility — which is exactly the gap where
 * they were being abandoned.
 *
 * THE POSTURES
 * ------------
 *   autonomous -- normal operation, full capability.
 *   caretaker  -- escalated, no human has spoken yet. The AI stays with
 *                 the customer but with deliberately narrowed scope:
 *                 acknowledge, empathise, set expectations, collect
 *                 detail. It must NOT promise outcomes, quote policy, or
 *                 attempt the resolution it already escalated.
 *   silent     -- a human is actually handling it, or the customer asked
 *                 to be left alone. The only state where silence is right.
 */

/** Conversation fields the posture decision depends on. */
export type HandoffPostureInput = {
  ai_handoff_state?: string | null;
  assigned_agent_id?: string | null;
  ai_human_first_reply_at?: string | null;
  ai_caretaker_count?: number | null;
  ai_last_caretaker_at?: string | null;
};

export type HandoffPosture = 'autonomous' | 'caretaker' | 'silent';

/**
 * Caretaker guardrails.
 *
 * These exist to stop the fix becoming its own problem: an unbounded
 * caretaker would happily send a reassuring message to every inbound
 * forever, which reads as a bot stonewalling the customer and is worse
 * than a single honest wait. So we cap the total and space them out.
 */
export const CARETAKER_LIMITS = {
  /**
   * Max holding messages while waiting for a human. Past this the AI
   * goes quiet rather than repeating itself — at that point the SLA
   * watchdog escalating to another human is the right remedy, not more
   * chat from the bot.
   */
  maxMessages: 4,
  /**
   * Minimum gap between holding messages. Without this, three rapid-fire
   * customer messages ("hello?" "you there?" "??") would each draw their
   * own near-identical reassurance.
   */
  minIntervalMs: 90_000,
} as const;

/**
 * Decide who owns the conversation right now.
 *
 * Ordering matters: `human_active` and `resolved` are checked before the
 * assignment test, because once a human has genuinely engaged we defer to
 * them regardless of any other signal.
 */
export function resolveHandoffPosture(
  conv: HandoffPostureInput
): HandoffPosture {
  const state = conv.ai_handoff_state ?? 'none';

  // A human has spoken, or the thread is done. Stay out of the way.
  if (state === 'human_active' || state === 'resolved') return 'silent';
  if (conv.ai_human_first_reply_at) return 'silent';

  // Escalated and still waiting on a human → caretaker owns the customer.
  if (state === 'awaiting_human') return 'caretaker';

  /*
   * Assigned but not escalated and no human reply yet. This covers a
   * human manually claiming a thread. We treat assignment alone as a
   * claim of ownership and stay silent — a person who deliberately
   * picked up a conversation does not want the bot talking over them.
   *
   * This is intentionally different from the escalation path, where
   * assignment is automatic (round-robin) and therefore carries no
   * evidence that anyone has actually looked at it.
   */
  if (conv.assigned_agent_id) return 'silent';

  return 'autonomous';
}

/**
 * Whether a caretaker message is allowed on this turn, given the
 * per-thread budget and cool-off. Returns a reason when suppressed so the
 * caller can log why the customer got nothing.
 */
export function canSendCaretakerMessage(
  conv: HandoffPostureInput,
  now: Date = new Date()
): { allowed: boolean; reason?: 'budget_exhausted' | 'cooling_off' } {
  if ((conv.ai_caretaker_count ?? 0) >= CARETAKER_LIMITS.maxMessages) {
    return { allowed: false, reason: 'budget_exhausted' };
  }
  const last = conv.ai_last_caretaker_at
    ? new Date(conv.ai_last_caretaker_at).getTime()
    : null;
  if (last !== null && now.getTime() - last < CARETAKER_LIMITS.minIntervalMs) {
    return { allowed: false, reason: 'cooling_off' };
  }
  return { allowed: true };
}

/**
 * Prompt overlay for caretaker mode, appended to the agent's normal
 * persona so tone/brand voice survive.
 *
 * The constraints are the point. The model already decided it could not
 * resolve this, so letting it keep trying would re-litigate a decision
 * that was correct — and risk inventing a policy or a refund promise the
 * human then has to walk back. Its job here is purely to hold the
 * relationship: be present, be honest, be useful about logistics.
 */
export function caretakerPromptOverlay(opts: {
  escalationReason?: string | null;
  sentiment?: string | null;
  assigneeName?: string | null;
  waitedMinutes?: number | null;
}): string {
  const lines: string[] = [
    'HANDOFF IN PROGRESS — CARETAKER MODE.',
    '',
    'This conversation has been escalated to a human colleague, and that',
    'person has NOT replied yet. You are keeping the customer company',
    'until they arrive. You are explicitly NOT trying to solve the issue.',
    '',
    'You MUST:',
    '- Acknowledge what the customer just said, specifically.',
    '- Show genuine empathy proportionate to their frustration.',
    '- Be honest that a colleague is picking this up.',
    '- Collect any detail that will speed up the human (order number,',
    '  screenshots, timing, what they have already tried).',
    '- Keep it short. One or two sentences is usually right.',
    '',
    'You MUST NOT:',
    '- Promise a refund, replacement, credit, or any specific outcome.',
    '- Invent or quote policy, timelines, or prices.',
    '- Re-attempt the resolution you already escalated.',
    '- Claim the colleague is "online now" or give a precise ETA.',
    '- Repeat a reassurance you have already sent — add something new or',
    '  ask a genuinely useful question instead.',
  ];

  if (opts.escalationReason) {
    lines.push('', `Escalated because: ${opts.escalationReason}.`);
  }
  if (opts.sentiment && opts.sentiment !== 'neutral') {
    lines.push(
      `The customer reads as ${opts.sentiment}. Lead with acknowledgement,`,
      'not logistics. Do not be cheerful at them.'
    );
  }
  if (opts.assigneeName) {
    lines.push(`The colleague picking this up is ${opts.assigneeName}.`);
  }
  if (typeof opts.waitedMinutes === 'number' && opts.waitedMinutes >= 15) {
    lines.push(
      '',
      `They have already been waiting about ${opts.waitedMinutes} minutes.`,
      'Acknowledge the delay directly and apologise for it — do not',
      'pretend the wait has not happened.'
    );
  }

  return lines.join('\n');
}

/**
 * Deterministic fallback when the model is unavailable or returns nothing.
 *
 * Escalating and then saying nothing is the failure we are fixing, so
 * this path must never be empty. Varied by attempt so a customer who
 * sends several messages does not receive the identical sentence twice.
 */
export function fallbackCaretakerMessage(attempt: number): string {
  const ladder = [
    'Thanks for that — I’ve passed it to a colleague who can dig into this properly. They’ll follow up here as soon as they pick it up.',
    'Still with you — my colleague has this in their queue. If there’s anything else you can share in the meantime, it’ll help them move faster.',
    'Apologies for the wait. This is flagged as needing attention and someone will reply here directly. I haven’t forgotten about you.',
    'I know this is taking longer than it should. I’ve escalated it again so it gets picked up — thank you for bearing with us.',
  ];
  return ladder[Math.min(attempt, ladder.length - 1)];
}

/**
 * Sentiment / emotion / empathy telemetry.
 *
 * WHY A SEPARATE TABLE
 * --------------------
 * `conversations.ai_sentiment` is a single overwritten column. It can
 * answer "how does this customer feel right now?" and nothing else. It
 * cannot answer the questions that actually drive action:
 *
 *   - Is this thread getting worse turn over turn?
 *   - Did escalating actually calm the customer down?
 *   - Which agents/accounts trend negative?
 *   - How empathetic are our replies, and is that improving?
 *
 * Those all need a time series, so every classification is appended to
 * `conversation_sentiment_events` while the conversation column keeps
 * holding the latest value for cheap inbox reads.
 *
 * ON MODEL CHOICE
 * ---------------
 * Current practice for this is a hybrid: a cheap high-throughput
 * classifier for routine turns, with an LLM for ambiguous or
 * out-of-domain input. We already pay for an LLM call on every inbound to
 * produce the reply, so extracting sentiment from that same structured
 * response costs ~nothing extra and needs no second model, no Python
 * service, and no separate deployment. A dedicated classifier only starts
 * paying off if we later want to score turns the assistant does not
 * answer. `source` and `model` are recorded per row so a future swap
 * stays comparable rather than silently invalidating history.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Customer emotional state. Superset of the original 4 labels. */
export type SentimentLabel =
  | 'angry'
  | 'frustrated'
  | 'confused'
  | 'neutral'
  | 'satisfied'
  | 'happy';

/**
 * Ordinal ranking used for trend maths.
 *
 * Kept deliberately separate from the model's own `score`: this is a
 * stable mapping we control, so trend comparisons stay meaningful even if
 * a model starts calibrating its numeric output differently.
 */
export const SENTIMENT_RANK: Record<SentimentLabel, number> = {
  angry: -1,
  frustrated: -0.5,
  confused: -0.25,
  neutral: 0,
  satisfied: 0.5,
  happy: 1,
};

/** Labels that should surface a conversation in the at-risk queue. */
export const NEGATIVE_SENTIMENTS: readonly SentimentLabel[] = [
  'angry',
  'frustrated',
];

export type SentimentEventInput = {
  accountId: string;
  conversationId: string;
  contactId?: string | null;
  sentiment: SentimentLabel | string | null | undefined;
  /** Signed -1..1 intensity. Defaults to the ordinal rank of the label. */
  score?: number | null;
  confidence?: number | null;
  emotions?: string[] | null;
  empathyScore?: number | null;
  effortScore?: number | null;
  escalated?: boolean;
  escalationReason?: string | null;
  subject?: 'customer' | 'agent';
  source?: 'llm' | 'heuristic' | 'human';
  model?: string | null;
  messageId?: string | null;
};

/** Narrow an untrusted model string to a known label. */
export function normalizeSentiment(
  value: string | null | undefined
): SentimentLabel | null {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  return v in SENTIMENT_RANK ? (v as SentimentLabel) : null;
}

/** Clamp a model-supplied number into range, tolerating junk. */
function clamp(
  value: number | null | undefined,
  min: number,
  max: number
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

/**
 * Append one classification to the time series. Best-effort by design:
 * telemetry must never break or delay a customer-facing reply, so this
 * swallows its own errors and is safe to call without awaiting.
 */
export async function recordSentimentEvent(
  db: SupabaseClient,
  input: SentimentEventInput
): Promise<void> {
  const label = normalizeSentiment(
    typeof input.sentiment === 'string' ? input.sentiment : null
  );
  // Nothing classifiable and no empathy score → no row worth writing.
  if (!label && input.empathyScore == null) return;

  try {
    const { error } = await db.from('conversation_sentiment_events').insert({
      account_id: input.accountId,
      conversation_id: input.conversationId,
      contact_id: input.contactId ?? null,
      sentiment: label ?? 'neutral',
      score:
        clamp(input.score, -1, 1) ?? (label ? SENTIMENT_RANK[label] : null),
      confidence: clamp(input.confidence, 0, 1),
      emotions: input.emotions ?? [],
      empathy_score: clamp(input.empathyScore, 0, 1),
      effort_score: clamp(input.effortScore, 0, 1),
      escalated: input.escalated ?? false,
      escalation_reason: input.escalationReason ?? null,
      subject: input.subject ?? 'customer',
      source: input.source ?? 'llm',
      model: input.model ?? null,
      message_id: input.messageId ?? null,
    });
    if (error) {
      console.error('[sentiment] event insert failed:', error);
    }
  } catch (err) {
    console.error('[sentiment] event insert threw:', err);
  }
}

/**
 * Direction of travel across a thread's classifications.
 *
 * Compares the mean of the first half against the second half rather than
 * first-vs-last, because single turns are noisy — one clipped "fine" reply
 * should not register as a collapse in sentiment.
 */
export function sentimentTrend(
  events: { sentiment: string; score?: number | null }[]
): { direction: 'improving' | 'declining' | 'stable'; delta: number } {
  if (events.length < 2) return { direction: 'stable', delta: 0 };

  const values = events.map((e) => {
    if (typeof e.score === 'number' && Number.isFinite(e.score)) return e.score;
    const label = normalizeSentiment(e.sentiment);
    return label ? SENTIMENT_RANK[label] : 0;
  });

  const mid = Math.floor(values.length / 2);
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

  const delta = mean(values.slice(mid)) - mean(values.slice(0, mid));

  // 0.15 on a 2.0-wide scale: wide enough to ignore label jitter, narrow
  // enough to catch a genuine one-step slide (e.g. neutral → frustrated).
  if (delta > 0.15) return { direction: 'improving', delta };
  if (delta < -0.15) return { direction: 'declining', delta };
  return { direction: 'stable', delta };
}

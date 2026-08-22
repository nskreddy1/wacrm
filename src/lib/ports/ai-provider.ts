/**
 * AIProvider port — Strategy pattern for AI text generation (plan
 * addendum §B). This records the RULES; it is deliberately not a
 * rewrite of the working generation code.
 *
 * Binding rules (enforced by review + `check:architecture` ARCH-008):
 *
 * 1. NO `if (provider === 'openai')`-style branching outside the
 *    factory/catalog modules (`src/features/assistant/lib/ai/
 *    providers.ts`, `model-catalog.ts`, `reasoning-controls.ts` are
 *    the factory boundary and may branch; nothing above them may).
 * 2. Langfuse/tracing becomes a `TracingAIProvider` DECORATOR around
 *    this port (Task 6) — never inlined into business code.
 * 3. The circuit breaker (addendum §B) wraps implementations of this
 *    port when enabled per provider — AI providers and external
 *    messaging APIs only, never Postgres.
 * 4. Fallback between providers is decided by explicit per-account
 *    config policy, never provider-chain roulette.
 *
 * The existing `src/features/assistant/lib/ai/generate.ts` conforms
 * incrementally: it already funnels every provider through one
 * factory-built client. Migrate violations when touched — do not
 * refactor working provider code for aesthetics.
 */

export interface GenerateReplyInput {
  /** Stable system/prefix blocks (prompt-cache aligned — stable text
   *  first so providers reuse the cached prefix across replies). */
  system: string;
  /** Chronological conversation turns. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Model id as the account configured it (provider-scoped). */
  model: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** Provider-side prompt-cache affinity key (e.g. conversation id). */
  cacheKey?: string;
}

export interface GenerateReplyResult {
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AIProvider {
  generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult>;
}

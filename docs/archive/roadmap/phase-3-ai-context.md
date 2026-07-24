# Phase 3 — AI Per-Account Context Window + Rolling Summarization (TODO)

The AI auto-reply engine already exists (migrations 029-033, `src/lib/ai/*`):
auto-reply on behalf of the client with BYO key, account + per-conversation
toggles, reply caps, rate limits, usage logging, basic `[[HANDOFF]]`.

Today the context window is a fixed env var (`AI_CONTEXT_MESSAGE_LIMIT`,
default 20) and older messages are simply cut off — the bot forgets everything
beyond the window.

## Work items (migration `043_ai_context_and_routing.sql`, shared with phase 4)

1. **Per-account context window**
   - `ai_configs.context_message_limit INTEGER DEFAULT 10 CHECK (context_message_limit BETWEEN 4 AND 30)`
   - `buildConversationContext()` (`src/lib/ai/context.ts`) uses the account
     value; env var remains the fallback.
   - Surface the setting in `src/components/settings/ai-config.tsx`.

2. **Rolling conversation summarization**
   - `conversations.ai_context_summary TEXT`,
     `conversations.ai_summarized_message_count INTEGER DEFAULT 0`.
   - New `src/lib/ai/summarize.ts`: when total messages exceed the window and
     ≥ window-size messages are not yet covered by the stored summary, one
     cheap LLM call folds them in ("Summary so far + new messages → updated
     summary"), persisted on the conversation.
   - `dispatchInboundToAiReply()` (`src/lib/ai/auto-reply.ts`) runs the
     summary refresh best-effort BEFORE generating (failure never blocks the
     customer-facing reply).
   - Summary is prepended to the system prompt ("Earlier in this
     conversation: ..."), so the provider only ever receives ~10 raw messages
     - a short summary. Token-optimal long-term memory.

## Verification

- Unit tests: fold logic, per-account limit resolution (extend existing
  `src/lib/ai/*.test.ts` suites).
- Simulated 25-message conversation → provider payload contains only ~10 raw
  messages + summary.

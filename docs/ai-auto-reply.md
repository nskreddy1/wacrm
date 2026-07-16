# AI Auto-Reply — Enterprise Chatbot Architecture

Status: **Phase 1 in progress** (this document is updated at the end of each phase so it always matches shipped behavior).

## Overview

Every inbound WhatsApp message (Meta Cloud API or Twilio webhook) that is not consumed by a
deterministic Flow is dispatched to the AI auto-reply pipeline:

```
inbound webhook (Meta / Twilio)
  └─ after(): dispatchInboundToAiReply()          src/lib/ai/auto-reply.ts
       ├─ loadAiConfig()                          src/lib/ai/config.ts
       │    (per-account BYO key → env fallback)
       ├─ eligibility gates (assigned agent, cap, rate limit, active automations)
       ├─ buildConversationContext()              recent turns
       ├─ retrieveKnowledge()                     src/lib/ai/knowledge.ts
       │    hybrid RAG: pgvector semantic + Postgres FTS
       ├─ buildSystemPrompt()                     src/lib/ai/defaults.ts
       │    grounded, scope-guarded, handoff protocol
       ├─ generateReply()                         src/lib/ai/generate.ts
       │    provider adapter (OpenAI / Anthropic / Gemini)
       └─ sendChannelMessage()                    outbound over the right channel
```

## Gemini API key resolution (Phase 1)

`loadAiConfig(db, accountId)` resolves the key in this order:

1. **Account BYO key** — `ai_configs` row with `is_active = true` and a non-empty
   (AES-256-GCM encrypted) `api_key`. `keySource: 'account'`.
2. **Environment fallback** — no `ai_configs` row at all (or a row with an empty key that is
   still active/default) **and** `process.env.GEMINI_API_KEY` is set: a synthetic config is
   returned — provider `gemini`, model `gemini-flash-latest`, auto-reply enabled, cap 10
   replies/conversation, no handoff agent. `keySource: 'env'`.
3. **Explicit off wins** — a row with `is_active = false` returns `null` regardless of the
   env key. Turning the assistant off in Settings always disables AI for that account.

`ai_usage_log` rows record `key_source` in metadata so shared-env-key spend is auditable
per tenant.

## Scope guard (Phase 1)

The system prompt instructs the model to **only** answer questions about the business,
grounded in the business context and retrieved knowledge-base excerpts. Off-topic questions
get a polite "I can only help with questions about this business" reply instead of a
general-knowledge answer. In auto-reply mode, questions the knowledge base cannot answer
trigger the handoff protocol instead of guessing.

## Classification + escalation contract (Phase 2 — planned)

The same Gemini call that generates the reply appends a single trailing metadata line:

```
[[META]]{"sentiment":"angry|frustrated|neutral|happy","escalate":bool,"reason":"human_requested|angry_customer|out_of_scope|needs_account_data|purchase_ready|none"}
```

- Parsed and stripped by `parseGeneration()`; malformed/missing meta degrades to
  `{sentiment: "neutral", escalate: false}`. The legacy `[[HANDOFF]]` sentinel is still
  honored as a fallback.
- `conversations` gains `ai_sentiment`, `ai_escalation_reason`, `ai_escalated_at`
  (migration 041).

### Escalation routing (Phase 2 — planned)

On escalation (`handoff || escalate || empty reply`):

1. Auto-reply is disabled for the conversation (sticky) and a handoff summary note is written.
2. Assignment order:
   - explicit `handoff_agent_id` from Settings, if configured;
   - else **round-robin** via `claim_round_robin_agent(account_id)` — atomically picks the
     account member with the oldest last AI assignment;
   - else the conversation stays in the shared queue and a notification is inserted for
     **every account member** so nothing goes silent.
3. Assignment fires the existing `on_conversation_assigned` trigger → in-app notification,
   enriched with sentiment + escalation reason.

## Verification / smoke test

Test user: `admin@gmail.com` / `admin`.

1. Send an inbound WhatsApp sandbox message with a question the knowledge base covers →
   expect a grounded AI reply delivered back over WhatsApp.
2. Ask an off-topic question ("what's the weather?") → expect a polite scope-guard reply.
3. Check `ai_usage_log` for the call with the correct `key_source`.
4. (Phase 2) Send "I want to talk to a human, this is terrible" → expect escalation:
   auto-reply off, sentiment/reason stored, agent assigned round-robin, notification visible
   in the dashboard.

## Out of scope (this pass)

- Departments/teams — none exist yet; round-robin is account-wide. The RPC signature leaves
  room for a `department_id` param later.
- Twilio audit checklist items (separate workstream).
- Moving the in-memory rate limiter to a durable store (documented enterprise gap).

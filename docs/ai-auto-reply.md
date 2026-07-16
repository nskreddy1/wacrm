# AI Auto-Reply — Architecture & Operations

Living documentation for the Gemini-powered auto-reply pipeline. Updated at
the end of each implementation phase so this always matches shipped behavior.

## Overview

```
Inbound WhatsApp message
  └─ webhook (Meta /api/channels/webhooks/meta, Twilio /api/channels/webhooks/twilio,
              legacy /api/whatsapp/webhook)
       └─ after(): dispatchInboundToAiReply()          src/lib/ai/auto-reply.ts
            ├─ loadAiConfig()                          src/lib/ai/config.ts
            │    (per-account encrypted BYO key, or env GEMINI_API_KEY fallback)
            ├─ eligibility gates (flows win, human assigned, paused, cap, rate limit)
            ├─ retrieveKnowledge()  — hybrid RAG       src/lib/ai/knowledge.ts
            │    (pgvector semantic + Postgres FTS)
            ├─ generateReply()  — provider call        src/lib/ai/generate.ts
            │    parses [[HANDOFF]] + [[META]] classification tail
            ├─ escalation? → pause bot, round-robin assign, notify
            └─ sendChannelMessage()  — channel-agnostic send
```

## Key resolution order (Phase 1)

`loadAiConfig()` resolves the provider key in this order:

1. **Account key** — `ai_configs` row with a non-empty encrypted `api_key`.
   `keySource: 'account'`.
2. **Env fallback** — no `ai_configs` row (or a row whose `api_key` is empty)
   AND `process.env.GEMINI_API_KEY` is set → a synthetic Gemini config:
   - `provider: 'gemini'`, `model: AI_PROVIDER_DEFAULT_MODEL.gemini`
   - `autoReplyEnabled: true`, cap 10 replies/conversation
   - `handoffAgentId: null` (shared queue → round-robin)
   - `keySource: 'env'`
3. **Explicit off wins** — a row with `is_active = false` returns `null`
   even when the env key is set. An admin turning AI off must stick.

`ai_usage_log.key_source` records which key paid for each call, so shared
env-key spend is auditable per tenant.

## Scope guard

The system prompt (`src/lib/ai/defaults.ts`) instructs the model to only
answer questions about this business using the business context and knowledge
excerpts, and to politely decline unrelated topics ("I can only help with
questions about this business").

## [[META]] classification contract (Phase 2)

In auto-reply mode the model ends every reply with one trailing line:

```
[[META]]{"sentiment":"angry|frustrated|neutral|happy","escalate":bool,"reason":"human_requested|angry_customer|out_of_scope|needs_account_data|purchase_ready|none"}
```

`parseGeneration()` (src/lib/ai/generate.ts) strips and parses this tail.
Tolerant by design: missing/malformed meta → `{sentiment:'neutral',
escalate:false, reason:null}`. The legacy bare `[[HANDOFF]]` sentinel still
forces a handoff, so nothing breaks mid-deploy.

## Escalation & round-robin flow (Phase 2)

On `handoff || meta.escalate || !text`:

1. Conversation gets `ai_autoreply_disabled = true`, `ai_handoff_summary`,
   `ai_sentiment`, `ai_escalation_reason`, `ai_escalated_at`.
2. Assignment order:
   - explicit `ai_configs.handoff_agent_id` if set, else
   - `claim_round_robin_agent(account_id)` — atomically picks the account
     member with the oldest `profiles.last_ai_assignment_at`
     (`FOR UPDATE SKIP LOCKED`), else
   - left unassigned in the shared queue.
3. Notifications:
   - assigned → the `on_conversation_assigned` DB trigger notifies the agent
     (body includes sentiment + escalation reason when present);
   - unassigned → a `notifications` row (`type='ai_escalation'`) is inserted
     for **every** account member so an empty queue never goes silent.

On every non-escalated generated turn, `ai_sentiment` is written to the
conversation (merged into existing updates — no extra round trip).

## Inbox controls

- `AiThreadBanner` (src/components/inbox/ai-thread-banner.tsx) shows
  "AI is replying automatically / Take over" or "paused / Resume AI" per
  thread. It renders only when the account's auto-reply is live — the GET
  `/api/ai/config` response includes `auto_reply_live`, computed server-side
  with the same rules as `loadAiConfig` **including the env fallback**, so
  accounts riding the shared env key still get the toggle.
- Toggle endpoint: `POST /api/ai/autoreply/[conversationId]`
  `{ paused: boolean, assign_to_me?: boolean }`. Resume clears the pause,
  assignment, reply count, handoff summary, and escalation fields.
- Escalated threads show a badge ("AI escalated · <reason>") plus a
  sentiment indicator in the thread header.

## Smoke-test procedure

Test user: `admin@gmail.com` / `admin`.

Phase 1 (auto-reply end-to-end):
1. Send an inbound WhatsApp sandbox message with a question covered by the
   knowledge base → verify a grounded AI reply is delivered over WhatsApp.
2. Ask an off-topic question ("what's the weather?") → verify a polite
   "I can only help with this business" reply.
3. Verify an `ai_usage_log` row with the correct `key_source`.

Phase 2 (escalation):
1. Send "I want to talk to a human, this is terrible" → verify escalation:
   bot paused, round-robin assignment (or member-wide notification when the
   account has no other member), sentiment + reason on the conversation, and
   a notification in the dashboard.
2. Verify "Resume AI" in the inbox banner clears the escalation state and
   the bot replies again.

## Known gaps / out of scope

- Departments/teams — round-robin is account-wide; the RPC accepts a future
  `department_id` param without a signature break.
- The in-memory rate limiter is per-instance (documented enterprise gap).

# Report — Inbound Message Handling & Agent Architecture at Scale

**Date:** 2026-07-26. **Status:** as-built audit, traced from source. No code
changed. Question answered: *"hundreds of people message our number(s) at once —
how does the agent pick them up and reply simultaneously? What if we have 3–4
numbers/bots?"*

---

## 1. Entry points — 3 webhooks

| Route | Provider | Signature check | maxDuration |
|---|---|---|---|
| `/api/whatsapp/webhook` | Meta Cloud API (direct/legacy) | HMAC SHA-256 `x-hub-signature-256` over **raw bytes** | 60s |
| `/api/channels/webhooks/twilio` | Twilio **WhatsApp + SMS** (one URL, both) | HMAC SHA-1 `x-twilio-signature` over canonical URL + sorted params | 30s |
| `/api/channels/webhooks/meta` | Meta via `channel_connections` | same as above | — |

Signature verification happens **before** any parsing or DB work. Meta route
returns **401** (not 200) on bad signature deliberately, so Meta's dashboard
shows failures loudly instead of silently eating events.

---

## 2. Concurrency model — how "hundreds at once" actually works

**Parallelism comes from the platform, not from our code.** Each inbound
message is a separate HTTP POST from Meta/Twilio → a separate serverless
invocation on Vercel, which scales horizontally and automatically. 300 people
messaging in the same second → up to ~300 concurrent invocations, each handling
its own message independently. There is **no shared worker pool and no queue**.

**Ack-first pattern (both routes):**
```
verify signature → parse → after(() => process...) → return 200 immediately
```
`after()` is used deliberately instead of a floating promise: on serverless the
function can be frozen the instant the response is sent, which previously
dropped a non-deterministic subset of inbound messages (contacts/conversations
created, message insert never landed → empty threads in the inbox, issue #301).
`after()` keeps the invocation alive until the callback resolves, bounded by
`maxDuration`. This keeps us inside Meta's ~20s ack timeout, avoiding their
retry-storm → duplicate inserts.

**Inside one invocation, work is sequential.** Meta can batch several messages
into one webhook (`entry[].changes[].value.messages[]`); we loop with `await`
per message. So a burst on a *single* number serializes within that batch.

---

## 3. Multi-number / multi-bot routing (the 3–4 numbers question)

Every inbound is resolved to a tenant **by the receiving number**:

- **Meta:** `whatsapp_config.phone_number_id` → `account_id` (+ `user_id` as
  sender-of-record). UNIQUE constraint since migration 013.
- **Twilio:** `channel_connections` matched on
  `(provider='twilio', channel, external_identity = our number, is_enabled)`
  → `account_id`.
- **Channel discriminator:** Twilio address format — `whatsapp:+1555…` vs bare
  `+1555…` — so the *same* webhook URL serves WhatsApp and SMS for the same
  number with **no cross-routing**.

**Result: each number is an independent lane bound to its own workspace.**
4 numbers = 4 config/connection rows → 4 isolated tenants. No shared state
between them; isolation is enforced by `account_id` on every downstream
contact/conversation/message row. **Adding numbers needs zero code change** —
it is pure configuration.

**Defensive tenancy (Meta route):**
- 0 matching configs → log + skip.
- **≥2 matching configs → drop the message + loud error listing the owning
  accounts.** It refuses to guess which tenant owns the number. Correct
  (no cross-tenant leak) but note it is a *silent drop* for the customer.

**Twilio status-callback fallback:** failed sends can arrive with an empty
`From` (e.g. error 21703 — Messaging Service had no sender). The route falls
back to resolving the account via the globally-unique `MessageSid` → message row
→ account, so delivery failures aren't dropped and messages don't show "sent"
forever.

---

## 4. Duplicate protection & per-thread safety

| Concern | Mechanism | Verdict |
|---|---|---|
| Provider retries / replays | `channel_events` UNIQUE; PG `23505` → `{duplicate:true}` → orchestration skipped | **Idempotent** |
| Same person, 2 messages fast | Contact upsert `onConflict: account_id,channel,normalized_identity` | Safe |
| Concurrent inbounds overshooting the AI reply cap | `claim_ai_reply_slot` RPC — **atomic check + increment in one UPDATE**; loser skips | **Race-free** |
| Send fails after slot claimed | `release_ai_reply_slot` refunds it — prevents a provider outage burning the whole cap and silencing the bot | Good |
| Status regressions on replay | Forward-only ladder `pending→sent→delivered→read→replied`; `failed` accepted only from `pending`/`sent` | Good |

---

## 5. The agent decision pipeline (per inbound message)

`orchestrateInboundChannelMessage` — **deterministic flows win over the LLM:**
1. `dispatchInboundToFlows` → `if (flowResult.consumed) return;`
2. contact-created event, if new
3. text messages only → `dispatchInboundToAiReply`

Inside auto-reply, a gate ladder (any failure → silent no-op, message still
sits in the inbox for a human):

1. Agent config with `autoreply` capability enabled
2. **Active `new_message_received`/`keyword` flow exists → stand down** (avoids
   double-texting the customer)
3. Human assigned to the thread → stop
4. `ai_autoreply_disabled` (prior handoff) → stop
5. Per-account rate limit *(see RISK-1)*
6. **Supervisor router (multi-agent):** keyword triggers → on-duty filter → LLM
   classifier → fallback to default agent. Routed agent's guardrails apply,
   inheriting the default's where unset. Fails open.
7. Routed agent's **schedule window** (so a night-shift agent can answer when
   the default is off the clock)
8. Reply cap by mode: `never` / `per_conversation` (lifetime) / `per_day`
   (resets at midnight in the *agent's* timezone). Per-day count failure →
   fail-safe, don't reply.
9. Knowledge retrieval + CRM context fetched **in parallel**
10. `generateReply` with **cache-aligned prompts** (~70% fewer full-price input
    tokens: stable blocks as system prefix, retrieved knowledge as final turn)
11. **Handoff path:** pause bot → assign (configured handoff agent →
    `claim_round_robin_agent` RPC → shared queue) → send a **warm bridge
    message** (never silence/cold refusal) → if unassigned, notify **every**
    member so escalations are never silent
12. Else: atomic slot claim → `sendChannelMessage` (channel-agnostic: resolves
    Meta/Twilio/legacy and persists the row)

Token spend is logged fire-and-forget so it adds no customer-facing latency,
attributed to the specialist that actually answered.

**Assessment:** this pipeline is genuinely strong — multi-agent routing,
per-agent duty hours, atomic caps, warm handoff, prompt caching. The *decision
logic* is not the scale problem. The *delivery substrate* is.

---

## 6. Scale risks (ordered by severity)

### RISK-1 — CRITICAL: rate limiter is in-memory, so it does not hold under fan-out
`src/lib/rate-limit.ts` is a fixed-window counter in a **per-process `Map`**.
The file documents the trade-off honestly ("fine for a single-instance VPS…
horizontal scale silently defeats the limit"). On Vercel, concurrent inbounds
land on **different instances**, each with a fresh Map. So
`aiAutoReplyAccount: 30/min` — the guard specifically designed for "a marketing
blast landing 200 replies at once" — **is not globally enforced**. 200
simultaneous inbounds can each see an empty bucket and all call the LLM.
Consequences: blows past the provider's rate limit, burns the owner's BYO key
budget, and the intended protection is illusory precisely in the scenario it
was written for.
→ **Fix:** back it with Upstash Redis / Durable Objects. Return shape is already
designed for a drop-in swap; **call sites don't change.**

### RISK-2 — HIGH: broadcast fan-out is sequential inside one HTTP request
`/api/whatsapp/broadcast` does `for (const recipient of recipients) { await
sendTemplateMessage(...) }` in the request. At ~200ms/send, 1,000 recipients ≈
200s → **exceeds maxDuration → times out mid-send**, and with no idempotency key
a retry **double-sends** to everyone already delivered. This is the single
biggest correctness risk at scale (matches W2 in
`current-architecture-review.md`).
→ **Fix:** outbox table + queue/cron worker, idempotency key per recipient,
bounded concurrency with provider-aware pacing.

### RISK-3 — MEDIUM: no retry/dead-letter for the agent path
Processing lives in `after()`, bounded by `maxDuration`. A slow LLM or provider
can get the invocation killed mid-pipeline: the inbound is persisted but **no
reply is sent and nothing retries** (there is no queue). Failure is invisible.
→ **Fix:** same durable outbox; enqueue "generate+send reply" as a retryable job.

### RISK-4 — MEDIUM: batched messages processed serially
A single webhook carrying N messages processes them one at a time. Bursts
concentrated on **one** number serialize (cross-number traffic is unaffected —
separate invocations).
→ **Fix:** bounded `Promise.all` per batch, preserving per-conversation order.

### RISK-5 — MEDIUM: no centralized observability
No Sentry/structured tracing. At hundreds of msgs/min, "why didn't this
customer get a reply?" is not answerable — the gate ladder has ~10 silent
no-op exits, all invisible in aggregate.
→ **Fix:** emit a decision-outcome metric at each gate exit + error tracking.

### RISK-6 — LOW/correctness: ambiguous-number drop is silent to the customer
The ≥2-config case is right to refuse, but the sender gets nothing and no alert
fires. Should raise an operator alert.

**Correction to a prior claim:** `current-architecture-review.md` (W5) said
"no tests." **That was wrong** — the repo has substantial coverage
(`auto-reply.test.ts`, `handoff.test.ts`, `schedule.test.ts`, `usage.test.ts`,
`webhooks/{deliver,sign,ssrf,events,endpoints}.test.ts`,
`webhook-signature.test.ts`, `template-webhook.test.ts`, prompt-caching
benchmarks). W5 should be narrowed to "no RLS/tenant-isolation tests and no
config-matrix tests."

---

## 7. Capacity assessment (today, as-built)

| Stage | Bound by | Realistic today |
|---|---|---|
| Signature verify + persist inbound | DB writes | Thousands/min — **not the bottleneck** |
| Tenancy resolution per number | Indexed lookup | Unlimited numbers, linear rows |
| Flow dispatch | DB | High |
| AI reply generation | **LLM provider latency + rate limits** | ~2–6s each; hundreds concurrent *if* RISK-1 fixed |
| Outbound broadcast | **Sequential loop in one request** | **~few hundred recipients max before timeout** |

**Verdict:** inbound *ingestion and routing* is architecturally sound and
genuinely multi-tenant — many numbers, many bots, hundreds of concurrent
senders are handled correctly today, with real idempotency and race-free reply
caps. The weaknesses are all in the **delivery/throttle substrate**: an
in-memory limiter that doesn't survive fan-out (RISK-1) and request-scoped
broadcast fan-out with no retries (RISK-2). Neither requires re-architecting
the agent logic — both are the "durable send pipeline + shared limiter" work
already identified as the top 10x fixes in
`current-architecture-review.md`.

**Recommended order:** RISK-1 (Redis limiter, small change, prevents budget
blowout) → RISK-2 (outbox + idempotency) → RISK-3 (reuse outbox for replies) →
RISK-5 (observability) → RISK-4/6.

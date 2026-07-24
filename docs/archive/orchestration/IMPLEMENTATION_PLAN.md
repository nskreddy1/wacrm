# Multi-Channel Messaging Orchestration — Implementation Plan & Progress

> Living document. Status is updated after every completed step.
> Statuses: `todo` | `in-progress` | `done` | `blocked` | `deferred`

## Goal

One channel-agnostic orchestration core for all messaging (Meta WhatsApp, Twilio WhatsApp,
Email via Resend/SMTP — designed so SMS drops in later with zero orchestrator changes):

- **Outbound:** single `sendChannelMessage()` path → adapter registry → durable outbox
  (retries, backoff, rate limits, DLQ) → unified delivery-status tracking.
- **Inbound:** one normalize → identity → conversation → persist pipeline, then one
  router running Flows → Automations → AI (deterministic wins) for every channel.
- **AI:** named agents scoped per-channel / per-connection / role-based (sales, support,
  billing) with intent routing, backfilled from the existing single config.

Design principle: the orchestration core never knows about providers; adapters never know
about business logic.

Full analysis: see the plan in `docs/architecture-delta.md` conventions and this file's
history. All DB changes are additive (strangler pattern; legacy paths keep working until
their callers are migrated).

---

## Progress Overview

| Phase | Scope                                                     | Status      |
| ----- | --------------------------------------------------------- | ----------- |
| 1a    | `MetaWhatsAppAdapter` + extended outbound contracts       | done        |
| 1b    | Unified outbound orchestrator `sendChannelMessage()`      | done        |
| 1c    | Migrate callers (dashboard, flows, automations, AI reply) | in-progress |
| 2     | Durable outbox + unified delivery tracking                | todo        |
| 3     | Channel-agnostic inbound pipeline + router                | todo        |
| 4     | AI agent layer (per-channel + role-based)                 | todo        |
| 5     | Observability & hardening                                 | todo        |

---

## Phase 1 — Unified Outbound Orchestrator

**Goal:** every outbound message (dashboard reply, flow, automation, AI reply, broadcast
recipient) flows through one function.

### 1a. MetaWhatsAppAdapter + contracts — `done`

- [x] Extended `OutboundChannelMessage` in `src/lib/channels/contracts.ts` with the
      `OutboundMessagePayload` typed union: `text | media | template | interactive | email`
      (legacy flat fields kept for backward compatibility).
- [x] New `src/lib/channels/adapters/meta.ts` — `MetaWhatsAppAdapter` wrapping the
      existing `meta-api.ts` senders (text, media) + direct template/interactive posts,
      including phone-variant retry (error 131030). Registered in `adapters/index.ts`.
- [x] Type-check passed.

### 1b. Outbound orchestrator — `done`

- [x] New `src/lib/orchestration/outbound.ts` — `sendChannelMessage(args)`:
      resolves conversation → pinned `channel_connection_id` → account's enabled
      WhatsApp connection (primary first) → legacy `whatsapp_config` fallback
      (shared `sendMetaPayload` helper, phone-variant retry, contact phone
      auto-fix). Persists the `messages` row (correct `sender_id`/`sender_type`
      per schema 001), updates conversation preview. Type-check passed.

### 1c. Migrate callers — `in-progress`

- [ ] Flows `src/lib/flows/meta-send.ts` → thin wrapper over orchestrator.
- [ ] Automations `src/lib/automations/meta-send.ts` → thin wrapper.
- [ ] AI auto-reply `src/lib/ai/auto-reply.ts` sends via orchestrator.
- [ ] Dashboard send route + `src/lib/whatsapp/send-message.ts`.
- [ ] Broadcast core (may defer to Phase 2 when it rides the outbox).

---

## Phase 2 — Durable Outbox + Delivery Tracking

### 2a. Schema — `todo`

- [ ] Migration `supabase/migrations/043_message_outbox.sql`:
  - `message_outbox`: account_id, connection_id, conversation_id, message_id,
    payload jsonb, idempotency_key (unique), status
    (`queued|sending|sent|failed|dead`), attempts, next_attempt_at, last_error,
    priority, scheduled_at. Index `(status, next_attempt_at)`.
  - `message_delivery_events`: message_id, provider, event
    (`queued|sent|delivered|read|failed|bounced|complained`), provider_status,
    error_code, payload, occurred_at.
  - RPC to claim rows atomically (`FOR UPDATE SKIP LOCKED`).

### 2b. Enqueue + drain worker — `todo`

- [ ] `src/lib/orchestration/outbox.ts` — `enqueueMessage()` + drain (immediate via
      `after()`, sweep via cron `/api/orchestration/outbox/cron`, `vercel.json` entry).
- [ ] Exponential backoff (1m/5m/30m, max 5 → `dead`), per-connection rate limiting.

### 2c. Status callbacks — `todo`

- [x] Shared status module `src/lib/orchestration/status.ts` created —
      `applyMessageDeliveryStatus()` (messages mirror + broadcast_recipients
      ladder-guarded mirror + `message.status_updated` fan-out) with
      colocated tests. Legacy Meta webhook delegation still pending.
- [ ] Meta: legacy webhook `handleStatusUpdate` delegates to the shared
      `status.ts` module (incremental cutover).
- [x] Twilio: `StatusCallback` param on sends (adapter derives the callback
      URL from `NEXT_PUBLIC_SITE_URL` / `VERCEL_PROJECT_PRODUCTION_URL`) +
      status POST handling in `/api/channels/webhooks/twilio` (signature
      validated against the sender connection, ack-first via `after()`).
- [x] Twilio native templates: `OutboundMessagePayload` template branch
      extended with `contentSid` / `contentVariables`; the adapter sends
      Content API templates (`ContentSid` + `ContentVariables`), and the
      orchestrator's strict gate lets Twilio templates with a `contentSid`
      through instead of rejecting them.
- [ ] Resend: webhook for delivered/bounced/complained.
- [ ] Broadcasts enqueue recipients into the outbox instead of looping sends.

---

## Phase 3 — Channel-Agnostic Inbound + Router

- [ ] 3a. Generalize `src/lib/channels/inbound.ts`: per-channel identity normalization
      (phone for whatsapp/sms-future, lowercased address for email), correct `channel`
      on identities/conversations, email subject/html support. — `todo`
- [ ] 3b. `src/lib/orchestration/inbound-router.ts`: extract legacy webhook's
      post-persist cascade (flow session → automations → AI, deterministic wins) into a
      channel-agnostic function invoked from all webhook routes. — `todo`
- [ ] 3c. Legacy Meta webhook delegates to the shared router (incremental cutover). — `todo`
- [ ] 3d. SMS-readiness documented: adding SMS = `'sms'` enum value + `TwilioSmsAdapter` + webhook parser. No orchestrator/schema changes. — `todo`

---

## Phase 4 — AI Agent Layer

- [ ] 4a. Migration `044_ai_agents.sql`: `ai_agents` (name, role
      `general|sales|support|billing|custom`, channel scope, connection_id override,
      system_prompt, model overrides, reply cap, handoff_agent_id, routing_keywords,
      priority). Backfill existing `ai_reply_configs` → default `general` agent. — `todo`
- [ ] 4b. `src/lib/ai/agents.ts` resolver: per-connection → per-channel → default;
      intent classification for role agents; fallback on ambiguity. — `todo`
- [ ] 4c. `dispatchInboundToAiReply` loads agent via resolver, replies through the
      Phase-1 orchestrator; existing gates (handoff stickiness, reply-slot claim,
      rate limits) preserved. — `todo`
- [ ] 4d. Agent management UI in AI settings. — `todo`

---

## Phase 5 — Observability & Hardening

- [ ] Message delivery timeline UI (from `message_delivery_events`). — `todo`
- [ ] Outbox / webhook health admin view + `message.failed` / `message.dead` events. — `todo`
- [ ] Tests per phase (colocated `*.test.ts` convention). — `todo`

---

## Change Log

| Date       | Change                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-15 | Plan created; analysis of legacy vs omnichannel foundation completed.                                                                                                                                                                                              |
| 2026-07-15 | Phase 2c (Twilio): native Content-API template sends (`contentSid`/`contentVariables` on the template payload), `StatusCallback` on all Twilio sends, status-callback handling in the Twilio webhook, and new shared `src/lib/orchestration/status.ts` with tests. |

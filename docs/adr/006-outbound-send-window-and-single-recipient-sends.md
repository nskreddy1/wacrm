# ADR-006: The 24-hour window is a server-side boundary, and a single-recipient send is a first-class path

**Status:** Proposed
**Date:** 2026-08-20
**Deciders:** Project owner
**Relates to:** `docs/outbound-messaging.md` (§2, §5.1–5.2 — the analysis this ADR decides on), ADR-001 (workspace modules — `inbox:send` / `broadcasts:manage` gating), ADR-005 (typed error codes, "the client check is not the boundary"), `AGENTS.md` (channel conventions: WhatsApp specifics stay in `src/features/whatsapp/lib/`; *"The UI disabling a button is never the security boundary"*)

## Context

`docs/outbound-messaging.md` established the regime we operate under and it is
not ours to negotiate: on WhatsApp a tenant may send **free-form** content only
inside a **24-hour window that opens when the customer writes to them**.
Outside that window the only legal send is a **Meta-approved template**. Only
the customer can open a window; a template send is a *request* to be let in.

Two questions fall out of that document and are decided here.

### Question 1 — a tenant needs to message *one* specific person

The concrete driver: a tenant (call them SRE) is not running campaigns. They
need to tell **one named customer** about **one appointment**. Their mental
model is "the product only does broadcasts", and the code has enough surface
area to make that plausible — `broadcasts` is a whole feature module, and the
one-to-one path is spread across two entry points in a route file.

The capability already exists, twice, and neither is documented as the
canonical answer:

```
Inbox composer (existing thread)
  message-thread.tsx  → POST /api/whatsapp/send { conversation_id, … }

Contact detail (no thread required — the cold-start path)
  → POST /api/whatsapp/send { contact_id, … }
       └─ findOrCreateConversation()   ← creates the thread on the spot
            └─ sendMessageToConversation()
                 └─ sendChannelMessage()   ← unified orchestrator
                      └─ meta.ts | twilio.ts

Public API (phone number, no internal ids)
  POST /api/v1/messages
       └─ resolveConversationByPhone()  ← find-or-create contact + conversation
            └─ sendMessageToConversation()  ← same core
```

So the answer to *"can we message just one person?"* is **yes, and it is the
primary path** — `broadcasts` is a fan-out layered on top of the same core. But
the answer to *"can we say whatever we want to them?"* is **no, and bulk-vs-single
is not the axis that decides it**:

| | Window OPEN (customer wrote < 24 h ago) | Window CLOSED / never wrote |
| --- | --- | --- |
| Single, from the inbox | Free-form text, media, interactive | **Approved template only** |
| Single, from Contact detail | Free-form (thread exists and is open) | **Approved template only** |
| Bulk, via broadcast | Template (broadcasts are always templates) | **Approved template only** |
| AI auto-reply | Replies autonomously | Cannot send at all |

For SRE's appointment case the window is almost always **closed** — an
appointment reminder is business-initiated by definition. The correct shape is
therefore an **approved utility template with variables**
(`Hi {{1}}, your appointment is on {{2}} at {{3}}`), sent to one contact from
Contact detail, after which the customer's reply opens a free-form window the
agent (or the AI) answers inside. That is a one-to-one send that *uses* a
template — not a broadcast. Nothing about "template" implies "bulk", and the
product currently teaches otherwise by making the template picker feel like a
broadcast feature.

### Question 2 — the window is enforced in the UI only

`message-thread.tsx:301` computes `sessionInfo` from the newest message with
`sender_type === 'customer'` and `message-composer.tsx` acts on it correctly:
textarea disabled, `handleSend` early-returns, media blocked on the same flag,
amber banner pointing at the template picker, and a thread with no inbound at
all treated as closed. That is good client behaviour.

It is also the *only* enforcement. `sendMessageToConversation` validates
message **shape** — type, required content, the 1024-char caption cap — and
never asks **when the customer last wrote**. Neither does `sendChannelMessage`.
Three ways past it, none exotic:

1. **`POST /api/v1/messages`** has no composer in front of it.
   `resolveConversationByPhone` will happily create a contact and conversation
   for someone who has never written to us, and then send `type: 'text'` into
   it. A cold free-form send, by design, through a documented public endpoint.
2. **`POST /api/whatsapp/send` with `contact_id`** does the same thing inside
   the dashboard: `findOrCreateConversation` opens a thread against a contact
   with zero inbound messages, and the core accepts `message_type: 'text'`.
3. **The window closing mid-compose.** `sessionInfo` is a `useMemo` over
   `messages` — it re-derives on new messages, not on a clock tick. An agent
   who opens a thread at 23 h 55 m and types for ten minutes sends into a
   window that shut while they were typing. The client timer also reads only
   the loaded message page, so a long thread whose last inbound fell outside
   that page reads as closed (safe) while the server has no opinion at all.

In all three cases Meta rejects or silently drops the message — but our
`messages` row was already inserted and the dashboard renders it as sent. **A
phantom send is worse than a refused one:** a refusal gets retried as a
template, a phantom gets trusted, and the customer misses their appointment
while the CRM shows it was delivered. At scale the same behaviour is what
damages WABA quality rating, which is the asset the whole channel rests on.

### Question 3 — WhatsApp consent has nowhere to live

`contacts` has `sms_opted_out` / `sms_opted_out_at` (with a partial index) and
`email_opted_out`. There is **no WhatsApp equivalent** in the 88-table schema.
Meta requires WhatsApp-specific opt-in honoured separately from SMS consent,
and punishes blocks and reports through quality rating. Today a contact who
replied "STOP" on WhatsApp can be template-messaged again, from the inbox, by
any agent, with nothing in the system disagreeing.

## Decision

1. **D1 — The 24-hour window is enforced in `sendChannelMessage`, the unified
   outbound orchestrator, not in `sendMessageToConversation`.** The
   orchestrator is the single choke point every outbound path already funnels
   through: the dashboard route, the public API, flow action nodes
   (`src/features/flows/lib/meta-send.ts`), AI auto-reply, and broadcast
   delivery. Putting the check one layer higher (in the send core) would leave
   flows and broadcasts outside it; putting it one layer lower (in `meta.ts`)
   would duplicate it per adapter and couple a Meta policy to Twilio's code
   path. Every current and future caller inherits the boundary by construction.

2. **D2 — The window is derived from the latest *inbound* message, and
   `conversations.last_message_at` MUST NOT be used for it.**
   `last_message_at` is direction-agnostic and our own outbound sends bump it
   (`outbound.ts:343`), so using it would hold the window open forever — the
   precise inverse of the rule. Truth is the newest `messages` row with
   `sender_type = 'customer'`.

3. **D3 — Denormalise it as `conversations.last_inbound_at`.** One nullable
   `timestamptz`, written on **both** inbound paths — `inbound.ts:198` (the
   unified channel path) and the webhook's own conversation update
   (`src/app/api/whatsapp/webhook/route.ts`) — alongside the existing
   `last_message_at` write, so the two cannot drift. Backfilled in the same
   migration from `max(created_at) where sender_type = 'customer'`. `NULL`
   means *no inbound ever* and is treated as closed: the check fails safe, in
   the same direction the composer already fails. Rationale over a per-send
   subquery in §Options.

4. **D4 — Outside the window, free-form is rejected with a typed
   `window_closed` error at HTTP 409; `template` is never rejected by this
   check.** `text`, the four media kinds, and `interactive` are all free-form
   for this purpose (interactive requires an open window — the composer already
   treats it that way at `message-composer.tsx:701`). A template is legal at
   any time and is the caller's way out, so the error is *actionable*, not a
   dead end. The code joins the existing `SendMessageError` family so the
   dashboard maps it to the amber banner it already renders and the v1
   envelope surfaces `window_closed` verbatim.

5. **D5 — The rejection happens before the `messages` insert and before quota
   is consumed.** This is the actual fix for the phantom send: no provider
   call, no row, no `status: 'sent'` that lies. `consumeMonthlyQuota` already
   runs only after the provider accepts, so a rejected send costs the tenant
   nothing.

6. **D6 — A closed-window send must use an *approved* template, checked
   locally.** `message_templates` already carries Meta's status, and the send
   core already loads the row for its components. Extend that: a `template`
   send whose local row is `PENDING`, `REJECTED`, `PAUSED` or `DISABLED` is
   rejected as `template_not_approved` (409) with the status named, instead of
   being handed to Meta to refuse opaquely. A template row we have never synced
   is *not* blocked — Meta remains the authority, we only refuse what we
   already know is refusable. This is the failure mode a tenant on a fresh
   WABA hits first, and a local error message that says *"this template is
   still PENDING with Meta"* is the difference between a five-minute wait and a
   support ticket.

7. **D7 — The one-to-one send is named, documented, and reachable as the
   product's primary send path — with no new endpoint.** `contact_id` on
   `POST /api/whatsapp/send` already does exactly what SRE needs; the gap is
   presentation, not capability. Contact detail switches on the same server
   truth as the composer: window open → free-form composer; window closed →
   template picker with variable inputs, labelled as *"Send a message to this
   contact"*, never as *"broadcast"*. `broadcasts` remains the ≥2-recipient
   fan-out of the identical operation. Explicitly **not** decided here: a
   separate "single send" API route. A second endpoint duplicating
   `resolveConversationByPhone` + the core is exactly how the two would drift.

8. **D8 — WhatsApp opt-out gets first-class columns, enforced in the same
   choke point as D1.** Add `contacts.whatsapp_opted_out` /
   `whatsapp_opted_out_at`, mirroring the SMS columns and their partial index.
   Inbound `STOP` sets them. `sendChannelMessage` refuses any WhatsApp send —
   **single or bulk, template or free-form** — to an opted-out contact with
   `contact_opted_out` (409). Broadcast planning filters opted-out recipients
   out at plan time so the count the tenant approves is the count that sends.
   Enforcing consent only in broadcast planning would be the same category
   error as enforcing the window only in the composer: a single send to a
   contact who said STOP is the identical violation at N = 1.

9. **D9 — The client timer becomes a *display* of server truth, with a safety
   margin.** It reads `conversations.last_inbound_at` (no longer inferring
   from the loaded message page), ticks on a timer rather than only on new
   messages, and treats the last 10 minutes of the window as closed for
   *composer* purposes. The margin closes the mid-compose race in the place it
   is cheap to close — the agent is pushed to a template *before* typing 400
   characters they are about to lose. The server check stays absolute at 24 h;
   the client is deliberately stricter, never laxer.

10. **D10 — No provider change.** Meta Cloud API stays the primary WhatsApp
    path, Twilio stays SMS plus the WhatsApp fallback for tenants who arrive
    owning a Twilio WABA, exactly as `docs/outbound-messaging.md` §3
    recommends. The window is a **Meta policy, not a provider feature**, so it
    binds identically on both adapters — which is why D1 places it above them.
    SMS has no window and no template regime, so the check is gated on
    `channel === 'whatsapp'` and SMS is unaffected.

11. **D11 — One migration.** `conversations.last_inbound_at` (+ backfill),
    `contacts.whatsapp_opted_out` / `_at` (+ partial index). Idempotent,
    timestamp-prefixed, followed by `pnpm db:doc` and `pnpm docs:sync` per
    `AGENTS.md`.

12. **D12 — Explicitly deferred: quiet hours and per-country marketing rates.**
    Both belong in broadcast *plan* phase where the recipient list is resolved
    and nothing has been sent. Neither blocks this ADR, and bundling them would
    delay the phantom-send fix behind a timezone data model. Recorded in
    §Consequences → Revisit.

## Options considered

### Where to enforce the window

| Option | Coverage | Complexity | Verdict |
| --- | --- | --- | --- |
| **A. Composer only (status quo)** | Inbox only. Public API, `contact_id`, flows, and any future caller all bypass it | None | **Rejected** — `AGENTS.md`: a disabled control is never the boundary. This is the defect. |
| **B. Per-adapter (`meta.ts`)** | Meta only; Twilio WhatsApp silently unguarded | Low, but duplicated per adapter | Rejected — couples a channel-wide policy to one provider file and guarantees drift the day a third adapter lands. |
| **C. `sendMessageToConversation`** | Dashboard + public API | Low | Rejected — flows (`meta-send.ts`), AI auto-reply, and broadcast delivery reach the orchestrator without passing through this core, so the boundary would have a hole shaped exactly like our automation surface. |
| **D. `sendChannelMessage` orchestrator (chosen)** | Every outbound path, present and future | Low — one guard, one place | **Chosen.** The narrowest waist that dominates all callers. |
| **E. Postgres trigger on `messages`** | Total, including manual SQL | High | Rejected — fires after the provider call, so it prevents the bad *row* but not the bad *send*; and it cannot return an actionable 409 to the caller. |

### How to derive the window

| Option | Verdict |
| --- | --- |
| **A. `conversations.last_message_at`** | **Rejected, actively wrong.** Our own outbound bumps it, so the window would never close. Named here because it is the tempting one-line answer. |
| **B. Subquery per send** (`max(created_at) where sender_type='customer'`) | Correct but pays an extra indexed query on every send, including AI replies inside a hot conversation. Kept as the backfill source only. |
| **C. Denormalised `last_inbound_at` (chosen)** | **Chosen.** One column read on a row the orchestrator already loads. Costs one write on a path that is already writing the same row. |
| **D. Ask the provider** | No such API. Meta exposes no window-state endpoint; the only feedback is a rejected send — which is precisely the outcome being prevented. |

### How to expose the single-recipient send

| Option | Verdict |
| --- | --- |
| **A. New `POST /api/v1/send-one`** | Rejected — duplicates find-or-create and the send core, and the two copies drift on the first divergent bug fix. |
| **B. Reuse `contact_id` on the existing route, fix the UI framing (chosen)** | **Chosen.** The capability is built and tested; what is missing is that the surface reads as a broadcast feature. Zero new API surface, zero new tests for a second path. |
| **C. Route single sends through `broadcasts` with N = 1** | Rejected — inherits campaign records, planning, and rate pacing for one appointment reminder, and puts a per-thread action behind `broadcasts:manage` instead of `inbox:send`. |

## Security review

Findings **F1–F6** are binding on the implementation.

- **F1 — The window check must not be bypassable by choosing a different
  entry point (High).** This is the whole finding. D1 places the guard where
  every caller converges; the acceptance test is adversarial, not illustrative:
  `POST /api/v1/messages` with `type: 'text'` to a never-inbound number MUST
  answer `409 window_closed`, and the same assertion MUST exist for
  `POST /api/whatsapp/send` with `contact_id`. If a future caller reaches a
  provider adapter without passing the orchestrator, that is a boundary
  regression regardless of whether it passes review on other grounds.
- **F2 — Tenancy is unchanged and must stay explicit.** The orchestrator runs
  on the admin (service-role) client and therefore **bypasses RLS**; per
  `AGENTS.md` every service-role query stays filtered by `account_id`. The new
  reads (`conversations.last_inbound_at`, `contacts.whatsapp_opted_out`) MUST
  be filtered the same way, and MUST NOT introduce a lookup by id alone. The
  authorization decision itself is untouched: the caller's RLS-scoped
  conversation load in `sendMessageToConversation` and the `contact_id`
  account check in the route both remain.
- **F3 — Failing closed must not be weaponisable into a denial of service on
  legitimate sends.** `last_inbound_at IS NULL` reads as closed, so a botched
  backfill would silently degrade every live conversation to template-only.
  Mitigation: the backfill runs in the same transaction as the column add
  (`push-supabase-schema.mjs` already wraps each migration), and the migration
  is verified against a non-zero inbound count before the guard ships. Order of
  deployment is part of the decision: **column + backfill first, guard second.**
- **F4 — A rejected send must not leave a partial record.** D5 rejects before
  the insert, so there is no row to reconcile and no quota to refund. The
  inverse ordering — insert, then discover the rejection — is the bug being
  fixed and must not reappear as a "provisional" row with a `failed` status
  written after the fact.
- **F5 — The consent check must not be advisory.** D8 places
  `whatsapp_opted_out` in the same guard as the window, so an opted-out contact
  is unreachable from the inbox, the public API, a flow, and a broadcast
  alike. A boolean records the current state but not that consent was ever
  given; a first-class consent record (channel, consent type, method,
  timestamp, source) is what survives a TCPA or GDPR challenge. Accepted as
  residual risk for V1 and recorded under Revisit — the boolean is strictly
  better than today's nothing, and the column shape mirrors SMS so the later
  migration to a consent table is mechanical.
- **F6 — The error must not leak cross-tenant information.** `window_closed`,
  `template_not_approved` and `contact_opted_out` describe state the caller is
  already authorized to see (their own conversation, their own template, their
  own contact). None of them may include another account's identifiers, and the
  404-before-409 ordering must hold: an unauthorized conversation stays a 404
  and never reveals its window state.

Residual risk accepted: the server's 24 h boundary and Meta's own clock can
disagree by seconds around the edge, so a send accepted by us can still be
refused by Meta. That failure is a normal provider error on an already-narrow
edge, and D9's client-side margin keeps agents away from it.

## Consequences

- **Easier:** a tenant like SRE has one obvious way to message one customer,
  and the product stops implying that "one person" requires a broadcast. A
  closed-window free-form send now fails *loudly and actionably* — 409 plus
  the template picker — instead of appearing to succeed. The public API and
  flows inherit the same rule without either being edited.
- **Harder:** `sendChannelMessage` gains policy responsibility beyond routing
  and persistence, so tests that call it now need a conversation with a
  plausible `last_inbound_at` (or an explicit template payload). Any new
  outbound feature must accept that free-form is conditional — which is the
  point, and is cheaper to learn in a test than on a customer thread.
- **Fixed as a side effect:** the `contact_id` cold-start path, which today
  can open a thread and post free-form text into it with no inbound message at
  all — a hole the composer analysis in `docs/outbound-messaging.md` §5.1 did
  not enumerate.
- **Revisit:** (a) a first-class consent record replacing the opt-out boolean
  (F5); (b) TCPA quiet hours and per-country marketing rates in broadcast
  planning (D12); (c) surfacing template **category** (marketing vs utility)
  and its cost at send time, since utility inside an open window is free and
  marketing never is; (d) if a tenant ever needs a genuinely cold free-form
  channel, that is an SMS or email decision, not a WhatsApp one.

## Action items

1. [ ] Migration `YYYYMMDDHHMMSS_outbound_window_and_whatsapp_consent.sql`:
       `conversations.last_inbound_at` + backfill from
       `messages where sender_type = 'customer'`;
       `contacts.whatsapp_opted_out` / `_at` + partial index (D3, D8, D11, F3)
2. [ ] Write `last_inbound_at` on both inbound paths — `channels/lib/inbound.ts`
       and the WhatsApp webhook's conversation update (D3)
3. [ ] Guard in `sendChannelMessage`: `window_closed` (409) for free-form
       outside the window, `contact_opted_out` (409), both gated on
       `channel === 'whatsapp'`, both before the provider call and the
       `messages` insert (D1, D4, D5, D8, D10, F1, F4)
4. [ ] `template_not_approved` (409) for a locally-known non-approved template
       row; unsynced rows pass through to Meta (D6)
5. [ ] Ship in order: **columns + backfill, then the guard** (F3)
6. [ ] Contact detail → "Send a message to this contact": free-form when open,
       template picker with variable inputs when closed; map 409 onto the
       existing amber banner in the composer (D7, D4)
7. [ ] Client timer reads `last_inbound_at`, ticks on an interval, applies the
       10-minute composer margin (D9)
8. [ ] Broadcast planning filters `whatsapp_opted_out` recipients at plan time
       (D8)
9. [ ] Tests: cold `POST /api/v1/messages` text → 409; cold
       `contact_id` text → 409; template in the same cold state → 200; inbound
       at 23 h 59 m → free-form allowed; at 24 h 01 m → 409; opted-out contact
       → 409 for template *and* text; SMS send unaffected by both guards
       (F1, D10)
10. [ ] Update `docs/outbound-messaging.md` (§5.1/§5.2 → resolved by this ADR)
        and `.agents/context/api-routes.md`, then `pnpm db:doc`,
        `pnpm docs:sync`, `pnpm check`

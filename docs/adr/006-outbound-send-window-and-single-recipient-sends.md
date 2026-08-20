# ADR-006: The 24-hour window is a server-side boundary, and a single-recipient send is a first-class path

**Status:** Proposed
**Date:** 2026-08-20
**Revised:** 2026-08-20 — verification pass against the code (see
§Verification against the code). Three claims in the original draft were wrong,
one decision (D1) does not hold for the path it claims to dominate, and D10's
framing was rewritten to be tier-based rather than trial-based. D13–D15 added.
**Revised:** 2026-08-20 (second pass) — multi-vendor research across Meta Cloud
API, Twilio, and MSG91 (see §Provider comparison). All three impose the same
window, which upgrades D1 from a convenient choice to the only correct one;
D16–D17 added, the latter adopting MSG91 as a third adapter specifically to
prove the provider seam holds.
**Revised:** 2026-08-20 (third pass) — full re-verification against the tree
plus an insecure-defaults review (see §Critique pass). C1–C11 all still hold
and none of ADR-006 is implemented yet. The pass found five gaps the first two
revisions missed — the choke point's own file lives in the wrong feature
module, D8's STOP semantics were asserted but never specified, the guard had
no observability decision, D4's payload classification was not exhaustive, and
D14's quick-send bound collides with the per-user rate limit. D18–D21 added;
external pricing facts in D15 re-confirmed against Meta's published notice.
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

10. **D10 — No provider change; Twilio is the *development* path.** The window
    is a **Meta policy, not a provider feature**, so it binds identically on
    both adapters — which is why D1 places it above them. SMS has no window and
    no template regime, so the check is gated on `channel === 'whatsapp'` and
    SMS is unaffected.

    **Rewritten 2026-08-20 — the sender *tier* is an environment variable, not
    a decision.** The previous wording built the decision around "the only
    credential we have is a Twilio free trial". That is a fact about this
    week, not a fact about the product, and encoding it in an ADR makes the
    architecture read as trial-shaped to anyone who arrives after the account
    is upgraded. Restated tier-first:

    | Tier | What it can send | Who it is for |
    | --- | --- | --- |
    | **Meta test number** (auto-provisioned, **no Business verification**) | Templates + free-form to ≤ 5 manually added test recipients | Meta-adapter development |
    | **Twilio WhatsApp Sandbox** (shared `+1 415 523 8886`, `join <code>`) | Anything, to numbers that joined; opt-in expires at **72 h**, 1 msg / 3 s | Twilio-adapter development |
    | **Trial / unverified sender** | Verified recipients only; cannot host a per-tenant WABA | Nobody in production |
    | **Production WABA** (verified business, own sender) | The full regime this ADR encodes | Every real tenant |

    The consequences that actually bind the code:

    - **The guard is tier-independent.** The 24-hour window is a *policy* over
      `messages`, evaluated before any provider call, so it behaves identically
      on a test number, a sandbox, and a verified WABA. Nothing in D1–D9 reads
      a credential, and no branch anywhere may key off "are we on trial".
    - **Both development tiers are stricter than production**, which is the
      only property that matters for test validity: the sandbox's 72 h opt-in
      and the test number's 5-recipient allowlist both *narrow* what a correct
      guard would allow, so a guard that passes there passes in production —
      never the reverse.
    - **Neither vendor gates development on business verification.** The Meta
      test number needs none, so the Meta adapter — the one with the deeper
      integration — is developable today. Correcting the original draft: Meta
      is not blocked, only Meta *at production scale* is.
    - **Per-tenant sender identity is a tier property, not a code path.**
      `channel_connections` already stores one sender per tenant; a shared
      sandbox number simply cannot populate it honestly. So multi-tenant
      WhatsApp waits on verified senders — a procurement milestone, with **no
      migration and no branch** behind it.
    - **Acceptance tests (action item 9) stub the adapter.** The guard rejects
      before the provider call by construction (D5), so every assertion in
      that list is reachable with no credential of any tier. Live sandbox runs
      are a smoke test on top, not the proof.

11. **D11 — One migration.** `conversations.last_inbound_at` (+ backfill),
    `contacts.whatsapp_opted_out` / `_at` (+ partial index). Idempotent,
    timestamp-prefixed, followed by `pnpm db:doc` and `pnpm docs:sync` per
    `AGENTS.md`.

12. **D12 — Explicitly deferred: quiet hours and per-country marketing rates.**
    Both belong in broadcast *plan* phase where the recipient list is resolved
    and nothing has been sent. Neither blocks this ADR, and bundling them would
    delay the phantom-send fix behind a timezone data model. Recorded in
    §Consequences → Revisit.

13. **D13 — The choke point must actually be a choke point: broadcast
    delivery moves onto `sendChannelMessage`.** Verification found that
    `src/app/api/whatsapp/broadcast/route.ts` calls
    `sendTemplateMessage()` from `meta-api.ts` per recipient and never enters
    the orchestrator (evidence in §Verification, C4). D1 therefore does *not*
    cover broadcasts as written, and D8's promise — "single or bulk, template
    or free-form, one guard" — is unenforceable until this changes. Two
    options were considered and only one is acceptable: duplicating the
    consent check into the broadcast route (rejected — it is Option B from the
    window table wearing a different hat, and it drifts) versus routing
    broadcast recipients through the orchestrator like every other caller
    (**chosen**). Until that lands, D8 for broadcasts rests on plan-time
    filtering alone and MUST be labelled as such rather than implied to be a
    boundary. The same applies to `api/sms/broadcast` and `api/email/broadcast`,
    which are separate routes with their own send calls.

14. **D14 — The one-to-one send needs a *built* surface, not a relabelled
    one.** D7 said the gap was "presentation, not capability". Half true: the
    API capability exists (`contact_id` on `POST /api/whatsapp/send`), but no
    UI anywhere calls it — `message-thread.tsx` is the only component in the
    app that posts to that route (§Verification, C3). So SRE's mental model
    ("this product only does broadcasts") is not a misreading of the product;
    it is an accurate reading of it. Three entry points, all on the existing
    route and the existing core:

    - **Contact record → "Message".** Opens the same composer the inbox uses,
      against a conversation found-or-created for that contact. Window open →
      free-form. Window closed (the normal case for a cold contact) → template
      picker with variable inputs, labelled *"Send a message to this
      contact"*. Never the word "broadcast".
    - **Inbox → "New message".** Contact search, then the identical composer.
      This is the path an agent reaches for when they are already in the inbox
      and the thread does not exist yet.
    - **Contact list → select 2–N → "Quick send".** A small multi-select
      (bounded, e.g. ≤ 25) that loops the *same* one-to-one send per contact
      and shows a per-recipient result. It is deliberately **not** a
      broadcast: no campaign record, no pacing, no `broadcasts:manage`
      permission — it is N single sends under `inbox:send`, which is what a
      salesperson messaging today's five leads is actually doing. Above the
      bound, the UI points at broadcasts, which is where campaign records,
      pacing, and reporting belong.

    All three reuse `contact_id`; the "no new endpoint" half of D7 stands.

15. **D15 — Cost text must not hard-code "free inside the window".** Meta's
    published pricing changes on **2026-10-01**: service (non-template)
    messages and utility templates sent inside an open customer-service window
    become billable at the recipient market's per-message rate, with no volume
    tiers for service messages. `docs/outbound-messaging.md` §1 and ADR-008's
    cost positioning both assert the current "free inside the window" rule as
    a standing fact. Neither the guard nor any decision here depends on price,
    so this changes no code — but any tenant-facing number is a **dated
    quote**, and the two documents get a dated caveat rather than a silent
    expiry. Recorded under Revisit with the surfacing work in (c).

16. **D16 — The window is a *platform* rule, not a vendor rule, and a third
    BSP is how we prove it.** D10's tier table answers "what can we send
    today". It does not answer the sharper question: is the guard we are about
    to build a Meta-shaped guess, or the actual constraint? Three independent
    vendors were checked, and all three expose the *same* split at the API
    surface, under different names:

    | Vendor | "Open window" call | "Cold start" call |
    | --- | --- | --- |
    | **Meta Cloud API** | `POST /messages` `type=text` | `type=template` |
    | **Twilio** | `Body` on `/Messages` | `ContentSid` (Content API `HX…`) |
    | **MSG91** | *"Send message (once session started)"* | *"Send WhatsApp Template — this API is to initiate a conversation"* |

    MSG91's own documentation labels the template endpoint as the one that
    *initiates* a conversation and the free-form endpoint as valid only *once
    the session started*. That is this ADR's D4 restated by a third party who
    has no incentive to agree with us. **Conclusion: the 24-hour window is
    imposed by WhatsApp on every BSP, so encoding it once in
    `sendChannelMessage` (D1) is not merely convenient — it is the only place
    it can live without being re-derived per vendor.** This retires the
    residual worry that Option B (per-adapter) was viable.

    It also settles the reverse question. Because all three vendors agree, the
    guard needs **no provider branch at all**: `payload.kind` (D4) already
    carries the only distinction that matters. Any adapter-specific detail —
    Meta `components`, Twilio `contentSid`, MSG91 `template_name` — lives
    below the guard, in the adapter, where `OutboundMessagePayload` already
    puts it.

17. **D17 — Add MSG91 as a third WhatsApp adapter, and treat it as the
    conformance test for the seam rather than a feature.** The provider seam
    (`ChannelAdapter` in `channels/lib/contracts.ts`, factory in
    `adapters/index.ts`, `PROVIDER_CHANNELS` / `PROVIDER_LABEL` in
    `provider-registry.ts`) was designed for exactly this and has so far only
    been exercised by two vendors, both of which we chose early. A third
    vendor added *after* the guard lands is the cheapest available proof that
    the vertical boundary holds. The full change surface, from reading the
    seam:

    | Layer | Change |
    | --- | --- |
    | `ChannelProvider` (`types/index.ts:253`) | add `'msg91'` |
    | `channel_provider` PG enum | new migration adding the value, **in its own transaction** (`040`/`041` split exists because of SQLSTATE 55P04) |
    | `channel_provider_pair` CHECK (`041`) | `whatsapp` → `IN ('meta','twilio','msg91')` |
    | `provider-registry.ts` | `PROVIDER_CHANNELS.msg91 = ['whatsapp']`, `PROVIDER_LABEL.msg91 = 'MSG91'` |
    | `adapters/msg91.ts` | new `Msg91WhatsAppAdapter` implementing `send` / `checkHealth` / `sendTest` |
    | `adapters/index.ts` | one `case 'msg91'` |
    | `api/channels/webhooks/msg91/route.ts` | inbound + delivery reports → `persistInboundChannelMessage` |
    | **Guard, orchestrator, UI, contracts** | **unchanged — this is the assertion** |

    Two provider facts constrain the adapter and must not leak upward:

    - **Auth is a header `authkey`, not a bearer token**, and the sender is an
      `integrated_number` in the body. Both go in `channel_connections`
      credentials via `lib/crypto/secrets.ts` like every other provider
      secret. Sends are `POST
      api/v5/whatsapp/whatsapp-outbound-message/bulk/`; the bulk shape is an
      implementation detail of *this* adapter and MUST NOT be surfaced as a
      bulk capability, or D13's single choke point is lost again.
    - **MSG91 has no HMAC webhook signature.** Meta's webhook fails closed on
      `X-Hub-Signature-256`; MSG91 offers only user-defined custom headers.
      The adapter therefore verifies a **shared secret in a custom header
      using a timing-safe comparison**, fails closed when unset exactly as the
      Meta path does, and this asymmetry is recorded as a *provider* risk, not
      a platform one. A per-provider `verifyWebhook` shape on the adapter is
      the right home for it, so the difference stays inside the seam.

    Sequencing: **after** action items 1–5. Adding a vendor before the guard
    exists means writing the same policy a third time, which is the drift
    Option B was rejected for.

18. **D18 — The choke point is named by path, and it moves home before the
    guard lands: `src/features/admin/lib/orchestration/outbound.ts` →
    `src/features/channels/lib/orchestration/outbound.ts`.** Every prior
    revision called `sendChannelMessage` "the unified outbound orchestrator"
    without ever naming its file — and the file lives inside the **`admin`
    feature module**, imported cross-feature by `whatsapp/lib/send-message.ts`,
    `flows/lib/meta-send.ts`, and `assistant/lib/ai/auto-reply.ts`. A
    cross-channel orchestrator housed in `admin` is a vertical-boundary
    anomaly under `AGENTS.md`'s feature-module rules: `channels` already owns
    the adapters, contracts, registry, and inbound path the orchestrator
    depends on. The move is a mechanical relocation (imports only, zero logic
    change) and is sequenced **before** the guard, so the policy is written
    once, in the right home, rather than written in `admin` and moved with
    history noise later. `pnpm check:boundaries` is the acceptance test.

19. **D19 — WhatsApp STOP/START semantics are specified, not assumed.** D8
    said "Inbound `STOP` sets them" and stopped there. The SMS precedent
    already in the tree (`api/channels/webhooks/twilio/route.ts:284–293`)
    handles **both directions** — opt-out sets the flags, opt-in clears them
    (`sms_opted_out: false, sms_opted_out_at: null`) — and WhatsApp mirrors it
    exactly:

    - **Keywords:** case-insensitive, trimmed, exact-match on the message
      body. Opt-out: `STOP`, `UNSUBSCRIBE`. Opt-in: `START`, `UNSTOP`. Exact
      match, not substring — "please don't stop the delivery" is not an
      opt-out.
    - **Parse sites:** both inbound paths that D3 already touches — the Meta
      webhook's message handler and `channels/lib/inbound.ts` — so a future
      provider inherits the behaviour through the unified path.
    - **Direction of error:** unlike Twilio SMS (where the carrier blocks
      sends to a stopped number regardless of what we store), **nothing
      upstream enforces WhatsApp opt-out** (§Provider comparison, row 4) —
      our column is the only record. This is why D8's guard placement is
      load-bearing rather than belt-and-braces.
    - An inbound STOP still opens a 24-hour window (it is a customer
      message); the consent check simply refuses to use it. The two guards
      are independent by design.

20. **D20 — Guard rejections are observable from day one.** A compliance
    boundary that rejects silently is indistinguishable from an outage, and
    the first week of the guard's life is exactly when a mis-backfilled
    `last_inbound_at` (F3) would surface as a spike. Every `window_closed`,
    `contact_opted_out`, and `template_not_approved` rejection is logged
    structured — account id, conversation id, payload kind, and code — at the
    guard site. No new table and no metrics infrastructure in V1; the
    decision is that the log line **exists and is greppable**, so "did the
    guard fire?" is answerable during rollout without a deploy. A rejection
    counter per account is Revisit material, not scope.

21. **D21 — No kill switch, and D4's classification is exhaustive by
    allowlist.** Two insecure-defaults findings, resolved in the same
    direction:

    - **Kill switch considered and rejected.** An env flag that disables the
      guard is a fail-open default one incident away from becoming permanent
      — the precise pattern the composer's `expired: false` on an empty
      thread (C6) already demonstrates. Mitigation for a bad rollout is F3's
      ordering (columns + verified backfill first, guard second) plus D20's
      observability, not a bypass.
    - **The guard allowlists `kind === 'template'` and treats every other
      payload kind as free-form** — including `email` (present on
      `OutboundMessagePayload` today) and any kind added later. An
      unrecognised kind on a WhatsApp send fails closed with
      `window_closed`, never open. A switch statement that enumerates
      free-form kinds would fail open on the day someone adds one; the
      allowlist cannot.

    One more bound from the same review: **D14's quick-send cap must sit
    inside the per-user send rate limit** (`RATE_LIMITS.send`, checked
    per-request in the send route). A 25-recipient client-side loop that
    trips the limiter at recipient 12 produces a half-sent batch with no
    record; the quick-send UI therefore sends sequentially, surfaces
    per-recipient results, and its cap is chosen to fit the limiter budget.

## Critique pass (2026-08-20, third)

The second revision was audited with fresh eyes against the tree and an
insecure-defaults review. Verdicts on the ADR itself, not the code:

| # | Finding | Disposition |
| --- | --- | --- |
| R1 | The "choke point" was never named by path, and it lives in the wrong feature module (`admin`) | **D18.** The strongest structural claim in the ADR (D1) rested on a file the ADR never located. |
| R2 | D8 asserted STOP handling without specifying keywords, parse sites, or the opt-back-in direction — while the SMS handler in the tree already answers all three | **D19.** An ADR that says "STOP sets them" ships a parser someone else designs ad hoc. |
| R3 | No observability decision: a guard that 409s silently cannot be distinguished from a broken client or a bad backfill during rollout | **D20.** |
| R4 | D4 enumerated free-form kinds instead of allowlisting `template` — fails open on the next payload kind (`email` already exists on the contract) | **D21.** |
| R5 | D14's quick-send loop collides with the per-user rate limiter; unbounded partial failure | **D21**, final paragraph. |
| R6 | The guard's read of `last_inbound_at` is not atomic with the send (TOCTOU) | **Accepted as residual, both directions benign:** a window that *opens* mid-flight means we rejected a send that just became legal (caller retries); a window that *closes* mid-flight is the clock-edge risk already recorded after F6. Neither direction sends an illegal message. |
| R7 | D15's pricing facts are a moving external claim | **Re-verified this pass** against Meta's published notice: service messages and in-window utility templates become per-message billable 2026-10-01, rates per recipient market published by 2026-09-01, no volume tiers for service messages. The dated-quote treatment stands. |
| R8 | D17 (MSG91) is a large work item riding on a policy ADR | **Stands as scoped** — it is already sequenced strictly after the guard (action 15) and exists to *prove* the seam, but it is explicitly severable: the guard's correctness does not depend on it, and the implementation plan carries it as a separate phase that can be dropped without reopening this ADR. |

## Verification against the code (2026-08-20)

Every claim in the Context and Decision sections above was checked against the
tree. **Confirmed** means the code says what the ADR says. **Corrected** means
the ADR was wrong and the finding replaces it.

| # | Claim | Verdict |
| --- | --- | --- |
| C1 | `sendChannelMessage` never checks the window or consent; it resolves connection → sends → inserts | **Confirmed.** `orchestration/outbound.ts` steps 1–4; no read of inbound recency, no `contacts` consent column. |
| C2 | `last_message_at` is bumped by our own outbound, so it cannot express the window | **Confirmed.** `orchestration/outbound.ts:343`. D2 stands. |
| C3 | The `contact_id` cold-start path "already exists" as a Contact-detail surface | **Corrected.** The route supports it (`api/whatsapp/send/route.ts:73–163`, `findOrCreateConversation` at `:236`) but **no UI calls it** — `message-thread.tsx` is the only component posting to that route, and `contact-record-sheet.tsx` has no send action. See D14. |
| C4 | Broadcast delivery funnels through the orchestrator (D1's coverage argument) | **Corrected.** `api/whatsapp/broadcast/route.ts:218` calls `sendTemplateMessage()` from `meta-api.ts` directly. Flows (`flows/lib/meta-send.ts`) and AI auto-reply (`assistant/lib/ai/auto-reply.ts:450, 645, 745`) *do* use the orchestrator. See D13. |
| C5 | A closed-window free-form send inserts a row that reads `sent` — the "phantom send" | **Corrected, and the real failure is different per provider.** The insert happens *after* the provider accepts, so on **Meta** the rejection (error 131047) throws in the adapter (`adapters/meta.ts:62–67`) → no row → the caller gets an opaque **502 `provider_error`**. On **Twilio** the API accepts and fails asynchronously; the row exists as `sent` until the status callback lands (`adapters/twilio.ts:136`, `channels/webhooks/twilio` → `applyMessageDeliveryStatus`). So the harms are: an unactionable 502 where a 409 belongs, a Twilio-only window of a lying row, and quota consumed (`api/whatsapp/send/route.ts:202`) on a send that was never legal. D4/D5 remain correct — the *justification* narrows. |
| C6 | The composer treats a thread with no inbound message as closed ("fails safe") | **Corrected — it fails open on the exact case that matters.** `message-thread.tsx:302`: `if (!messages.length) return { expired: false }`. A conversation created by the `contact_id` path has zero messages, so the composer would be **enabled** for a contact who has never written. Only a thread that *has* messages but no `customer` one reads expired. This makes D1 and D9 more urgent, not less. |
| C7 | No `last_inbound_at`; no WhatsApp consent columns | **Confirmed.** Absent from all migrations and from the generated schema doc; `sms_opted_out` (`051_sms_opt_out.sql`) and `email_opted_out` exist as the shape to mirror. D3/D8/D11 stand. |
| C8 | Both inbound paths already write the conversation row, so `last_inbound_at` rides along | **Confirmed.** `channels/lib/inbound.ts:199–202` and `api/whatsapp/webhook/route.ts:737–739`. D3's two write sites are the right two. |
| C9 | Template approval status is never checked locally at send time | **Confirmed.** `send-message.ts` loads the row for components and validates only its *shape* (`isMessageTemplate`); no status read on any send path. D6 stands. |
| C10 | Interactive sends are gated on the window client-side | **Confirmed.** `message-composer.tsx:190` (`inputsDisabled`) gates the `+` menu (`:704`). D4's grouping of `interactive` with free-form matches the UI. |
| C11 | `inbox:send` / `broadcasts:manage` gate these routes (the ADR-001 cross-reference) | **Corrected.** Neither the dashboard send route, the broadcast route, nor `api/v1/messages` performs a module/permission check today. D14's permission split is a **statement of intent**, not a description. |

External facts re-checked at the same time: Meta's per-message pricing with the
**2026-10-01** change to service messages and in-window utility templates
(D15); the Meta **test business number** requiring no Business verification and
capped at 5 manually added recipients; the Twilio sandbox's shared number,
`join <code>` opt-in, **72-hour** expiry, and 1-message-per-3-seconds cap; and
trial accounts' 5-verified-recipient limit (all in D10).

## Provider comparison (2026-08-20)

Gathered for D16/D17. The point of the table is the **left column**: every row
where all three vendors agree is a rule that belongs in the guard, and every
row where they differ is a detail that belongs in an adapter.

| Concern | Meta Cloud API | Twilio | MSG91 | Where it lives |
| --- | --- | --- | --- | --- |
| 24-hour window | Yes | Yes | Yes (documented as session vs. initiate) | **Guard** (D1) |
| Template needed to cold-start | Yes | Yes | Yes | **Guard** (D4) |
| Pre-approved templates | Meta review | Meta review, wrapped as Content API | Meta review, via dashboard | **Guard** reads local status (D6) |
| Opt-out honoured by platform | No — ours to enforce | No | No | **Guard** (D8) |
| Closed-window rejection | Sync throw (131047) | **Async** status callback | Assume async | **Adapter** → normalized (C5) |
| Auth | Bearer token + phone number ID | Account SID / auth token | **Header `authkey`** + `integrated_number` | **Adapter** |
| Template reference | `name` + `components` | `ContentSid` `HX…` | `template_name` | **Adapter** (already in `OutboundMessagePayload`) |
| Webhook authenticity | HMAC `X-Hub-Signature-256` | Signature validation | **None — custom header only** | **Adapter** (D17 risk) |
| Business verification to develop | **Not required** (test number, ≤ 5 recipients) | Not required (shared sandbox, 72 h) | Required — needs an integrated number | **D10 tiers** |
| Cost posture | Meta rate | Meta rate **+ ~$0.005/msg** platform fee, USD-billed | Positions as pass-through, no markup | Commercial, not code (D15) |

Two consequences worth stating plainly. First, **eight of the eleven rows are
either identical across vendors or already have a home in the existing
contract** — the seam is sound, which is what D17 asserts. Second, the
**webhook-authenticity row is the only place a new provider makes the system
weaker**, so it is the one row that needs a named owner rather than an adapter
default. Cost figures are a **dated quote**, not a standing fact (D15).

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
11. [ ] Fix `sessionInfo` failing **open** on an empty thread —
        `message-thread.tsx:302` returns `expired: false` for zero messages,
        which is exactly the state the `contact_id` path creates (C6, D9)
12. [ ] Route WhatsApp broadcast delivery through `sendChannelMessage` instead
        of calling `sendTemplateMessage()` per recipient, so D1/D8 cover bulk;
        same for the SMS and email broadcast routes (D13, C4)
13. [ ] Build the three one-to-one entry points on the existing `contact_id`
        route: Contact record → "Message", Inbox → "New message", contact list
        → bounded "Quick send" (D14, C3)
14. [ ] Gate the send/broadcast routes on `inbox:send` / `broadcasts:manage`,
        which no route checks today (C11), and date the cost claims in
        `docs/outbound-messaging.md` §1 and ADR-008 ahead of the 2026-10-01
        pricing change (D15)
15. [ ] **After 1–5:** add the MSG91 WhatsApp adapter as the seam conformance
        test — `'msg91'` on `ChannelProvider`, enum value in its own migration,
        `channel_provider_pair` widened, registry entries, `adapters/msg91.ts`,
        webhook route. The pass condition is that **the guard, orchestrator,
        contracts, and UI are untouched** by the diff (D17)
16. [ ] Give `ChannelAdapter` a `verifyWebhook` member so MSG91's
        shared-secret-in-custom-header check and Meta's HMAC live at the same
        level, and neither leaks into a route (D17)
17. [ ] **Before 3:** relocate the orchestrator from
        `src/features/admin/lib/orchestration/outbound.ts` to
        `src/features/channels/lib/orchestration/outbound.ts` — imports only,
        zero logic change, `pnpm check:boundaries` green (D18)
18. [ ] WhatsApp STOP/UNSUBSCRIBE → set `whatsapp_opted_out`,
        START/UNSTOP → clear it; exact-match, case-insensitive, both inbound
        paths, mirroring the Twilio SMS handler (D19, D8)
19. [ ] Structured log line on every guard rejection — account id,
        conversation id, payload kind, error code (D20)
20. [ ] Guard classifies by **allowlisting `kind === 'template'`**; all other
        kinds, present and future, are free-form and fail closed (D21, D4)

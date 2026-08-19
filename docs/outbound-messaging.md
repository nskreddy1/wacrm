# Outbound messaging — how a tenant reaches their own customers

**Question this answers.** A tenant of this CRM (an account) wants to message
*their* customers. When are they allowed to send first, when can they only
reply, and when can the AI answer on their behalf? And do we route that
through **WhatsApp Cloud API** (Meta, direct) or **Twilio**?

**Verdict up front.** The rule is not ours to choose — Meta owns it. A tenant
can send **free-form** WhatsApp text only inside a **24-hour window that opens
when the customer messages them**. Outside that window, the only legal send is
a **Meta-approved template**. The AI can therefore only ever *reply* inside an
open window; it can never open one. On providers: stay on **Meta Cloud API
direct** as the primary WhatsApp path (already built here), and keep **Twilio
for SMS** and as the WhatsApp fallback for tenants who already own a Twilio
WABA. Both adapters exist in this repo today.

Scope: WhatsApp and SMS outbound. Email is a different regime (CAN-SPAM /
GDPR) and is out of scope. Sources: Meta WhatsApp Business Platform pricing
and messaging rules (per-message pricing since 1 July 2025), Twilio
Programmable Messaging, and the code in `src/features/whatsapp/`,
`src/features/channels/`, and `src/features/assistant/lib/ai/`.

---

## 1. The rule, precisely

WhatsApp is **not** an outbound broadcast channel with a reply feature. It is a
consent channel with a narrow, customer-opened conversation window.

| Situation | Can the tenant send? | What they may send |
| --- | --- | --- |
| Customer messaged within the last 24 h | Yes | Anything — free-form text, media, interactive buttons/lists |
| Customer's last message was > 24 h ago | Yes, but constrained | **Only an approved template.** Free-form is rejected or silently dropped |
| Customer never messaged, no opt-in | **No** | Nothing. Sending risks WABA quality damage and suspension |
| Customer never messaged, but opted in | Yes | **Only an approved template** (marketing / utility / authentication) |
| Customer replies to a template | Yes | A fresh 24 h window opens — free-form again |

Three consequences that drive the whole design:

1. **Only the customer can open the window.** Nothing the tenant does — not a
   template, not a broadcast, not the AI — opens a free-form window. A
   template send is a *request* for the customer to open one.
2. **A template is the only way to start a conversation**, and it must be
   submitted to Meta and approved first (typically 24–48 h). Templates are
   fixed text with `{{n}}` variables — you cannot improvise. This is why
   `message_templates` and the Meta sync flow are load-bearing here, not a
   convenience.
3. **The AI can only ever reply.** An LLM writes novel prose, which is
   free-form by definition, so it is legal only inside an open window. An AI
   that "reaches out first" is not implementable on WhatsApp — the closest
   legal equivalent is a template send followed by AI handling the reply.

### Pricing follows the same shape

Since 1 July 2025 Meta charges **per delivered template message**, not per
24-hour conversation:

- Free-form inside an open customer-service window: **free**.
- **Utility** templates delivered inside an open window: **free**.
- Utility / authentication templates sent **outside** a window: **charged**.
- **Marketing** templates: **always charged**, rate varies by recipient country
  (India and Brazil are materially cheaper than the US/UK).
- Click-to-WhatsApp ads and Facebook Page entry points open a **72-hour** free
  window.

So the cost curve rewards exactly the compliant behaviour: reply fast inside
the window, and open conversations with utility rather than marketing
templates where the use case allows. Rate cards move — check Meta's pricing
page before quoting a tenant a number.

### SMS is a different regime

SMS has no 24-hour window and no template approval, but it carries **A2P
10DLC registration** (US), **TCPA consent** plus 8am–9pm local quiet hours,
per-segment cost, and carrier filtering. It is the right channel for OTP and
urgent alerts, and the right fallback when a WhatsApp template is not
approved yet. It is the wrong channel for rich conversational support.

---

## 2. Provider choice: Meta Cloud API vs Twilio

Both are already implemented — `src/features/channels/lib/adapters/meta.ts`,
`twilio.ts` (WhatsApp), and `twilio-sms.ts` — selected per account through
`channel_connections` and `provider-registry.ts`.

| Dimension | Meta Cloud API (direct) | Twilio |
| --- | --- | --- |
| Per-message cost | Meta's rate only | Meta's rate **+ Twilio margin** |
| WhatsApp features | Everything, on release day | Lags Meta; some features abstracted away |
| Template management | Direct via Graph API — what `template-lifecycle.ts` already does | Via Twilio Content API (`contentSid`), a second indirection |
| Multi-tenant onboarding | Embedded Signup — tenant connects their own WABA | Twilio Senders API / ISV flow |
| SMS | Not available | Strong — global, mature |
| Webhook verification | `X-Hub-Signature-256` HMAC (implemented in `webhook-signature.ts`) | Twilio request signature |
| Single pane of glass | WhatsApp only | WhatsApp + SMS + voice + email |

**Recommendation.** Keep Meta Cloud API as the primary WhatsApp path: it is
cheaper per message, gets features first, and the deep integration
(templates, interactive messages, resumable media upload) is already built and
tested here. Keep Twilio for SMS, and keep the Twilio WhatsApp adapter for
tenants who arrive already owning a Twilio WABA — the adapter abstraction
means that stays a per-account setting, not a fork in the product.

Choosing Twilio for *everything* only makes sense if consolidated billing and
one support contract outweigh the per-message margin — a fair trade for small
tenants, a bad one at volume.

---

## 3. What this codebase already gets right

- **Inbound is the front door.** `src/app/api/whatsapp/webhook/route.ts`
  verifies the Meta HMAC and fails closed when `META_APP_SECRET` is unset,
  then persists the customer message with `sender_type: 'customer'`.
- **Deterministic-first response precedence** — Flows → Automations → AI —
  in `auto-reply.ts`. A keyword flow silences the LLM account-wide by design,
  so a customer never gets double-texted.
- **The AI replies, it never initiates.** `dispatchInboundToAiReply` is
  invoked only from the webhook's `after()` block, reacting to a message that
  just landed. Its own comment names the reason: the 24 h window is
  "inherently open here". That is the correct architecture.
- **Sticky human handoff.** `resolveHandoffPosture` separates "a name is
  attached" from "a person actually spoke", and only the latter mutes the AI —
  with a bounded *caretaker* mode so an escalated thread nobody has opened yet
  still gets acknowledged instead of silence.
- **Agent send yields to nothing.** `sendMessageToConversation` pauses any
  active flow run for that contact (`paused_by_agent`) — a human stepping in
  is the strongest yield signal there is.
- **Broadcasts are template-only.** `broadcast-core.ts` requires
  `template_name` and refuses to plan without it, which is exactly right: a
  broadcast targets people whose windows are closed.
- **Provider-agnostic domain.** WhatsApp specifics stay inside
  `src/features/whatsapp/lib/`; the unified outbound orchestrator handles
  connection resolution and persistence for every channel.

---

## 4. Gaps to close (ordered by risk)

### 4.1 Nothing enforces the 24-hour window on 1:1 sends — highest risk

`sendMessageToConversation` validates message *shape* (type, required
content, caption length) but never checks **when the customer last wrote**.
An agent can type free-form text into a thread that went quiet three days
ago and we will hand it to Meta. Meta rejects or silently drops it, and
because our `messages` row defaults to `status: 'sent'`, the dashboard shows a
delivered-looking message the customer never received. That is a support
incident that looks like a product lie.

Fix: a shared window check in the outbound orchestrator.

- Derive the window from the **latest inbound** message:
  `sender_type = 'customer'` in `messages`, newest `created_at`.
- **Do not use `conversations.last_message_at`.** It is direction-agnostic and
  our own outbound sends bump it, so it would hold the window open forever —
  precisely the wrong answer.
- Denormalise it as `conversations.last_inbound_at` (set on the inbound path)
  so the check is one column read, not a subquery per send.
- Outside the window, reject free-form with a typed
  `SendMessageError('window_closed', …, 409)` and let the UI offer the
  template picker instead. Failing loudly beats a phantom send.

Belt and braces: surface remaining window time in the composer (`message-thread.tsx`)
so the agent sees "window closes in 3 h" before they type, and disable the
free-form composer when it is shut.

### 4.2 WhatsApp opt-out is untracked

`contacts` has `sms_opted_out` and `email_opted_out` — but no WhatsApp
equivalent. Meta requires WhatsApp-specific opt-in, honoured separately from
SMS consent, and quality rating punishes blocks and reports. Add
`whatsapp_opted_out` / `whatsapp_opted_out_at` mirroring the SMS columns (with
the same partial index), handle inbound `STOP`, and filter opted-out contacts
out of broadcast planning before the template send, not after.

Longer term, a first-class consent record — channel, consent type
(marketing / transactional), method, timestamp, source — is what survives a
TCPA or GDPR challenge. A boolean proves the current state but not that
consent was ever given.

### 4.3 Marketing vs utility template category is not modelled in cost terms

Category drives both approval odds and price, and utility inside an open
window is free. Showing the tenant which category a template is (and what it
will cost this send) turns an invisible bill into an informed choice.

### 4.4 Broadcasts do not check quiet hours or per-country rates

Broadcast planning has no notion of recipient time zone (TCPA quiet hours are
8am–9pm local, and Twilio/Meta enforce none of it for us) or of
country-varying marketing rates. Both belong in the plan phase, where the
recipient list is already resolved and nothing has been sent yet.

---

## 5. The answer, in one paragraph

A tenant using this CRM can message their customer freely for 24 hours after
that customer writes to them — and in that window the AI can reply
autonomously, which is what `auto-reply.ts` already does, subject to reply
caps, on-duty hours, and sticky human handoff. Outside that window the tenant
cannot say anything of their own choosing: they can only send a Meta-approved
template and wait to be let back in. That is why templates and broadcasts are
built the way they are here, and it is why the missing window check on 1:1
sends (§4.1) is the one gap worth fixing first.

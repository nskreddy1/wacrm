# Market Research & Architecture Analysis — July 2026

> Consolidated research behind the CRM roadmap. Read this before proposing or
> building new features. Companion to `.agents/TODO.md` (the sorted backlog),
> `features-100.md` (feature catalogue), `roadmap.md`, and `go-to-market.md`.

---

## 1. What we are today

A **multi-tenant WhatsApp-first CRM / customer-engagement platform** built on
Next.js (App Router) + Supabase (Postgres + RLS) + Twilio/Meta channels.

### 1.1 Shipped modules (25 feature folders in `src/features/`)

| Domain | Modules | Maturity |
|---|---|---|
| Messaging | `whatsapp`, `channels`, `broadcasts`, `inbox`, `templates`, `interactive` | Mature |
| Contacts/CRM | `contacts`, `pipelines`, `module-fields`, `external-sources` | Pipelines are basic (drag stages) |
| Automation | `flows`, `agents`, `assistant`, `webhooks` | AI agents rebuilt Jul 25 |
| Comms extras | `appointments`, `catalog`, `brand`, `presence`, `team-chat`, `support` | Mixed |
| Platform | `auth`, `admin`, `settings`, `api-keys`, `dashboards` | Mature; login-security added Jul 26 |

### 1.2 Notable recent migrations (Jul 24–26 2026)
- AI agents rebuild, per-agent prompts, custom specialist agents, round-robin.
- Email: `email_templates`, categories, opt-out, account email settings.
- Lead source attribution, tenant audit events.
- Login security, auth devices, platform provider policies + customization.

### 1.3 Architecture strengths
- Clean per-feature module boundaries (`components/`, `hooks/`, `lib/`).
- Multi-tenant with Supabase RLS + multi-org RBAC.
- Provider abstraction over Twilio + Meta (templates carry a `provider` key,
  synced from provider APIs with dedup ranking — see `feature-template-studio.md`).
- Real integration discipline: templates/statuses pulled from live provider APIs,
  never mocked.

### 1.4 Architecture gaps (vs. an "all-in-one client business OS")
1. **No money layer** — no invoices, quotes, payments, or revenue analytics.
2. **Thin project/work layer** — pipelines exist, but no projects, tasks, Kanban,
   budgets, or deadlines under a client.
3. **No client-facing surface** — everything is internal/agent-side; no branded
   client portal, no e-sign, no verified reviews.
4. **No conversation intelligence** — we send/receive messages and run AI agents,
   but do not score, transcribe, or coach on conversations/calls.
5. **Email is template-only** — no block/visual builder (in-flight request).
6. **Calendar is internal** — appointments exist but no external calendar sync.

---

## 2. Competitor landscape

### 2.1 India WhatsApp-CRM incumbents

| Product | Position | Known weak spots (what to exploit) |
|---|---|---|
| **Wati** | Market leader, SMB WhatsApp support+broadcast | Priced per-seat + WhatsApp markup; users complain about cost creep, support latency, rigid automation |
| **Interakt** | Jio-backed, cheap entry | Shallow CRM depth, limited pipeline/automation, basic reporting |
| **AiSensy** | Broadcast-heavy, low price | Broadcast-first; weak inbox/CRM, thin analytics |
| **DoubleTick** | Sales-team WhatsApp, catalog | Sales-team niche; limited back-office (no invoicing/projects) |

**Common gap across all of them:** they stop at *messaging*. None run the
client's *whole business* (leads → projects → invoices → portal → reviews).
That white space is exactly what Clienter targets and where we can win.

### 2.2 Clienter (clienter.co.in) — the direct model to match & beat

All-in-one CRM for Indian freelancers/small agencies. Built by Talagana Rajesh.
Pitch: stop juggling Excel + WhatsApp + Notion + Calendar.

**Feature set demonstrated:**
- **Lead pipeline** — drag-drop stages, follow-up notes/reminders, 1-click
  convert lead → client without retyping.
- **Projects** — multiple projects per client, budgets + deadlines, Kanban
  (To-do → Done), assign team members.
- **Invoices & payments** — GST-ready branded invoices, line items + tax, PDF
  export, record payments, live revenue analytics (outstanding view).
- **Meetings + Calendar** — schedule inside app, sync to Google Calendar.
- **Client portal** — branded (agency logo), client checks progress, downloads
  invoices, e-signs contracts.
- **Verified reviews** — post-project review from portal; public profile with
  real verified reviews (only actual clients can post).

**Pricing (launch):** Free ₹0 (5 clients, 10 projects, full pipeline+invoicing+
meetings+basic analytics). Pro ₹199/mo launch (was ₹499) — 30 clients, 60
projects, 5 team. Ultra ₹799/mo launch (was ₹1,999) — unlimited. Billed monthly
via Razorpay (UPI/cards/net-banking). Free plan, no credit card.

**Our edge vs Clienter:** we already have the hard part — real WhatsApp/Meta
messaging, broadcasts, templates, AI agents, multi-tenant RBAC. Clienter is
CRM-first with messaging bolted on; we are messaging-first and can add the
CRM/business layer on top of a stronger comms core.

### 2.3 Global reference products (client-happiness patterns)
HoneyBook, Moxie, SuiteDash, Bonsai — client-portal + proposals + invoices +
contracts. Common retention drivers worth copying:
- **Branded client portal** (white-label) = stickiness + perceived professionalism.
- **One calm place** — clients hate scattered WhatsApp threads; a portal that
  shows progress + invoices + files reduces status-chasing.
- **E-sign + proposals** shorten the sales cycle.
- **Verified reviews / public profile** = built-in growth loop (social proof
  that also markets the vendor).

### 2.4 360 Labs "Rios" — AI conversation-intelligence signal
AI-native studio; flagship **Rios** audits ~5,000 real-estate calls/day across
5+ companies. Turns each call into a scored intelligence report:
- Compliance / script-adherence scoring, agent performance tables,
  sentiment breakdown, Lead Hub analytics (calls, leads, calls-per-lead).
- Syncs scores/insights/leads/deals back into Salesforce/Zoho in real time;
  Excel import/export.
- Stack: Next.js, TypeScript, FastAPI, Supabase, Gemini 2.5 Pro; Supabase RLS,
  multi-org RBAC, CI/CD.

**Takeaway for us:** conversation intelligence is a credible premium/AI
differentiator. We already capture every WhatsApp conversation — we can score
adherence/sentiment/outcomes on *chat* (not just calls) and feed insights into
our own pipeline. This is a Phase-4 differentiator, not a day-1 feature.

---

## 3. What makes clients happy (retention thesis)

1. **Stop the scatter** — one dashboard for leads, work, money, and comms.
2. **Look professional to *their* clients** — branded portal, branded invoices,
   e-sign; the vendor looks bigger than they are.
3. **Get paid faster** — GST invoices + UPI/Razorpay + reminders over WhatsApp.
4. **Never drop a lead** — reminders, follow-ups, pipeline nudges.
5. **Proof of value** — verified reviews + live revenue analytics.
6. **Low friction to start** — generous free tier, no credit card, first client
   set up in minutes (Clienter's onboarding bar).

---

## 4. Feature-validation framework (apply to every new feature)

Do NOT full-build before validating. Gate each candidate:

1. **Problem interview** — 5–10 target users (Indian freelancers/agencies)
   confirm the pain in their words.
2. **Fake-door / design partner** — a nav item or landing section that measures
   intent (clicks / waitlist), or 2–3 committed design partners.
3. **Thin slice** — smallest usable version behind a flag for design partners.
4. **Adoption gate** — promote to full build only if the thin slice hits an
   agreed usage bar (e.g. ≥40% of active workspaces use it in 2 weeks).
5. **Instrument** — every feature ships with usage events so we can kill dead
   ones. Tie back to `go-to-market.md` phase KPIs.

---

## 5. Sources
- User-provided briefs: Clienter (clienter.co.in) product breakdown; 360 Labs
  Rios breakdown (both captured in chat, Jul 2026).
- Web research (Jul 2026): India WhatsApp-CRM landscape (Wati/Interakt/AiSensy/
  DoubleTick) and agency client-management retention patterns (HoneyBook/Moxie/
  SuiteDash/Bonsai).
- Internal: `features-100.md`, `roadmap.md`, `go-to-market.md`, live schema +
  `src/features/` module scan (Jul 26 2026).

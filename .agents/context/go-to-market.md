# Go-to-market: first clients → subscriptions → scale

Researched July 2026. Sources: bootstrap-SaaS playbooks, Wati /
Interakt / respond.io pricing pages, India GST + company-registration
rules, Paddle / Lemon Squeezy merchant-of-record docs.

Read with `features-100.md` (what to build) and `roadmap.md`
(what to fix first). This file covers **how to sell it**.

---

## 1. Operating without a registered company (yes, it works)

You do NOT need a company to start charging. Three legal paths,
in order of effort:

| Path | What it means | Limits |
| --- | --- | --- |
| **Merchant of Record (recommended)** | Paddle / Lemon Squeezy becomes the legal seller; you're an individual vendor. They handle global VAT/GST, invoicing, refunds, chargebacks. You get a payout. | Identity verification + personal tax info required. ~5% + payment fees. They can reject high-risk accounts. |
| **Sole proprietor (India)** | Sell under your own name/PAN. | GST registration mandatory once turnover > ₹20 lakh/yr — or **from the first rupee for inter-state services** (most SaaS is inter-state). So practically: register for GST early, but no company needed. |
| **Razorpay/Stripe as individual** | Individual accounts exist but are restricted and can freeze funds. | Avoid as primary rail; use MoR instead. |

**Triggers to register a Private Limited company** (any one):
- Turnover approaching ₹1 crore/yr
- An enterprise client demands a company invoice / signed DPA
- You want DPIIT Startup India benefits or equity funding
- You hire your first employee

Until then: MoR + GST-registered sole proprietor covers everything,
including the "10,000 clients" scenario legally — but in practice
register the company at ~₹1Cr revenue or your first enterprise deal,
whichever comes first.

---

## 2. Pricing & subscription plan

Competitor anchor points (July 2026): Wati Growth ~₹2,499/mo (5
agents), Interakt Starter ~₹999/mo, respond.io ~$79/mo. All add
Meta's per-conversation fees on top; Wati charges extra per agent.

### Our tiers (undercut on transparency, win on AI + verticals)

| Tier | Price | For | Includes |
| --- | --- | --- | --- |
| **Free** | ₹0 | validation, referrals | 1 user, 1 channel, 100 conversations/mo, "Powered by" badge |
| **Starter** | ₹1,499/mo (~$18) | solo + tiny teams | 3 users, WhatsApp + SMS + email, pipelines, templates, basic automation |
| **Growth** | ₹3,999/mo (~$48) | SMBs (sweet spot) | 10 users, AI agent + auto-replies, workflows, broadcasts, analytics, all vertical templates |
| **Business** | ₹9,999/mo (~$120) | scale-ups | 30 users, multi-workspace, API access, priority support, custom roles |
| **Enterprise** | custom | after company registration | SSO, audit export, SLA, dedicated support |

Rules learned from competitor complaints:
- **No per-agent surprise fees** (Wati's #1 complaint) — user caps per tier, clean upgrade.
- **Pass Meta conversation fees through at cost** with a visible usage meter (Zoko-style transparency) — never mark up invisibly.
- **Annual = 2 months free.** Bill via MoR checkout links until Stripe/Razorpay + company exist.
- AI usage: pool included credits per tier (e.g. Growth = 2,000 AI replies/mo), overage at cost + small margin.

Prerequisite build: billing/metering is P0 in `problems-100.md` (#31)
— gate tiers in `platform_settings` + a `subscriptions` table keyed by
MoR webhook events.

---

## 3. Getting the first clients (0 → 10 → 100 → 1,000 → 10,000)

### Phase 0 → 10: manual, personal, free (weeks 1–6)
- Pick ONE niche + ONE city (e.g. real-estate agencies in Hyderabad).
  The vertical templates in `features-100.md` §F–I are the weapon:
  demo "a CRM already set up for YOUR industry", not a blank tool.
- Personal WhatsApp/LinkedIn outreach to 10 warm or community
  contacts per day. Ask for feedback, not sale. Offer free setup +
  3 months free in exchange for weekly feedback calls.
- Onboard every client yourself; watch them use it. Every friction
  point goes to `problems-100.md`.

### Phase 10 → 100: one repeatable channel (months 2–6)
- Double down on whichever channel produced the first 10 (referrals,
  LinkedIn content, WhatsApp groups, local business associations).
- Founder-led content on ONE platform: post 3×/week showing real
  workflows ("how a property dealer auto-follows-up site visits").
- Referral engine: 1 free month per referred client, both sides.
- Start charging: grandfather the free-forever early users; everyone
  new lands on Starter/Growth.
- Case studies: 3 written wins with real numbers (response time ↓,
  leads converted ↑) — the single highest-converting asset at this stage.

### Phase 100 → 1,000: productize acquisition (months 6–18)
- Self-serve onboarding (template picker at signup, embedded-signup
  for WhatsApp) so a client can go live without you.
- SEO: comparison pages ("Wati alternative", "Interakt vs us"),
  vertical landing pages ("WhatsApp CRM for real estate").
- Marketplace listings: Meta Business Partners directory, G2,
  Capterra (reviews from the first 100).
- Agency/reseller program: agencies run client workspaces, 20%
  recurring commission — this is how Wati scaled in India.
- WhatsApp-native growth loop: "Powered by" footer on Free-tier
  outbound messages links to signup.

### Phase 1,000 → 10,000: company + partnerships (18 mo+)
- Register Pvt Ltd (you'll have crossed every trigger in §1).
- Move billing in-house (Stripe/Razorpay) for better margins; keep
  MoR for international.
- Channel partnerships: telecom resellers, POS vendors, vertical
  software (property portals, clinic-management tools).
- Enterprise motion: SSO + audit + SLA (features-100 §A) unlocks
  bigger contracts; hire first sales rep only after founder-led
  sales has a written, repeatable playbook.

---

## 4. KPIs per phase

| Phase | North star | Guardrails |
| --- | --- | --- |
| 0→10 | 10 weekly-active workspaces | you talk to every user weekly |
| 10→100 | ₹1L MRR | churn < 5%/mo, 3 case studies |
| 100→1k | ₹10L MRR | CAC payback < 6 mo, self-serve > 50% of signups |
| 1k→10k | ₹1Cr+ ARR | NRR > 100%, support tickets/client trending down |

---

## 5. What to build BEFORE selling (gate order)

1. Billing + plan gating (problems-100 #31) — can't charge without it.
2. Error tracking (#32) — can't support paying clients blind.
3. Mailtrap enum fix (#1) + send queue (#34) — reliability basics.
4. Onboarding template picker (features-100 §F–I, one vertical only).
5. Usage meter UI (conversations + AI credits) — pricing transparency.

Everything else (SSO, mobile apps, more verticals) comes after
revenue, pulled by client demand — not pushed by roadmap.

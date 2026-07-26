# Whole-Application Audit — Objective, Scale, Automation, Design
**Date:** 2026-07-26 · **Method:** traced from source + live DB queries.
Companion to `report-inbound-scale.md` (which covers inbound messaging only).

---

## 1. What is the OBJECTIVE of the current architecture?

**Objective, as built:** a multi-tenant, WhatsApp-first conversational CRM
where every customer conversation is captured, routed, automated by
configurable AI agents + flows, and actioned by a team — with per-workspace
channel credentials so each tenant brings their own Twilio/Meta account.

Stated as a single sentence the code actually supports:
> *"Never lose an inbound customer message, and answer it automatically when
> possible, correctly when not."*

**What the objective is NOT (yet):** it is not a business operating system.
There is no money layer (invoices/payments), no client-facing surface
(portal), and no billing/quota enforcement. Those are Phase-1+ per
`impl-plan-phase1.md`.

### Objective vs delivery scorecard

| Objective pillar | Status | Evidence |
|---|---|---|
| Capture every inbound message | **Strong** | 3 webhook entries, ack-first `after()`, idempotent `channel_webhook_events` |
| Multi-tenant isolation | **Strong-ish** | per-number tenancy routing, RLS + encrypted creds — BUT service-role bypasses RLS (W3) |
| Automate replies | **Built, partly INERT** | AI agents + 9 flow triggers exist; scheduled/wait paths not running (see §3) |
| Team actioning | **Strong** | inbox, presence, team-chat, tickets, pipelines, tasks |
| Monetize / meter | **Absent** | no plan limits, no quotas, no seat caps (§4) |
| Client-facing value | **Absent** | no portal, no invoices |

---

## 2. How many users do we have / can we serve?

### Actual (live DB, service-role count)
| Entity | Count |
|---|---|
| `auth.users` | **1** |
| `channel_connections` | **1** |
| contacts / conversations / messages | **0 / 0 / 0** |
| flows / flow_runs / broadcasts | **0 / 0 / 0** |
| appointments | **0** |
| Tables in schema | **78** |

**Conclusion: we are PRE-LAUNCH with zero production users.** Every scale
claim below is theoretical, untested by real traffic. There is no load test
in the repo. This is the most important context for any capacity discussion:
**we have built for scale we have never observed.**

### Theoretical capacity ceiling
Inbound is genuinely horizontal (serverless fan-out per message — see
`report-inbound-scale.md`). The binding constraints are NOT our app code:
1. **Meta/Twilio per-number throughput** (tier-based, 1k→100k/day) — the real
   ceiling for messaging volume.
2. **Supabase connection pool** — every fan-out invocation opens a client.
   Hundreds of concurrent invocations can exhaust Postgres connections. **No
   pooler config (pgBouncer/Supavisor) verified in repo → first real bottleneck.**
3. **LLM provider rate limits** — currently *unprotected* under fan-out
   (RISK-1 in-memory limiter).
4. **Outbound broadcast** — sequential in-request; caps out ~hundreds of
   recipients before timeout.

**Honest capacity verdict:** ingestion could plausibly handle thousands of
tenants; **outbound + AI throttling would fail long before that.** Serving
capacity ≈ dozens of low-volume tenants today without the fixes.

---

## 3. Are user tasks actually AUTOMATED? — the biggest finding

### Automation surface that EXISTS (rich)
9 flow trigger types in `flows/lib/types.ts`:
`keyword`, `first_inbound_message`, `manual`, `new_message_received`,
`new_contact_created`, `tag_added`, `conversation_assigned`,
`interactive_reply`, `scheduled`.
Plus AI auto-reply with supervisor routing, duty hours, reply caps, warm
handoff (audited in `report-inbound-scale.md`).

### CRITICAL-1 — the automation clock is NOT RUNNING
`src/app/api/flows/cron/route.ts` exists, is correctly auth-gated
(`AUTOMATION_CRON_SECRET`, `timingSafeEqual`), and does three jobs:
`resumeWaitingRuns()`, `startScheduledFlows()`, and sweeping stale runs.

**But there is NO `vercel.json` in the repo and no `crons` config anywhere.**
Nothing invokes this endpoint. Its own docstring says *"The cron is therefore
not optional."*

Consequences — all silent, no error surfaced to the user:
- **`scheduled` trigger flows never fire.** A tenant builds a scheduled
  campaign; it simply never runs.
- **Wait steps never resume.** Any flow with a delay hangs forever mid-run.
- **Stale runs are never swept.** This is the worst one: `flow_runs` has a
  partial unique index `idx_one_active_run_per_contact WHERE status='active'`.
  An abandoned run holds that slot **permanently**, so that contact can
  **never trigger any flow again.** Automation silently dies per-contact,
  cumulatively, forever.

**Verdict: automation is BUILT but only ~⅔ LIVE.** Event-driven triggers
(keyword, inbound, tag) work because they run on the webhook path. Anything
time-based is inert. This is a config gap, not a code gap — cheapest
high-impact fix in the codebase.

---

## 4. CRITICAL-2 — No plan limits, quotas, or seat enforcement
Searched `PLAN_LIMITS|max_seats|seat_limit|quota|plan_limit` across
`src/features` + `src/lib`: **zero matches.**

Implications:
- Cannot bill by tier (Free/Pro/Ultra in the GTM doc is unenforceable).
- No abuse ceiling: one tenant can consume unbounded AI spend on the owner's
  key (compounded by RISK-1's broken limiter).
- `ai_usage_log` table exists → usage is *recorded* but never *enforced*.

Metering exists as data; **enforcement is the missing half.**

---

## 5. Design audit

### Good (verified, not assumed)
- **Thin page wrappers.** Pages like `agents/page.tsx` are 5 lines delegating
  to a feature component. An earlier grep flagged pages "missing responsive
  classes" — **false positive**; layout lives in the components. Good
  separation.
- **Only 1** arbitrary spacing value (`p-[Npx]`) app-wide → spacing scale is
  respected.
- **447** responsive prefixes → mobile consideration is real.
- **44** `sr-only` usages; 20 of 25 icon-only buttons carry a label →
  a11y largely handled.

### Design issues to fix
| # | Issue | Scale | Why it matters |
|---|---|---|---|
| D1 | **236 raw Tailwind palette colors** (`text-red-500`, `bg-amber-100`…) bypass design tokens | 236 occurrences | Breaks theming/dark-mode guarantees; a token change won't propagate. Status colors should be semantic tokens (`--success`, `--warning`, `--destructive`) |
| D2 | **14 hardcoded `bg-white`/`bg-black`/`text-white`/`text-black`** across 5 files | 14 | Invisible/illegible in the opposite color scheme |
| D3 | ~5 icon-only buttons lack any accessible name | 5 | Screen-reader users get "button" |
| D4 | No shared status-color helper | — | Same semantic state styled inconsistently across modules (fix once, in one map) |

Not aesthetic nitpicks: D1+D2 are why dark mode drifts per-module.

---

## 6. Method-to-method: inbound automation call chain
```
Meta/Twilio POST
  └─ /api/{whatsapp/webhook | channels/webhooks/twilio | .../meta}
      ├─ verify signature (HMAC, constant-time)
      ├─ resolve tenant by RECEIVING number
      ├─ insert channel_webhook_events  ← idempotency (23505 = dup, skip)
      ├─ return 200  ← ack-first, inside Meta's ~20s window
      └─ after(() => …)               ← survives response; freeze-safe
           ├─ persistInbound()        → contacts, conversations, messages
           └─ orchestrateInbound()
                ├─ flows first (deterministic wins over AI)
                ├─ AI: supervisor route → duty hours → claim_ai_reply_slot
                │        (atomic cap; refunded on send failure)
                └─ else warm handoff → human
TIME-BASED PATH (currently dead):
  [nothing] ──X──> /api/flows/cron → resumeWaitingRuns
                                    startScheduledFlows
                                    sweepStaleRuns
```

---

## 7. Ranked fix list

| Rank | Fix | Severity | Effort |
|---|---|---|---|
| 1 | **Configure the cron** (`vercel.json` crons → `/api/flows/cron`) | CRITICAL — automation partly dead, permanent per-contact flow lockout | Trivial |
| 2 | Shared/Redis rate limiter (RISK-1) | CRITICAL — unbounded AI spend under fan-out | Small |
| 3 | Durable outbox for broadcasts (RISK-2) | HIGH — timeouts + double-send | Medium |
| 4 | Plan limits + quota enforcement | HIGH — cannot monetize, no abuse ceiling | Medium |
| 5 | Verify Supabase pooler for fan-out | HIGH — first infra bottleneck | Small |
| 6 | D1/D2 token sweep + status-color map | MEDIUM — theming correctness | Small |
| 7 | Tenant-guard middleware + RLS isolation tests (W3) | HIGH — one missed filter = cross-tenant leak | Medium |

---

## 8. Bottom line
- **Objective:** never lose an inbound message; automate the reply. Solid and
  coherently built.
- **Users:** **1 (pre-launch, zero real traffic).** All scale is untested.
- **Automation:** event-driven works; **everything time-based is inert
  because no scheduler is configured** — and it silently, permanently locks
  contacts out of future flows.
- **Design:** structurally healthy (thin pages, spacing scale, a11y); the real
  debt is 250 token bypasses that break theming.
- **Monetization:** absent — usage is logged, never enforced.

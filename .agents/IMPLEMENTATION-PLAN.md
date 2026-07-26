# IMPLEMENTATION PLAN — Full Phased Build (consolidated, 2026-07-26)

> **The single execution document.** Merges: certified Phase-1 plan
> (`context/impl-plan-phase1.md`), master backlog (`TODO.md`), app audit
> (`context/report-app-audit.md`), inbound-scale report
> (`context/report-inbound-scale.md`), feature inventory
> (`context/report-feature-inventory.md`), vertical architecture
> (`context/vertical-architecture.md`), and GTM (`context/go-to-market.md`).
>
> Ground truth as of today: **26 modules, ~86k LOC, 78 tables, 80 test files,
> 1 real user, 0 production traffic.** Cron/automation FIXED and live.
> Open criticals: quotas unenforced (CRITICAL-2), in-memory rate limiter
> (RISK-1), sequential broadcast fan-out (RISK-2), settings 12k LOC untested.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done
Every phase ends with **exit criteria** — do not start the next phase until
they pass. Features must also pass the validation gate
(`context/research-2026-07.md` §4).

---

## PHASE 0 — Stabilize + make the base billable (NOW)

Goal: the platform can be *sold* safely — limits enforced, abuse impossible,
failures visible. Mostly small, high-leverage fixes found by the audits.

- [x] 0.1 Cron/scheduler alive — vercel.json schedule + dual-auth
      (`cron-auth.ts`, 14 tests) + proxy exemption + CRON_SECRET set.
      Verified live: 401/401/200.
- [ ] 0.2 **Quota/entitlement engine (CRITICAL-2).** `plan_limits` table +
      `enforceLimit(workspace, metric)` helper called in contact-create,
      broadcast-send, AI-reply, seat-invite paths. Free/Pro/Ultra rows
      seeded. Without this the pricing page is fiction.
- [ ] 0.3 **Shared rate limiter (RISK-1).** Swap `src/lib/rate-limit.ts`
      Map → Upstash Redis (same call signature). The 30/min AI cap must hold
      across serverless fan-out. Load-test with 50 parallel requests.
- [ ] 0.4 **Sentry + structured logging (F2).** Error tracking on all API
      routes + the cron worker; `usage_counters` table for metering.
- [ ] 0.5 **Feature-flag scaffold.** `workspace_flags` JSONB + `hasFeature()`
      helper + settings toggle UI. Needed for design-partner thin slices.
- [ ] 0.6 **Smoke-test baseline (GAP-1).** Template-sync + broadcast-eligibility
      + inbound-dedup fixtures, so later phases have a regression bar.
- [ ] 0.7 **Settings module tests.** Minimum: channel-credential save/decrypt
      roundtrip, role-permission matrix, API-key scope enforcement (12k LOC,
      0 tests today — where creds live).

**Exit criteria:** free-plan workspace blocked at limit with upgrade prompt;
rate cap holds under parallel fire; one forced error visible in Sentry;
smoke suite green in CI.

---

## PHASE 1 — Foundation hardening + Invoices & payments (CERTIFIED)

Execute `context/impl-plan-phase1.md` exactly — it survived 3 certification
passes (C1–C7, GAP-1…5 closed). Summary of what ships:

- [ ] 1.1 **F1 Tenant-guard** — `withWorkspace()` scoped db handle that
      injects `workspace_id` into every query and refuses unscoped ones
      (service-role BYPASSES RLS — this is the primary control). Cross-tenant
      test must fail-to-access.
- [ ] 1.2 **F3 Durable outbox** — `outbox` table, UNIQUE idempotency_key,
      `FOR UPDATE SKIP LOCKED` worker on cron, exponential backoff. Reused by
      invoices now, broadcasts in Phase 4.
- [ ] 1.3 **I1 Invoices** — GST-correct schema (CGST/SGST/IGST split, HSN/SAC,
      GSTIN, place-of-supply, `round_off_minor`, integer minor units only),
      service layer (`createInvoice/recalcTotals/issueInvoice/recordPayment/
      voidInvoice`), per-workspace number sequence (`FOR UPDATE`), audit
      events same-transaction. Non-GST fallback if workspace has no GSTIN.
- [ ] 1.4 **I1 UI** — invoices list + editor (server-echoed totals) + detail
      drawer (PDF, timeline, resend). Dark, existing tokens.
- [ ] 1.5 **PDF as outbox job** (render→store→attach, retryable).
- [ ] 1.6 **I2 Razorpay** — payment link on issue; HMAC-verified webhook is
      the ONLY paid transition; out-of-order webhook matches on provider_ref.
- [ ] 1.7 **Deliver via WhatsApp** (approved utility template — one exists:
      `utility_appointment_reminder`; author an invoice template) + email.
- [ ] 1.8 Regression sweep vs Phase-0 smoke suite.

**Exit criteria:** C1–C7 all green (see certified plan §2); a design partner
can create→issue→send→get paid end to end in test mode.

---

## PHASE 2 — Projects & tasks

Turn a won deal into delivered work. Reuses tenant-guard + audit + flags.

- [ ] 2.1 Schema: `projects` (contact_id, budget_minor, deadline, status),
      `project_tasks` (assignee, kanban_order, due).
- [ ] 2.2 Kanban board (To-do → In progress → Done), team-assignable; reuse
      pipelines' drag-drop patterns.
- [ ] 2.3 Link project ↔ deal ↔ invoices (money view per project).
- [ ] 2.4 1-click lead → client conversion (no retyping).
- [ ] 2.5 Flow-engine hooks: `project_created`/`task_overdue` triggers so
      automations cover delivery, not just sales.

**Exit criteria:** deal → project → tasks → invoice chain works browser-
verified; adoption gate: design partners create ≥1 real project each.

---

## PHASE 3 — Client portal + verified reviews (the "wow")

Depends on Phases 1+2. The client-facing surface no incumbent has.

- [ ] 3.1 Branded per-workspace portal (logo, slug), magic-link client auth
      (no password), strictly read-scoped by contact.
- [ ] 3.2 Client view: project progress, invoice list + **pay now**
      (Razorpay link), shared files.
- [ ] 3.3 E-sign for proposals/contracts (signature capture + audit trail).
- [ ] 3.4 **Verified reviews loop** — post-project review from portal →
      public agency profile; only real clients can post → shareable profile
      = organic acquisition channel. Own KPI: review-submission rate.

**Exit criteria:** a real client of a design partner logs in, sees progress,
downloads an invoice; ≥1 verified review submitted.

---

## PHASE 4 — Scale the messaging spine

Pre-requisite for >100 tenants; uses the Phase-1 outbox.

- [ ] 4.1 **Broadcast fan-out via outbox (RISK-2).** Enqueue one job per
      recipient (idempotency_key = broadcast_id+contact_id); worker drains
      with per-tenant rate caps. Kills timeout+double-send.
- [ ] 4.2 Per-tenant + per-number outbound throttles (Meta quality rating
      protection).
- [ ] 4.3 Broadcast progress UI (sent/delivered/failed live counts).
- [ ] 4.4 Load test: 5k-recipient broadcast completes, zero duplicates.

**Exit criteria:** 5k-recipient test broadcast: 0 dupes, 0 timeouts,
resumable after deploy mid-send.

---

## PHASE 5 — Calendar + scheduling

- [ ] 5.1 Google Calendar 2-way sync for `appointments` (OAuth per user).
- [ ] 5.2 Public booking links (client picks slot → appointment + WhatsApp
      confirmation via flow trigger `appointment_created` — already exists).

**Exit criteria:** external booking → calendar event → WhatsApp confirmation
without human touch.

---

## PHASE 6 — AI differentiators

Where we beat Clienter AND the messaging incumbents. Foundation exists
(21 tools, 4 providers, RAG, MCP).

- [ ] 6.1 **Conversation intelligence** — score WhatsApp threads (sentiment,
      outcome, next-step) per the active workspace's goals; agent coaching
      view; feed scores to pipeline cards.
- [ ] 6.2 **Inbox copilot** — suggested replies, thread summary, auto-fill
      CRM fields from conversation.
- [ ] 6.3 **Predictive lead scoring** from engagement events.
- [ ] 6.4 **Approval gate on AI workflow writes** — `create_workflow`/
      `activate_workflow` require human confirm (flagged in feature
      inventory as highest-risk write path).
- [ ] 6.5 AI-generated vertical packs (pull-forward from
      `vertical-architecture.md` §10.1) — "describe your business" →
      generated fields/stages/templates/flows, human-approved.

**Exit criteria:** measurable reply-time or conversion delta for a design
partner with copilot ON vs OFF (flags make the A/B possible).

---

## PHASE 7 — Email block builder (LAST, by explicit decision)

- [ ] 7.1 Vendor upstream **EmailBuilder.js** (`@usewaypoint/email-builder`,
      MIT) into `src/features/templates/email/` — NOT the stale itswadesh
      fork (2 stars, dead since Aug 2024).
- [ ] 7.2 Wire design tokens, merge-vars ({{first_name}}), brand logo into
      block palette; desktop+mobile preview; dark-aware canvas.
- [ ] 7.3 Persist `design_json` + rendered HTML on `email_templates`;
      render-on-send; respect `email_opt_out`.

**Exit criteria:** design partner builds + sends a branded email without
touching HTML.

---

## PHASE 8 — GTM execution (PARALLEL track, starts after Phase 1)

See `context/go-to-market.md`. Build-gated: do not launch a tier whose
features aren't enforceable (Phase 0.2).

- [ ] 8.1 Marketing site + pricing page (Free/Pro/Ultra, launch offers).
- [ ] 8.2 Onboarding: first channel connected + first automation live in
      <10 min, no credit card.
- [ ] 8.3 Design-partner cohort (5–10 Indian freelancers/agencies) on flags.
- [ ] 8.4 Verified-review + referral loops live (from Phase 3).
- [ ] 8.5 KPI wiring: 0→10→100→1k clients funnel on `usage_counters`.

---

## Sequencing summary

```
PHASE 0  stabilize/billable   ██ start now
PHASE 1  foundation+invoices  ████ certified, start after 0.2/0.3
PHASE 2  projects/tasks       ███
PHASE 3  portal+reviews       ███
PHASE 4  messaging scale      ██  (before >100 tenants or big broadcasts)
PHASE 5  calendar             ██
PHASE 6  AI differentiators   ███ (6.4 approval gate can land any time)
PHASE 7  email builder        ██  LAST
PHASE 8  GTM                  ── parallel from Phase 1 onward
```

Rules:
1. No phase starts until the previous phase's **exit criteria** pass.
2. Every feature passes the validation gate (interviews → thin slice →
   adoption) before being promoted beyond design partners.
3. Vertical-pack abstraction is **extracted, not designed** — after Phase 3
   ships for the agency vertical (per `vertical-architecture.md` §7).
4. Re-run certification passes (v1→v3 style) whenever a phase's scope changes.

## Immediate next actions
1. **0.2 quota engine** — makes pricing real (CRITICAL-2).
2. **0.3 Redis rate limiter** — closes the fan-out hole (RISK-1).
3. Then Phase 1 task order §8 of the certified plan, starting with F1
   tenant-guard.

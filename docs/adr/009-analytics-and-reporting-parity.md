# ADR-009: Analytics and reporting parity — per-feature gap analysis and improvement plan

**Status:** Proposed
**Date:** 2026-08-21
**Deciders:** Owner/product (which reports ship first), backend (aggregation queries + digest job), design (report surfaces)
**Relates to:** ADR-007 (feature catalog — reports ship _inside_ the features they describe), ADR-008 (onboarding — a good first-run is wasted if week-2 has no answers), ADR-005 (AI agents — usage log this ADR builds on)

---

## Context

ADR-007 mapped Salesforce's 19 CRM features to our 27 modules and concluded
"almost everything already exists here". That was true for **surface area**
and false for **depth**. Salesforce's own framing of feature #4:

> "Reports, dashboards & analytics — a CRM's true power is turning activity
> into answers: what happened, why, and what happens next."

A CRM is judged on whether a sales lead can open it Monday morning and answer:
_what happened last week, where is the pipeline going, what did the AI handle
for me, which campaign worked?_ Audit of the running code (2026-08-21) says we
cannot answer most of those today.

### Per-feature audit: what exists vs. what a CRM must answer

| Feature                  | What exists today                                                                                                                                                                       | What the benchmark answers that we can't                                                                                                                                                        | Gap severity |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| **Pipelines / deals**    | One inline "weighted forecast" number (`Σ value × probability`) and open-deal count in `pipeline-workspace.tsx`; a pipeline funnel widget on the dashboard                              | Win rate, loss reasons, stage-to-stage conversion, sales velocity (avg days per stage), deal aging/rot, period forecast (this month/quarter vs. target), forecast trend over time, per-rep splits | **High**     |
| **AI / auto-reply**      | `ai_usage_log` rows (tokens + cost per call, per agent) written by `logAiUsage`; no analytics UI over outcomes                                                                          | How many conversations did AI fully handle vs. hand off? Deflection rate, handoff reasons, response accuracy signals (user re-asked?), busiest intents, cost per resolved conversation             | **High**     |
| **Dashboards**           | Solid overview widgets (KPI cards, funnels, contacts growth, lead sources, team performance, volume) + custom dashboards; a single `/api/dashboards` overview endpoint                  | Date-range comparison ("vs. previous period"), drill-down from any widget to the underlying records, export (CSV), saved report views                                                             | Medium       |
| **Daily/scheduled reports** | Nothing — no digest, no scheduled delivery of any kind                                                                                                                              | "Yesterday: 34 new conversations, 5 deals moved, 2 stuck >7 days, AI resolved 12" delivered to the channel the team already reads (email; the CRM shouldn't require opening the CRM)              | **High**     |
| **Broadcasts**           | Per-broadcast status counts (`broadcast-status.ts`) and one dashboard funnel widget                                                                                                     | Delivery → read → reply funnel per broadcast over time, comparison across broadcasts, best send-time analysis, opt-out tracking                                                                    | Medium       |
| **Flows / automations**  | Run records exist; no aggregate view                                                                                                                                                     | Which automations fire most, success/failure rate per flow, what each flow saved (messages auto-handled)                                                                                           | Medium       |
| **Inbox / conversations** | Volume chart on dashboard                                                                                                                                                              | First-response time, resolution time, per-agent load, busiest hours, SLA breaches                                                                                                                  | Medium       |
| **Support tickets**      | Ticket list + statuses                                                                                                                                                                   | Open/closed trend, time-to-resolution, reopen rate                                                                                                                                                 | Low (feature itself is optional) |
| **Contacts**             | Growth chart, lead-source widget                                                                                                                                                         | Cohort quality (which source converts), duplicate/stale-contact hygiene report                                                                                                                     | Low          |

Two structural findings behind the table:

1. **Metering exists, meaning doesn't.** `ai_usage_log` and `flow` runs record
   raw events for billing/debugging, but nothing aggregates them into answers.
   The data for most "High" gaps is already being written.
2. **Reporting is trapped on one page.** Everything analytic lives on
   `/dashboard`. A user inside Pipelines, Broadcasts, or the AI agent screen
   gets no numbers where they're working — the benchmark CRMs put a Reports
   tab inside each feature.

## Decision

### D1 — Reports live inside their feature, not on a separate "Analytics" module

No new `analytics` feature module and no new nav item. Each feature that is
enabled (ADR-007) gains a **Reports tab/section inside its own surface**:
Pipelines → "Reports", Broadcasts → per-broadcast report + compare view,
AI agents → "Performance", Inbox → "Insights" (admin/owner). The dashboard
remains the cross-feature summary that links into these.

Rationale: enablement stays one axis (a workspace that turned broadcasts off
must not see broadcast analytics anywhere), and users find numbers where they
already work. This also means each report ships independently — no big-bang.

### D2 — Close the High gaps first, in this order

1. **Pipeline reports** (`src/features/pipelines/`): win rate, loss reasons
   (add a required reason on marking a deal lost), stage conversion, sales
   velocity, deal aging, and a real **forecast view** — weighted forecast per
   period with target line, replacing today's single inline number. All
   computed from existing `deals` history; needs a `deal_stage_events` audit
   table (stage, entered_at) populated by the existing move-deal path.
2. **AI performance** (`src/features/assistant/`): per-agent and per-account —
   conversations touched, fully-handled vs. handed-off (the sticky-handoff
   flag in `lib/ai/handoff.ts` is the signal and is already stored), reply
   caps hit, cost per conversation from `ai_usage_log`. This is the report
   that justifies (or kills) the BYO-key spend — the single most requested
   number for an AI CRM.
3. **Daily digest**: an opt-in per-workspace summary email (owner/admin
   chooses recipients and send hour) covering yesterday's conversations,
   deal movements, stuck deals, AI outcomes, broadcast results. Rendered from
   the same aggregation queries as the in-app reports — the digest is a view,
   never a second source of truth. Delivery reuses the existing email infra
   (`src/lib/email/`); scheduling via the same mechanism the broadcast
   scheduler already uses.

### D3 — Then the Medium gaps, each as a small independent slice

Broadcast compare view → flow run analytics → inbox response-time insights →
dashboard period-comparison + CSV export. Each is its own PR against its own
feature module; none blocks another.

### D4 — One shared aggregation layer, feature-owned queries

Cross-cutting plumbing goes in `src/lib/reporting/` (period bucketing,
timezone-safe date ranges, compare-to-previous-period helpers — extending
`src/features/dashboards/lib/date-utils.ts` which already solved half of
this). The **queries themselves stay in each feature's `lib/`** per the
vertical-architecture boundary rules. All aggregates are computed via
RLS-scoped queries per account; no cross-tenant rollups, no service-role
shortcuts for reporting.

### D5 — Reports respect all three access axes

A report renders only when its feature is `entitled ∧ enabled ∧ permitted`
(ADR-007 D5). Team-performance and per-rep reports are owner/admin only;
agents see their own numbers. The daily digest silently omits sections whose
features are disabled — a workspace without pipelines gets a digest with no
deal section, not an empty one.

## Consequences

**Positive**

- The Monday-morning questions become answerable, feature by feature, without
  a new module, new nav item, or new architecture.
- Most High-gap data is already captured (`ai_usage_log`, deal history, flow
  runs, broadcast statuses) — the work is aggregation + UI, not new pipelines
  of event collection.
- The daily digest gives the CRM a pulse outside the app — the strongest
  known retention lever for small teams that "forget" their CRM.

**Negative / accepted costs**

- `deal_stage_events` and a loss-reason field are small schema additions
  (idempotent migrations, per `AGENTS.md` workflow) and the move-deal path
  gains one insert.
- Loss reasons require a UX interruption when marking a deal lost — worth it;
  every serious CRM does this because loss analytics are worthless without it.
- Aggregation queries on large accounts may need materialized rollups later;
  deferred until a real account proves it (measure first).

**Explicitly not doing**

- No separate "Analytics" nav module, no BI/report-builder, no cross-tenant
  benchmarking, no data warehouse export in this ADR.
- No real-time streaming analytics — daily/period granularity is the product
  need; live counts stay where they already exist (inbox badges, dashboards).
- No pricing/tier gating of reports here — entitlement stays in `plans`.

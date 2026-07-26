# Current Architecture — Three-Lens Review (Jul 2026)

> Steelman → What-am-I-missing → 10x, applied to the EXISTING 25-module
> codebase. Companion to `research-2026-07.md` (§ architecture analysis) and
> `vertical-architecture.md` (which got the same treatment in its §8–§10).
> Purpose: harden the current engine BEFORE layering vertical packs on it.

---

## 1. Steelman — what is genuinely strong today

- **Real provider integrations**: encrypted per-workspace Twilio creds, live
  Content API + ApprovalRequests, Meta/Twilio template coexistence with dedup
  ranking. Production-grade, not mocked.
- **Modular monolith done right**: 25 feature modules under `src/features/*`
  with a consistent `components/hooks/lib` shape. One deploy, clear
  boundaries, no microservice tax — correct for team size.
- **Multi-tenant security early**: Supabase RLS + RBAC + encrypted channel
  credentials at rest.
- **Knowledge system**: `.agents/context/` docs make agents/humans productive
  in minutes — a real velocity multiplier.
- **Config primitives already exist** (`module_field_settings`, configurable
  pipelines, dynamic templates/flows/dashboards) — the reason vertical packs
  are cheap to add.

## 2. What-am-I-missing — the honest weaknesses

| # | Weakness | Risk |
|---|---|---|
| W1 | **No service layer** — logic split across API routes + hooks; `template-studio.tsx` ~1,900 lines; cred-decryption re-implemented in ad-hoc scripts repeatedly | Duplication, drift, untestable logic |
| W2 | **Nothing is durable** — sync/broadcast run inside user HTTP requests; no queue, no retries, no idempotency keys | Large broadcast = timeout mid-send + double-send on retry. Scariest gap for a messaging product |
| W3 | **Service-role key bypasses RLS in API routes** — tenant checks re-implemented manually per route | One forgotten check = cross-tenant data leak |
| W4 | **Zero observability** — no Sentry, no structured logs, no per-tenant metering | Can't debug client failures; can't usage-bill later |
| W5 | **No tests** — 60+ migrations, 25 modules, no regression protection | Every refactor is a leap of faith |
| W6 | **Provider logic inline** — Twilio/Meta specifics at every call site | New channel/provider = shotgun surgery |

## 3. 10x — the upgrades that change the game (ordered)

1. **Channel adapter seam.** `ChannelProvider` interface (send,
   syncTemplates, submitApproval, parseWebhook) with `twilio` / `meta` /
   `email` implementations + contract tests on recorded fixtures. Fixes W6,
   makes every future channel one adapter.
2. **Durable send pipeline.** Outbox table + queue (Vercel Workflow / QStash /
   cron worker) with idempotency keys for broadcast fan-out, template sync,
   webhook processing. Fixes W2 — prerequisite for scaling past ~100 clients.
3. **Domain event bus.** Every action (`message.sent`, `lead.stage_changed`,
   `invoice.paid`) appends an event; audit, automation flows, conversation
   intelligence, and metering become consumers of ONE stream.
4. **Tenant-guard middleware.** Single `withWorkspace()` wrapper mandatory on
   every API route + RLS isolation tests. Fixes W3 structurally.
5. **Observability = billing foundation.** Sentry + structured logs +
   per-tenant counters. Fixes W4 and pre-builds usage-based pricing.

## 4. Sequencing rule

These hardening items ARE Phase 0 of `../TODO.md` (they supersede/expand the
old P0 list). Rule of thumb:
- **Before Phase 1 (invoices/projects/portal):** tenant-guard middleware (W3)
  and Sentry/structured logs (W4-lite) — cheap, protects everything after.
- **With Phase 1:** service-layer extraction for NEW features only (invoices
  ship with a proper `lib/service` from day one; don't stop to refactor old
  modules).
- **Before first client >1k contacts:** durable send pipeline (W2).
- **Opportunistic:** adapter seam lands whenever we next touch provider code;
  never a big-bang rewrite.

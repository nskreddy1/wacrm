# Current Architecture — Three-Lens Review (Jul 2026)

> Steelman → What-am-I-missing → 10x, applied to the EXISTING feature-module
> codebase. Companion to `research-2026-07.md` (§ architecture analysis) and
> `vertical-architecture.md` (which got the same treatment in its §8–§10).
> Purpose: harden the current engine BEFORE layering vertical packs on it.
>
> **This is a point-in-time review, not a current-state reference.** It was
> written when there were 25 feature modules and no test suite; there are now
> **27 modules and 913 tests**. Re-verified against the running code:
> **W5** (no tests) and **W6** (inline provider logic) are largely resolved,
> **W4** is partly resolved, and **10x item #1** is done — which promotes the
> durable send pipeline (**W2**) to the top priority. W1/W3 were re-measured
> and are both worse than originally written. For verified current counts see
> `README.md` § Current shape.

---

## 1. Steelman — what is genuinely strong today

- **Real provider integrations**: encrypted per-workspace Twilio creds, live
  Content API + ApprovalRequests, Meta/Twilio template coexistence with dedup
  ranking. Production-grade, not mocked.
- **Modular monolith done right**: 27 feature modules under `src/features/*`
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
| W1 | **No service layer** — logic split across API routes + hooks; `template-studio.tsx` is now **2,097 lines** (up from ~1,900 when this was written), and `flows/lib/engine.ts` 1,496, `pipelines/components/pipeline-workspace.tsx` 1,392, `inbox/components/message-thread.tsx` 1,271; cred-decryption re-implemented in ad-hoc scripts repeatedly | Duplication, drift, untestable logic. The trend is the point: this weakness is still growing |
| W2 | **Nothing is durable** — sync/broadcast run inside user HTTP requests; no queue, no retries, no idempotency keys | Large broadcast = timeout mid-send + double-send on retry. Scariest gap for a messaging product |
| W3 | **Service-role key bypasses RLS in API routes** — **35 of 115 route handlers** import a service-role `admin-client`; tenant checks are re-implemented manually in each, with no lint rule enforcing `account_id` scoping | One forgotten check = cross-tenant data leak. No automated test covers tenant isolation |
| W4 | **Thin observability** — **partly addressed**: `usage_counters` + `lib/quotas/` give per-tenant metering, `audit_events` gives a tenant-visible trail, and the alerts subsystem (`alert_rules` → `alert_events` → `alert_deliveries`) fires threshold notifications. Still missing: **no Sentry or any error tracking**, and no structured request logging with request IDs (the Pino/request-ID layer disappeared with the Express removal) | Can't debug client failures or trace a request across routes. Usage-billing groundwork now exists |
| W5 | ~~**No tests**~~ — **stale as written.** 913 tests across 99 files now run in `pnpm check`. The real residual gap is narrower: only **4 of 115 route handlers** are tested, there is **no E2E suite**, and no automated tenant-isolation/RLS test exists | Domain logic in `features/*/lib` is well covered; the HTTP surface and cross-tenant leakage are not |
| W6 | ~~**Provider logic inline**~~ — **largely resolved.** `channels/lib/contracts.ts` now defines a `ChannelAdapter` interface (+ `ChannelCapabilities`, `NormalizedInboundMessage`, `ChannelSendResult`) with **6 adapters** in `channels/lib/adapters/`: `meta`, `twilio`, `twilio-sms`, `smtp`, `resend`, `mailtrap`, behind a `provider-registry`. Residual: WhatsApp-specific logic still lives in `features/whatsapp/lib/` outside the seam | New channel is now one adapter, not shotgun surgery |

## 3. 10x — the upgrades that change the game (ordered)

1. ~~**Channel adapter seam.**~~ **DONE.** `ChannelAdapter` in
   `channels/lib/contracts.ts` with 6 adapters and a `provider-registry`,
   plus tests (`provider-registry.test.ts`, `orchestrate-inbound.test.ts`).
   Remaining: pull `features/whatsapp/lib/` behind the same seam, and add
   contract tests on recorded provider fixtures (problems-100 #71).
2. **Durable send pipeline.** ← **now the top priority.** Outbox table +
   queue (Vercel Workflow / QStash / cron worker) with idempotency keys for
   broadcast fan-out, template sync, webhook processing. Fixes W2 —
   prerequisite for scaling past ~100 clients. Verified absent: no queue
   dependency of any kind is installed, and `automation_pending_executions`
   is the only outbox-shaped table.
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

# wacrm — Agent Context Pack

Read this folder before doing any feature work. It is the handoff from
previous build sessions. Keep it updated when you change architecture,
routes, schema, or security posture.

## Current shape (verified against the running system)

Numbers drift, and stale numbers in prose are how agents end up "fixing"
things that already exist. Trust this block over any count written inside
the longer docs below; regenerate the schema reference with `pnpm db:doc`
and re-verify these with the commands in the right-hand column.

| Fact | Value | How to re-check |
| --- | --- | --- |
| Processes | **1** (Next.js 16.2.12) | there is no `server/`, no `/api/service`, no `concurrently` |
| Feature modules | 27 | `ls src/features` |
| API route handlers | 115 across 19 namespaces | `find src/app/api -name route.ts \| wc -l` |
| Public API routes | 25 under `/api/v1` | stability contract — additive changes only |
| Pages | 37 | `find src/app -name page.tsx \| wc -l` |
| Migrations | 131 | `ls supabase/migrations/*.sql \| wc -l` |
| Tables in `public` | 88, **RLS enabled on all 88** | `pnpm db:doc` prints this and warns on any gap |
| DB functions | 193 | `.agents/context/database-schema.md` § Functions |
| Tests | **913 passing, 99 files** | `pnpm test` |
| Full gate | `pnpm check` | typecheck + lint + boundaries + test |

Two corrections that outrank older prose in this folder:

- **The Express API is gone.** Several docs still describe a second Express 5
  process on port 4000 behind an `/api/service/[...path]` forwarder. Neither
  exists. Everything is Next.js route handlers talking to Supabase.
- **"No tests" is wrong.** `current-architecture-review.md` W5 and
  `problems-100.md` predate the suite; there are now 913 tests. The accurate
  residual gap is tenant-isolation/RLS coverage and the settings UI, not
  absence of tests.

## Reading order

**New to the project?** `hld.md` → `database.md` → `lld.md`.
**About to write code?** `lld.md` + `security.md`.
**Need an exact column or index?** `database-schema.md`.

| File | What it covers |
| --- | --- |
| `hld.md` | **High-level design.** What the product is, the one architecture diagram, tenancy model, all 16 domains, the 3 critical data flows, tech-stack rationale, architectural weaknesses, and where to make a change |
| `lld.md` | **Low-level design.** Layer rules, real method signatures (`getCurrentAccount`, `requireSuperAdmin`, `ChannelAdapter`, rate limit, audit, v1 helpers), the canonical route-handler order, full 115-route inventory, frontend + migration + test conventions |
| `database-schema.md` | **Full DB reference — GENERATED, never hand-edit.** All 88 tables with exact column types, nullability, defaults, FKs with ON DELETE, every index's `CREATE INDEX`, check constraints, triggers, and all RLS policy expressions. Rebuild with `pnpm db:doc` after any migration |
| `database.md` | Conceptual data model: schema domains, key tables, RLS model, migration conventions |
| `system-design.md` | Tech stack, project structure, feature map, system design |
| `api-routes.md` | Every API namespace, its auth gate, and conventions |
| `security.md` | Security architecture, review checklist, known patterns |
| `roadmap.md` | Ranked problems, pre-production checklist, competitive feature gaps |
| `features-100.md` | **100-feature build catalog** (Jul 2026 research): enterprise gates, omnichannel, agentic AI, sales, verticals (real estate, healthcare, education, automotive, retail), analytics, platform — each scored P0–P2, plus the vertical-template strategy |
| `problems-100.md` | **100-problem audit** of the current app: bugs, security, enterprise gaps, architecture, data model, testing, observability, UX — each scored S1–S4 with a fix-order summary for the ship-blockers |
| `go-to-market.md` | **Client acquisition + pricing strategy** (Jul 2026 research): selling without a registered company (MoR, GST rules, when to incorporate), subscription tiers vs Wati/Interakt, phase-by-phase plan 0→10→100→1k→10k clients, KPIs per phase, build-before-selling gate order |
| `feature-<name>.md` | **Per-feature HLD + LLD docs.** Naming convention: one doc per shipped feature, covering architecture, file map, DB columns, invariants, and extension points. First: `feature-template-studio.md` (multi-channel Template Studio, Twilio/Meta provider model, sync dedup ranking, provider lock, compliance engines) |
| `research-2026-07.md` | **Market research + current-architecture analysis (Jul 2026).** What we are today (25 modules + gaps), India WhatsApp-CRM competitor landscape (Wati/Interakt/AiSensy/DoubleTick) and their weak spots, the Clienter parity model, the 360 Labs "Rios" conversation-intelligence signal, the client-happiness/retention thesis, and the feature-validation framework. Read before proposing new features. |
| `vertical-architecture.md` | **Multi-vertical strategy.** Horizontal core + Vertical Packs (config, not forks), compliance as a separate axis, module-enablement flags, REVISED build order (extract abstraction from one real vertical), falsifiable gates G1–G4, config test-matrix policy, vertical migration rules, honest compliance program scope, and 10x pull-forwards (AI-generated packs first) |
| `current-architecture-review.md` | **Three-lens review of the existing engine** (steelman / gaps / 10x): W1–W6 weaknesses (no service layer, nothing durable, service-role bypasses RLS, no observability/tests, inline provider logic) and the ordered 10x fixes (adapter seam, durable send pipeline, event bus, tenant-guard middleware, metering) with sequencing rules relative to Phase 1 |
| `impl-plan-phase1.md` | **Certified Phase 1 implementation plan** — foundation hardening (tenant-guard middleware, Sentry/metering, durable outbox) + GST-ready Invoices with Razorpay. Includes 7 binary acceptance criteria C1–C7 and 3 iterative certification passes (v1→v2→v3) that surfaced and closed real gaps (service-role/RLS reality, GST CGST/SGST/IGST split, currency rounding). Read before building Phase 1. |
| `report-inbound-scale.md` | **As-built audit of inbound message handling at scale.** Traced from source: 3 webhook entry points, ack-first `after()` concurrency model (parallelism comes from serverless fan-out, not our code), per-number tenancy routing for multi-number/multi-bot setups, idempotency via `channel_events` + race-free `claim_ai_reply_slot`, the full agent gate ladder (flows-win → supervisor router → schedule → caps → warm handoff), and 6 ranked scale risks (RISK-1 in-memory rate limiter defeated by fan-out; RISK-2 sequential broadcast fan-out in-request). Read before any scaling or messaging-throughput work. |
| `report-feature-inventory.md` | **In-depth measured feature inventory (every module).** 26 modules with tsx/ts/test/LOC counts and what each actually does; the two surfaces missing from all other docs (**24-route `/api/v1` public API + mobile BFF**, and the **MCP server** re-exposing the same 21 agent tools with scope gating); exact automation capability (**17 flow node types, 9 triggers**); the 21 AI tools incl. the high-risk `create_workflow`/`activate_workflow` write path; uneven test coverage map (settings = 12k LOC / 0 tests); thin-integration modules; and confirmed-absent features (money layer, portal, quotas, calendar sync). |
| `../TODO.md` | **Master sorted backlog** (`.agents/TODO.md`) — phased plan (P0 stabilize → Clienter-parity core: invoices→projects→portal → AI differentiators → GTM → email block builder last). Every item is gated by the validation framework in `research-2026-07.md`. |
| `../IMPLEMENTATION-PLAN.md` | **THE single execution document** (`.agents/IMPLEMENTATION-PLAN.md`) — consolidates every doc above into 8 sequenced phases with per-phase exit criteria: P0 stabilize/billable (quotas, Redis limiter, Sentry, flags, smoke tests) → P1 certified foundation+invoices → P2 projects → P3 portal+reviews → P4 messaging scale (outbox broadcasts) → P5 calendar → P6 AI differentiators → P7 email builder (last) → P8 GTM parallel. Start here when deciding what to build next. |

Also mandatory reading:
- `.agents/skills/` — installed skill library (security-review, emil-design-eng, etc.). Team memory says: check for a relevant skill before ANY feature work.
- `v0_memories/team/crm-strategy.md` — product strategy (EspoCRM analysis, "AI-agent-first messaging CRM" positioning).

Product motto: **make user work simple.**

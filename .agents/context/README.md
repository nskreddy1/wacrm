# wacrm — Agent Context Pack

Read this folder before doing any feature work. It is the handoff from
previous build sessions. Keep it updated when you change architecture,
routes, schema, or security posture.

## Reading order

**New to the project?** `hld.md` → `database.md` → `lld.md`.
**About to write code?** `lld.md` + `security.md`.
**Need an exact column or index?** `database-schema.md`.

| File | What it covers |
| --- | --- |
| `hld.md` | **High-level design.** What the product is, the one architecture diagram, tenancy model, all 16 domains, the 3 critical data flows, tech-stack rationale, architectural weaknesses, and where to make a change |
| `lld.md` | **Low-level design.** Layer rules, real method signatures (`getCurrentAccount`, `requireSuperAdmin`, `ChannelAdapter`, rate limit, audit, v1 helpers), the canonical route-handler order, full 102-route inventory, frontend + migration + test conventions |
| `database-schema.md` | **Full DB reference.** All 77 tables with exact column types, nullability, defaults, FKs with ON DELETE, every index's `CREATE INDEX`, check constraints, and all RLS policy expressions |
| `database.md` | Conceptual data model: schema domains, key tables, RLS model, migration conventions |
| `system-design.md` | Tech stack, project structure, feature map, system design |
| `api-routes.md` | Every API namespace, its auth gate, and conventions |
| `security.md` | Security architecture, review checklist, known patterns |
| `roadmap.md` | Ranked problems, pre-production checklist, competitive feature gaps |
| `features-100.md` | **100-feature build catalog** (Jul 2026 research): enterprise gates, omnichannel, agentic AI, sales, verticals (real estate, healthcare, education, automotive, retail), analytics, platform — each scored P0–P2, plus the vertical-template strategy |
| `problems-100.md` | **100-problem audit** of the current app: bugs, security, enterprise gaps, architecture, data model, testing, observability, UX — each scored S1–S4 with a fix-order summary for the ship-blockers |
| `go-to-market.md` | **Client acquisition + pricing strategy** (Jul 2026 research): selling without a registered company (MoR, GST rules, when to incorporate), subscription tiers vs Wati/Interakt, phase-by-phase plan 0→10→100→1k→10k clients, KPIs per phase, build-before-selling gate order |

Also mandatory reading:
- `.agents/skills/` — installed skill library (security-review, emil-design-eng, etc.). Team memory says: check for a relevant skill before ANY feature work.
- `v0_memories/team/crm-strategy.md` — product strategy (EspoCRM analysis, "AI-agent-first messaging CRM" positioning).

Product motto: **make user work simple.**

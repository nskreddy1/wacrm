# Documentation

## Where to look first

Two doc sets, with different jobs. Reaching for the wrong one is the most
common way to end up working from stale information.

| You want… | Read |
| --- | --- |
| **The system as it is actually built** | [`.agents/context/`](../.agents/context/README.md) |
| The V1 target contract and the reasoning behind it | [enterprise-v1-architecture.md](./enterprise-v1-architecture.md) |
| To operate or deploy it | [production-setup.md](./production-setup.md), [production-readiness.md](./production-readiness.md) |
| To call it from outside | [public-api.md](./public-api.md) |
| Why a design decision was made | [`adr/`](./adr/) |

`.agents/context/` wins on questions of current fact — it carries a verified
counts table and a **generated** schema reference. `enterprise-v1-architecture.md`
is a dated audit plus target state: sections 2–4 have been re-verified, but
later sections describe intent, not necessarily today's code.

## Current shape

Verified against the running system. Re-derive rather than trust these if
they look old; `.agents/context/README.md` documents the commands.

| Fact | Value |
| --- | --- |
| Processes | 1 (Next.js 16.2.12) — no Express API, no `/api/service` |
| Feature modules | 27 under `src/features/` |
| Route handlers | 115 across 19 namespaces |
| Public API routes | 25 under `/api/v1` (stability contract) |
| Migrations | 131 |
| Tables in `public` | 88, RLS enabled on all 88 |
| Tests | 913 across 99 files |
| Full gate | `pnpm check` |

## Agent context pack (`.agents/context/`)

- `README.md` — start here; verified counts and reading order
- `hld.md` / `lld.md` — high- and low-level design as built
- `system-design.md` — topology, request flows, failure behaviour
- `vertical-architecture.md` — feature-module structure and import boundaries
- `security.md` — tenancy, RLS and secret-handling rules
- `api-routes.md` — every route handler with its auth gate
- `database.md` — how to work with the DB (RLS helpers, migration workflow)
- `database-schema.md` — **generated**; rebuild with `pnpm db:doc`, never hand-edit

## Living docs

- [Enterprise v1 Architecture](./enterprise-v1-architecture.md) — target architecture and audit
- [Production Setup](./production-setup.md) — deployment and environment configuration
- [Production Readiness](./production-readiness.md) — go-live checklist
- [Public API](./public-api.md) — external API reference
- [MCP](./mcp.md) — MCP server documentation
- [Twilio Setup](./twilio-setup.md) — Twilio channel configuration
- [AI Auto-Reply](./ai-auto-reply.md) — AI auto-reply feature documentation
- [Onboarding Verification](./onboarding-verification.md) — onboarding flow checks

## Decision records

- [ADR-001](./adr/001-workspace-modules.md) — workspace modules
- [ADR-002](./adr/002-affective-layer.md) — affective layer
- [ADR-003](./adr/003-record-ux-catalog-and-normalization.md) — record UX, catalog and normalization
- [ADR-004](./adr/004-workspace-membership-and-invite-delivery.md) — workspace membership and invite delivery

## Archive

Historical planning artifacts, audits, and AI-session documents live in
[`archive/`](./archive/). They are kept for reference only and are not
maintained — in particular, anything there describing a separate Express API
on port 4000 predates its removal.

# Architecture delta: this fork vs. upstream wacrm docs

> Current branch: `architecture-report`; package version: `0.8.0`
> Last code audit: 2026-07-13
> Authority: applied schema → repository migrations → source → local docs → `docs/upstream-wacrm/*`

## Current inventory

The audit found 530 tracked files: 409 under `src`, 40 SQL migrations, 20 local/upstream documentation files, 16 MCP files, 7 Express files and supporting root/CI/assets. Generated directories (`node_modules`, `.next`, `.git`, caches and build output) are excluded. The build exposes 29 page files and 60 route-handler files.

## 1. Dedicated backend topology

Upstream snapshots describe Next.js routes talking directly to Supabase. This fork adds an internal Express 5 business API:

| Process | Location | Default | Role |
| --- | --- | --- | --- |
| Web/BFF | `src/`, Next.js 16 | `WEB_PORT=3000` | UI, route handlers, webhooks, OAuth, public API and authenticated BFF |
| Business API | `server/`, Express 5 | `API_HOST=127.0.0.1`, `API_PORT=4000` | Health probes, middleware and extracted domain APIs |

`pnpm dev` and `pnpm start` supervise both. `scripts/run-web.mjs` validates `WEB_PORT`. `/api/service/*` uses `EXPRESS_API_URL` when set and otherwise derives its target from `API_HOST`/`API_PORT`. Express adds Helmet, structured/redacted Pino logging, request IDs, body limits, liveness/readiness and independent Supabase bearer authentication.

## 2. Next 16 proxy and routing

- Session/auth handling uses `src/proxy.ts`, not legacy `middleware.ts`.
- Protected unauthenticated traffic redirects to clean `/login` without a return-path query.
- Canonical pages use `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/flows`, `/agents`, `/bookings`, `/notifications` and `/settings`.
- Legacy `/bigin/org/[accountId]/...` and `/org/[accountId]/...` pages still coexist. They are compatibility debt, not the V1 target.
- `src/lib/routing/routes.ts` and `src/lib/routes/dashboard-routes.ts` still encode competing conventions.

## 3. Database history

Upstream setup material begins with migrations `001`–`009` and snapshots discuss work through `030`. This fork contains `001`–`040`:

- `031`–`037`: AI grants/fixes, profile RLS, interactive messages, dedupe and pipeline workspace.
- `038`: omnichannel connections/identities, OAuth state, webhook receipts, channel-aware messages/conversations and notification delivery/preferences.
- `039`: conversation uniqueness correction.
- `040`: SMTP and Microsoft 365 provider constraint expansion.

The connected Supabase environment returned no public baseline tables at the last inspection. The migrations therefore remain repository intent until `001`–`040` are applied in order and RLS/persistence are verified live.

## 4. Provider state

The authoritative provider list is Meta WhatsApp, Twilio WhatsApp, Gmail, Microsoft 365, Resend and SMTP. Capability contracts, schema, registry and a shared Settings surface exist, but support is intentionally uneven:

- Meta WhatsApp: mature legacy transport and webhook lifecycle; neutral backfill still needs live migration validation.
- SMTP: encrypted settings and Nodemailer health/send adapter implemented; live DB/provider verification pending.
- Twilio: setup/contracts and webhook boundary are partial; end-to-end transport is incomplete.
- Resend: setup/contracts are staged; complete inbound/outbound lifecycle is not proven.
- Gmail and Microsoft 365: schema/contracts only; OAuth, sync and transport are target work and UI marks them unavailable.

No provider silently falls back to another.

## 5. Additional fork features

- MCP server (`mcp-server/`, `docs/mcp.md`) consuming scoped public APIs.
- Visual Flows with templates, runs and cron drain.
- Agents, Bookings, Notifications, presence and quick replies.
- AI playground, usage, OpenAI/Anthropic abstraction, knowledge retrieval and handoff tests.
- Public REST API, hashed/scoped keys and signed outbound webhooks.
- Express process and same-origin BFF.
- Vitest suite with broad colocated coverage.
- English message catalog and expanded responsive UI.

## 6. Important architectural exceptions

- Pipeline workspace code includes SQLite/demo repository paths; Supabase remains the production authority.
- Demo APIs and in-memory cache/rate paths are not durable multi-instance storage.
- Two lockfiles remain even though active development uses pnpm.
- Repository-wide historical lint debt remains.
- Next 16 permits alternate HTTP ports, but two dev servers from the same checkout contend for the same `.next/dev` lock; stop the original process or use a separate worktree/build for concurrent verification.

## 7. What still matches upstream

Supabase remains the only production database/auth platform. Tenant data is account-scoped, roles remain owner/admin/agent/viewer, Meta uses encrypted credentials and HMAC verification, Flows precede Automations and AI auto-reply, and the public API remains additive with signed webhooks.

## 8. Target and authority

`docs/enterprise-v1-architecture.md` is the consolidated current-state report and Enterprise V1 contract. It separates implemented behavior from target behavior, contains the source/file-group catalog, provider matrix, migration chronology, validation record, risk register and implementation sequence. Upstream snapshots are historical comparison material and are not edited to describe this fork.

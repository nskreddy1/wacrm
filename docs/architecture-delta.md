# Architecture delta: this fork vs. upstream wacrm docs

> Compares this repository (branch `url-and-naming-conventions`, package version 0.8.0) against the upstream documentation snapshots in `docs/upstream-wacrm/`.
> Last verified against code: 2026-07-13.
> Authority order: live schema/migrations → source code → this document → upstream snapshots.

## 1. Backend topology — the biggest divergence

Upstream docs say: "No ORM, no GraphQL layer, no dedicated backend. The Next server-side routes read and write Supabase directly."

This fork runs **two processes**:

| Process | Location | Role |
| --- | --- | --- |
| Web/BFF | Next.js 16 (`src/`) | UI, App Router API routes, webhook receivers, public `/api/v1` |
| Business API | Express 5 (`server/`) | Internal domain API behind the BFF |

- `npm run dev` / `npm start` use `concurrently` to launch both (`dev:web` + `dev:api`); the Express API listens on port 4000 by default (`server/config.ts`).
- Browsers only ever call same-origin `/api/service/*`; `src/app/api/service/[...path]/route.ts` forwards authenticated requests to Express.
- `server/app.ts` adds enterprise middleware upstream does not have: `helmet`, `pino-http` structured logging with `x-request-id` propagation and redaction of auth/cookie headers, JSON body limit, `GET /health/live` and `GET /health/ready` probes, and a `/v1/account` domain router behind Supabase-token authentication (`server/http/auth.ts`).

## 2. Middleware and auth redirects

- Upstream has `src/middleware.ts` (session refresh only). This fork uses the Next.js 16 convention `src/proxy.ts`.
- The proxy enforces the clean-URL auth contract: unauthenticated requests to protected paths are redirected to exactly `/login` with the query string **stripped** (`target.search = ""`) — there is no `?next=` / `returnTo` parameter by design.
- Authenticated users landing on `/` or an auth route are redirected to `/dashboard`, or to `/join/<token>` when an `?invite=` parameter is present (invitation flow is the only destination-preserving exception).
- Public prefixes: `/auth/`, `/join/`, `/api/service/`, `/api/webhooks/`, `/api/v1/`.

## 3. Routing conventions (in transition)

Route building is currently split across two modules with different conventions — consolidation to simple canonical URLs is in progress:

| Module | Convention | Status |
| --- | --- | --- |
| `src/lib/routing/routes.ts` | Canonical constants (`/login`, `/dashboard`, `/join/:token`) plus `/accounts/:accountId/...` builders | Canonical for auth/app entry; the `/accounts/...` builders are slated for replacement by simple paths |
| `src/lib/routes/dashboard-routes.ts` | Legacy generators emitting `/bigin/org/:accountId/home/...` and `/org/:accountId/...` URLs | Legacy — to become compatibility redirects only |

Actual page directories include **both** simple and account-prefixed variants:

- Simple: `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/flows`, `/agents`, `/bookings`, `/notifications`, `/settings`
- Legacy: `/org/[accountId]/pipelines/...`, `/bigin/org/[accountId]/home/contacts/...`, `/bigin/org/[accountId]/home/deals/...`

Target state (enterprise V1): simple feature URLs only; the current account is resolved from the server-side membership context, never from the URL. Legacy paths become validated redirects.

## 4. Database migrations — fork is ahead of the docs

Upstream setup docs list migrations `001`–`009`; the upstream changelog references up to `030`. This fork's `supabase/migrations/` contains `001`–`037`. Fork-only (beyond documented upstream):

| Migration | Adds |
| --- | --- |
| `031_ai_reply_slot_grant.sql` | AI reply slot grants |
| `032_fix_ai_knowledge_membership.sql` | Knowledge-base membership fix |
| `033_ai_reply_polish.sql` | AI reply refinements |
| `034_fix_profiles_update_rls.sql` | Profiles RLS fix |
| `035_interactive_messages.sql` | Interactive (button/list) messages |
| `036_conversation_contact_dedup.sql` | Conversation/contact deduplication |
| `037_pipeline_workspace.sql` | Pipeline workspace model |

Always check the directory itself; never trust a doc-listed migration count.

## 5. Features present in this fork but absent from upstream docs

- **MCP server** (`mcp-server/`, `docs/mcp.md`) — drive the CRM from AI assistants over the Model Context Protocol; read-only by default with opt-in writes.
- **Flows** (`/flows`, `src/app/api/flows/*`, migrations `010`, `012`, `016`) — visual button-driven conversation builder with runs, cron drain, and templates. Upstream docs mention Flows in passing but have no dedicated page in the snapshot set.
- **Agents page** (`/agents`), **Bookings** (`/bookings`), **Notifications** (`/notifications`, migration `027`), **member presence** (migration `024`), **quick replies** (`src/app/api/quick-replies/*`).
- **AI extras**: playground (`/api/ai/playground`), usage metering (`/api/ai/usage`, `src/lib/ai/usage.ts`), provider abstraction (`src/lib/ai/providers/{openai,anthropic}.ts`), structured handoff logic (`src/lib/ai/handoff.ts`) with unit tests.
- **Internationalization**: `messages/en.json` message catalog.
- **Vitest test suite** (`vitest.config.ts`, `*.test.ts` colocated with sources) — upstream docs do not describe a test setup.

## 6. Local docs vs. web docs

- `docs/public-api.md` (local) is the **authoritative** public API reference for this fork — it is richer than the upstream web page. The snapshot `docs/upstream-wacrm/public-api.md` is kept for comparison only.
- `docs/mcp.md` documents the MCP server (no upstream equivalent).
- `docs/upstream-wacrm/` holds the attributed snapshots of all 14 requested wacrm.tech pages.

## 7. What still matches upstream

- Supabase as the only data/auth provider (Postgres, Auth, Storage, Realtime, RLS on every table; account-scoped tenancy via migrations `017`–`020`).
- Meta Cloud API WhatsApp integration with HMAC-verified webhooks, AES-256-GCM token encryption, template lifecycle management, broadcasts with incremental delivery counters.
- Roles: owner / admin / agent / viewer with DB-enforced (RLS + RPC) permission checks.
- Deterministic precedence: Flows → Automations → AI auto-reply.
- Public REST API under `/api/v1` with scoped hashed keys and signed outbound webhooks.
- Cron drain contract at `/api/automations/cron` protected by `AUTOMATION_CRON_SECRET`.

## 8. Enterprise V1 direction (this fork's target)

See `docs/enterprise-v1-architecture.md` for the target-state architecture: one company / many role-based users, stable simple URLs, provider-neutral omnichannel layer (WhatsApp + Microsoft 365 + Gmail), hybrid AI decisioning, durable idempotent job processing, and full observability. V2 (multi-company membership + account switcher) is explicitly out of V1 scope.

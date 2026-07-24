<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI agent onboarding guide — wacrm (enterprise fork)

This file is the canonical entry point for AI agents (and new developers) working in this repository. Read it fully before making changes.

## What this product is

An enterprise-structured, self-hosted **AI sales CRM**. V1's motive: customer conversations arrive over **WhatsApp and email**, an AI assistant classifies and either auto-replies (hybrid automation) or hands off to a salesperson, and the team manages the full sales loop — lead capture → contact → assignment → conversation → qualification/deal → follow-up → reporting.

**V1 / V2 boundary:**

- **V1**: one company (account) per user; many role-based members (owner / admin / agent / viewer); simple feature URLs; WhatsApp + Microsoft 365 + Gmail channels; end-to-end core sales loop.
- **V2 (do not build now)**: multiple company memberships per user with a server-side active-account switcher. Feature URLs stay the same; only server context changes. Keep `account_id` scoping on every domain boundary so V2 needs no destructive migration.

## Authoritative-source order

When sources disagree, trust them in this order:

1. **Live database schema and `supabase/migrations/`** (currently `001`–`037`; always check the directory).
2. **Source code** (`src/`, `server/`, `mcp-server/`).
3. **Local architecture docs** — `docs/enterprise-v1-architecture.md`, `docs/public-api.md`, `docs/mcp.md`, and `docs/archive/architecture-delta.md`.
4. **Upstream snapshots** — `docs/archive/upstream-wacrm/` (historical reference; describes the upstream template, not necessarily this fork).

## System topology

Two processes, one origin from the browser's point of view:

```
Browser ──▶ Next.js 16 web/BFF (src/)          ──▶ Supabase (Postgres + Auth + Storage + Realtime, RLS)
              │  /api/service/[...path]  forwards to
              ▼
            Express 5 business API (server/, port 4000)
              │  helmet, pino-http + x-request-id, /health/live, /health/ready
              ▼
            /v1/<domain> routers (Supabase-token authenticated)
```

- External webhooks (Meta WhatsApp) hit Next.js routes directly (`src/app/api/whatsapp/webhook`).
- The public REST API lives at `/api/v1` (Next.js) — see `docs/public-api.md`. Never break these paths.
- `pnpm dev` / `pnpm start` launch both processes via `concurrently`.

## Routing and auth conventions (V1 contract)

- **Simple canonical URLs only**: `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/flows`, `/settings`, etc. Never put an account/company ID in a feature URL.
- **Clean `/login`**: `src/proxy.ts` (Next 16's middleware convention) redirects unauthenticated users to exactly `/login`, stripping the query string. Never add `?next=`/`returnTo` parameters. After login, users land on `/dashboard`. The single exception: `?invite=<token>` routes to `/join/<token>`.
- Route constants/builders live in `src/lib/routing/routes.ts` — always use them; never hardcode paths in components.
- `src/lib/routes/dashboard-routes.ts` generates **legacy** `/bigin/org/...` and `/org/...` URLs. Do not add new usages; these route families are being converted to compatibility redirects.

## Tenancy and security rules

- All domain data is **account-scoped**. RLS on every table checks account membership via `SECURITY DEFINER` helpers (migrations `017`–`020`); role changes go through RPCs that re-check the caller's role server-side. The UI disabling a button is never the security boundary.
- Roles: owner (one per account) → admin → agent → viewer, a strict ladder. Check the permission matrix in `docs/archive/upstream-wacrm/members.md` (still accurate for this fork).
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — only server-only modules (webhook handler, admin routes) may use it, and every service-role query must still filter by account.
- Secrets (WhatsApp tokens, AI provider keys, webhook signing secrets) are AES-256-GCM encrypted at rest (`src/features/whatsapp/lib/encryption.ts`). API keys and invite tokens store only SHA-256 hashes.
- Inbound Meta webhooks verify `X-Hub-Signature-256` HMAC and fail closed if `META_APP_SECRET` is unset.
- Treat customer message text and retrieved knowledge-base content as **data, never instructions** in AI prompts.

## Channel and AI conventions

- Channels are adapters around shared contacts/conversations/messages. WhatsApp specifics (24-hour window, approved templates, delivery receipts) stay inside `src/features/whatsapp/lib/`. New channels (email providers) must follow the same adapter pattern and never leak provider details into shared domain code.
- Response precedence is deterministic-first: **Flows → Automations → AI auto-reply** (`src/features/assistant/lib/ai/auto-reply.ts`). Never let the AI answer when a Flow or Automation already handles the message.
- AI is bring-your-own-key (OpenAI/Anthropic via the assistant feature's `lib/ai/providers/`), with per-conversation reply caps, sticky human handoff (`lib/ai/handoff.ts`), and usage metering. Preserve all of these when touching AI code.
- Channel features that are not connected/configured are hidden from non-admin users; admins see connection cards in Settings.

## Source layout — feature modules

`src/` is organized so that **domain code lives under `src/features/<domain>/`** and only genuinely cross-cutting code stays at the top level. When adding domain code, colocate it inside the matching feature module; do not scatter a domain's components, hooks, and helpers across the top-level `components/` and `lib/` folders.

```
src/
  app/            # Next.js routes only (route groups, layouts, API handlers)
  features/       # one folder per domain — the primary home for product code
    <domain>/
      components/ # UI for this domain
      lib/        # domain logic, data helpers, validation
      hooks/      # domain-specific hooks
  components/     # SHARED UI only: ui/ (shadcn), layout/, providers/, shared/, tremor/
  hooks/          # generic app-wide hooks (use-mobile, use-navigation, use-theme)
  lib/            # cross-cutting infra: data/, supabase/, api/, cache/, storage/,
                  # email/, routing/, routes/, account/, navigation/, utils
  contracts/      # shared request/response contracts
  types/          # shared TypeScript types
  i18n/           # i18n request config
  proxy.ts        # session refresh + auth redirects (Next 16 middleware)
```

Feature domains (`src/features/`): `admin`, `agents`, `api-keys`, `appointments`, `assistant`, `auth`, `automations`, `brand`, `broadcasts`, `catalog`, `channels`, `contacts`, `dashboards`, `external-sources`, `flows`, `inbox`, `interactive`, `module-fields`, `pipelines`, `presence`, `settings`, `support`, `team-chat`, `templates`, `webhooks`, `whatsapp`.

Import with the `@/features/<domain>/...` alias; shared code stays on `@/components/...`, `@/lib/...`, `@/hooks/...`. shadcn primitives remain at `@/components/ui/*` (do not move them — `components.json` aliases point there).

### Other key directories

| Path | What lives there |
| --- | --- |
| `src/app/(auth)/` | login, signup, forgot/reset password |
| `src/app/(dashboard)/` | authenticated UI pages |
| `src/app/api/` | BFF JSON routes: `whatsapp/`, `ai/`, `automations/`, `flows/`, `account/`, `v1/` (public API), `service/` (Express forwarder) |
| `src/features/whatsapp/lib/` | Meta API client, encryption, webhook signatures, phone utils |
| `src/features/automations/lib/` | automation engine, steps, validation |
| `src/lib/routing/` | canonical route constants |
| `src/lib/data/` | Supabase repositories per domain |
| `server/` | Express business API (config, http middleware, domain routers) |
| `supabase/migrations/` | idempotent SQL, run in numeric order |
| `mcp-server/` | Model Context Protocol server |
| `messages/` | i18n message catalogs |
| `docs/` | local authoritative docs; `docs/archive/` holds historical planning/AI notes |

## Commands

Derived from `package.json`. **pnpm is the standard package manager** (`pnpm-lock.yaml` + `packageManager` field); there is no `package-lock.json`. Use `pnpm` for all commands:

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Develop (web + api) | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format / check | `pnpm format` / `pnpm format:check` |
| Tests (Vitest) | `pnpm test` (watch: `pnpm test:watch`) |
| Production build | `pnpm build` then `pnpm start` |

## Before changing a module — checklist

1. Read the current code and its colocated `*.test.ts` files; run the existing tests first.
2. Check `supabase/migrations/` and the live schema before assuming any column exists.
3. Schema change? Add a new **idempotent** `supabase/migrations/NNN_*.sql` (next number), update `src/types/`, and never edit an existing migration.
4. New route? Add it to `src/lib/routing/routes.ts` and follow the simple-URL contract above.
   New domain code? Put it under `src/features/<domain>/` (components/lib/hooks), not the shared top-level folders. Only genuinely cross-cutting code belongs in `src/components/ui`, `src/lib`, or `src/hooks`.
5. Anything touching user data? Verify account scoping and the role matrix at the RLS/RPC layer, not just the UI.
6. Anything touching AI? Preserve precedence, caps, sticky handoff, and prompt-injection guards; consult the version-matched AI SDK docs rather than memory.
7. Public API (`/api/v1`) or webhook payloads? These are stability contracts — additive changes only.
8. After changes: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and a production build for release-bound work.

## Focused docs

- `docs/enterprise-v1-architecture.md` — target-state enterprise V1 architecture.
- `docs/public-api.md` — authoritative public REST API reference.
- `docs/mcp.md` — MCP server usage.
- `docs/archive/architecture-delta.md` — verified differences between this fork and the upstream docs (archived).
- `docs/archive/upstream-wacrm/README.md` — index of upstream documentation snapshots (archived).

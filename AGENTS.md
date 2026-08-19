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

1. **Live database schema and `supabase/migrations/`** (currently **131** migrations: `001_…`–`037_…` numbered, everything after that timestamp-prefixed `2026…`; always check the directory rather than trusting this count).
2. **Source code** (`src/`, `mcp-server/`).
3. **`.agents/context/`** — the agent context pack, and the most detailed description of the system as built. Start at `.agents/context/README.md`. `database-schema.md` there is generated from the live database (`pnpm db:doc`), so it is the fastest way to get an exact column, index, RLS policy, or trigger.
4. **Local architecture docs** — `docs/enterprise-v1-architecture.md`, `docs/public-api.md`, `docs/mcp.md`, and `docs/archive/architecture-delta.md`.
5. **Upstream snapshots** — `docs/archive/upstream-wacrm/` (historical reference; describes the upstream template, not necessarily this fork).

## System topology

**One process.** A single Next.js 16 app talks straight to Supabase:

```
Browser ──▶ Next.js 16 app + API routes (src/)  ──▶ Supabase (Postgres + Auth + Storage + Realtime, RLS)
              │                                      RLS enabled on all 88 public tables
              ├─ src/proxy.ts          session refresh + auth redirects
              ├─ src/app/api/**        115 route handlers, 19 namespaces
              └─ src/app/api/v1/**     25 public REST routes (stability contract)
```

- An earlier design split a separate **Express 5 business API** into `server/` on port 4000, fronted by an `/api/service/[...path]` forwarder. **Both are gone** — there is no `server/` directory, no `/api/service` route, and no `concurrently`. Ignore any doc that still describes them; `pnpm dev` starts exactly one process (`scripts/run-web.mjs`).
- External webhooks (Meta WhatsApp) hit Next.js routes directly (`src/app/api/whatsapp/webhook`).
- The public REST API lives at `/api/v1` (Next.js) — see `docs/public-api.md`. Never break these paths.
- `mcp-server/` is a separate Model Context Protocol server (also surfaced in-app at `/api/mcp`), not a second web backend.

## Routing and auth conventions (V1 contract)

- **Simple canonical URLs only**: `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/flows`, `/settings`, etc. Never put an account/company ID in a feature URL.
- **Clean `/login`**: `src/proxy.ts` (Next 16's middleware convention) redirects unauthenticated users to exactly `/login`, stripping the query string. Never add `?next=`/`returnTo` parameters. After login, users land on `/dashboard`. The single exception: `?invite=<token>` routes to `/join/<token>`.
- Route constants/builders live in `src/lib/routing/routes.ts` — always use them; never hardcode paths in components.
- `src/lib/routes/dashboard-routes.ts` generates **legacy** `/bigin/org/...` and `/org/...` URLs. Do not add new usages; these route families are being converted to compatibility redirects.

## Tenancy and security rules

- All domain data is **account-scoped**. RLS is enabled on **all 88 tables** in `public`, checking account membership via `SECURITY DEFINER` helpers (`is_account_member(account_id, roles[])` is the canonical one); role changes go through RPCs that re-check the caller's role server-side. The UI disabling a button is never the security boundary.
- `CREATE OR REPLACE FUNCTION` does **not** inherit `SECURITY DEFINER` — omit it and Postgres silently downgrades the function to INVOKER, which fails later at runtime for real users only on the paths that needed elevation. `scripts/push-supabase-schema.mjs` enforces this inside each migration's transaction; read the invariants comment there before touching a privileged function.
- Roles: owner (one per account) → admin → agent → viewer, a strict ladder. Check the permission matrix in `docs/archive/upstream-wacrm/members.md` (still accurate for this fork).
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — only server-only modules (webhook handler, admin routes) may use it, and every service-role query must still filter by account.
- Secrets (WhatsApp tokens, AI provider keys, webhook signing secrets) are AES-256-GCM encrypted at rest (`src/lib/crypto/secrets.ts` — shared infra, not a feature, since email/AI/webhook secrets all use it). API keys and invite tokens store only SHA-256 hashes.
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
  components/     # SHARED UI only: ui/ (shadcn), layout/, providers/, shared/,
                  # tremor/ (charts), prompt-kit/ (AI chat primitives)
  hooks/          # generic app-wide hooks (use-mobile, use-navigation, use-theme)
  lib/            # cross-cutting infra: data/, supabase/, api/, cache/, storage/,
                  # email/, routing/, routes/, account/, navigation/, utils
  contracts/      # shared request/response contracts (api.ts)
  types/          # shared TypeScript types
  i18n/           # i18n request config
  proxy.ts        # session refresh + auth redirects (Next 16 middleware)
```

Feature domains (`src/features/`, 27): `admin`, `agents`, `alerts`, `api-keys`, `appointments`, `assistant`, `auth`, `brand`, `broadcasts`, `catalog`, `channels`, `contacts`, `dashboards`, `external-sources`, `flows`, `inbox`, `interactive`, `module-fields`, `onboarding`, `pipelines`, `presence`, `settings`, `support`, `team-chat`, `templates`, `webhooks`, `whatsapp`.

There is no `automations` feature module: the automation engine was folded into `flows` (`src/features/flows/`), which is the unified workflow engine. Treat "automation" in older docs as meaning Flows.

Import with the `@/features/<domain>/...` alias; shared code stays on `@/components/...`, `@/lib/...`, `@/hooks/...`. shadcn primitives remain at `@/components/ui/*` (do not move them — `components.json` aliases point there).

### Other key directories

| Path                            | What lives there                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(auth)/`               | login, signup, forgot/reset password                                                                                          |
| `src/app/(dashboard)/`          | authenticated UI pages                                                                                                        |
| `src/app/api/`                  | JSON routes, 19 namespaces: `account/`, `admin/`, `ai/`, `alerts/`, `assistant/`, `channels/`, `dashboards/`, `email/`, `external-sources/`, `flows/`, `invitations/`, `mcp/`, `quick-replies/`, `settings/`, `sms/`, `support/`, `templates/`, `whatsapp/`, `v1/` (public API) |
| `src/features/whatsapp/lib/`    | Meta API client, webhook signatures, phone utils                                                                              |
| `src/lib/crypto/`               | `secrets.ts` — AES-256-GCM encrypt/decrypt for all stored third-party credentials                                             |
| `src/features/flows/`           | the unified workflow/automation engine (nodes, triggers, runs)                                                                |
| `src/lib/routing/`              | canonical route constants                                                                                                     |
| `src/lib/data/`                 | Supabase repositories per domain                                                                                              |
| `supabase/migrations/`          | idempotent SQL, applied in filename order (`pnpm db:push`)                                                                    |
| `scripts/`                      | `push-supabase-schema.mjs` (apply migrations), `generate-schema-doc.mjs` (`pnpm db:doc`), `check-boundaries.mjs`, `run-web.mjs` |
| `mcp-server/`                   | Model Context Protocol server                                                                                                 |
| `messages/`                     | i18n message catalogs                                                                                                         |
| `.agents/context/`              | agent context pack — HLD/LLD, generated DB reference, security, roadmap                                                       |
| `docs/`                         | local authoritative docs; `docs/archive/` holds historical planning/AI notes                                                  |

## Commands

Derived from `package.json`. **pnpm is the standard package manager** (`pnpm-lock.yaml` + `packageManager` field); there is no `package-lock.json`. Use `pnpm` for all commands:

| Task                     | Command                                                     |
| ------------------------ | ----------------------------------------------------------- |
| Install                  | `pnpm install`                                              |
| Develop (single process) | `pnpm dev`                                                  |
| **Full gate**            | **`pnpm check`** — typecheck + lint + boundaries + docs + test |
| Typecheck                | `pnpm typecheck`                                            |
| Lint                     | `pnpm lint`                                                 |
| Import boundaries        | `pnpm check:boundaries`                                     |
| Docs mirror in sync      | `pnpm check:docs`                                           |
| Republish docs mirror    | `pnpm docs:sync`                                            |
| Format / check           | `pnpm format` / `pnpm format:check`                          |
| Tests (Vitest)           | `pnpm test` (watch: `pnpm test:watch`) — 913 tests, 99 files |
| Apply migrations         | `pnpm db:push`                                              |
| Regenerate schema doc    | `pnpm db:doc`                                               |
| Production build         | `pnpm build` then `pnpm start`                              |

`pnpm check` is the single command to run before calling work done — it is what CI enforces. It includes `check:boundaries`, which fails when a feature module reaches into another feature's internals, and `check:docs`, which fails when the `docs/architecture/` mirror has drifted from `.agents/context/`.

## Before changing a module — checklist

1. Read the current code and its colocated `*.test.ts` files; run the existing tests first.
2. Check `supabase/migrations/` and the live schema before assuming any column exists.
3. Schema change? Add a new **idempotent** migration named `YYYYMMDDHHMMSS_description.sql` (timestamp prefix — the old `NNN_` numbering stopped at `037`), apply it with `pnpm db:push`, refresh `.agents/context/database-schema.md` with `pnpm db:doc`, republish the docs mirror with `pnpm docs:sync`, update `src/types/`, and never edit an existing migration.
4. New route? Add it to `src/lib/routing/routes.ts` and follow the simple-URL contract above.
   New domain code? Put it under `src/features/<domain>/` (components/lib/hooks), not the shared top-level folders. Only genuinely cross-cutting code belongs in `src/components/ui`, `src/lib`, or `src/hooks`.
5. Anything touching user data? Verify account scoping and the role matrix at the RLS/RPC layer, not just the UI.
6. Anything touching AI? Preserve precedence, caps, sticky handoff, and prompt-injection guards; consult the version-matched AI SDK docs rather than memory.
7. Public API (`/api/v1`) or webhook payloads? These are stability contracts — additive changes only.
8. After changes: run **`pnpm check`**, plus a production build for release-bound work.

## Focused docs

Agent context pack (`.agents/context/`) — read `README.md` there first.
**This is the source of truth and is mirrored to `docs/architecture/` for
human readers; edit here, then run `pnpm docs:sync`.**

- `hld.md` / `lld.md` — high- and low-level design of the system as built.
- `system-design.md` — topology, request flows, scaling and failure behaviour.
- `vertical-architecture.md` — feature-module structure and the import-boundary rules `check:boundaries` enforces.
- `security.md` — tenancy, RLS and secret-handling rules.
- `api-routes.md` — every route handler, grouped by namespace, with auth posture.
- `database.md` — how to work with the database (access patterns, RLS helpers, migration workflow).
- `database-schema.md` — **generated** exact reference (`pnpm db:doc`); never hand-edit.

Long-form docs (`docs/`):

- `docs/enterprise-v1-architecture.md` — target-state enterprise V1 architecture.
- `docs/public-api.md` — authoritative public REST API reference.
- `docs/mcp.md` — MCP server usage.
- `docs/adr/` ��� accepted architecture decision records; ADR-004 covers invites and membership.
- `docs/archive/architecture-delta.md` — verified differences between this fork and the upstream docs (archived).
- `docs/archive/upstream-wacrm/README.md` — index of upstream documentation snapshots (archived).

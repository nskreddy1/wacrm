# wacrm current-state architecture and Enterprise V1 target

> Status: authoritative source-controlled architecture audit and target contract
> Audited: 2026-07-13 on branch `architecture-report`, package version `0.8.0`
> Authority: applied Supabase schema → repository migrations → executable source → this report → upstream snapshots

## 1. Executive summary

wacrm is a self-hostable, account-scoped CRM centered on WhatsApp conversations. The current repository is a TypeScript monorepo-style application with a Next.js 16 App Router web/BFF, an internal Express 5 API, Supabase for persistence/auth/storage/realtime, an optional MCP server, and provider adapters under active development.

The source-controlled audit covers 530 tracked files: 409 under `src`, 40 Supabase migrations, 20 root files, 20 docs, 16 MCP files, 10 GitHub automation/governance files, 7 Express files, 7 public assets, and one message catalog. `node_modules`, `.next`, `.git`, caches, generated build output, and private environment files are intentionally excluded.

The most important distinction is between **implemented current state** and **approved V1 target state**. Meta WhatsApp is the mature transport. A provider-neutral schema, contracts, registry, settings API/UI, SMTP adapter, and Meta/Twilio webhook boundaries exist, but full Gmail, Microsoft 365, Resend, and Twilio transport lifecycles are not complete. The connected Supabase environment reported no baseline tables during implementation, so migrations `001`–`040` and their RLS behavior still require ordered application and live verification.

## 2. Runtime and process topology

```text
Browser
  |
  | HTTPS / same-origin
  v
Next.js 16.2.6 / React 19.2.4 (WEB_PORT, default 3000)
  |- App Router pages and layouts
  |- Supabase session refresh in src/proxy.ts
  |- authenticated Next.js route handlers
  |- public REST API /api/v1
  |- OAuth and webhook boundaries
  `- BFF /api/service/*
          |
          | Bearer session + x-request-id
          v
      Express 5.2.1 (API_HOST/API_PORT, default 127.0.0.1:4000)
          |- health/live and health/ready
          `- /v1/account domain API

Both server layers --> Supabase Auth/Postgres/Storage/Realtime
Provider services  --> Meta, SMTP today; broader adapters are staged/partial
External tools     --> mcp-server --> public API
```

`pnpm dev` and `pnpm start` use `concurrently` to supervise web and API processes. `scripts/run-web.mjs` validates `WEB_PORT` and launches the local Next binary. Express validates `API_HOST`, `API_PORT`, and required Supabase public variables through Zod. The BFF uses `EXPRESS_API_URL` when explicitly supplied; otherwise it derives `http://API_HOST:API_PORT` through `src/lib/service-api-url.ts`.

### Request and trust boundaries

1. Browser traffic enters Next.js only; provider secrets and service-role credentials must never enter client bundles.
2. `src/proxy.ts` refreshes Supabase sessions and protects application routes.
3. Most Next API routes authorize directly against Supabase membership/RLS.
4. `/api/service/*` obtains the Supabase session, forwards a bearer token and request ID, filters request/response headers, disables caching, and applies a 30-second timeout.
5. Express independently validates the bearer token and creates an account-aware request context.
6. Public API keys are hashed and scoped; outbound webhooks are signed.
7. Inbound provider webhooks must verify provider signatures before normalization or persistence.

## 3. Source-controlled project structure

```text
.
├── .github/                 CI, ownership, security, issue/PR policy and assets
├── docs/                    local authoritative docs and upstream comparison snapshots
├── mcp-server/              standalone Model Context Protocol client/server package
├── messages/en.json         application message catalog
├── public/                  static icons, manifest and images
├── scripts/run-web.mjs      validated Next web launcher with WEB_PORT
├── server/                  internal Express business API
├── src/
│   ├── app/                 App Router pages, layouts and route handlers
│   ├── components/          domain UI and reusable primitives
│   ├── contexts/            client context providers
│   ├── hooks/               reusable client hooks
│   ├── lib/                 domain services, repositories, adapters and utilities
│   ├── types/               ambient/shared declarations
│   └── proxy.ts             Next 16 session/auth boundary
├── supabase/migrations/     ordered SQL history 001–040
├── package.json             process, validation and dependency contract
├── next.config.ts           Next runtime/security configuration
├── tsconfig.json            strict TS and @/* mapping
├── eslint.config.mjs        lint policy
├── vitest.config.ts         colocated unit test configuration
└── .env.local.example       documented runtime environment contract
```

## 4. File and directory responsibility catalog

This catalog analyzes every meaningful source-controlled area. Closely related files are grouped where they form one unit; migrations are cataloged chronologically to avoid repeating policy boilerplate.

### Root and operational files

| File/group                                                             | Responsibility and architecture impact                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`, `package-lock.json`                  | Runtime/dependency contract. pnpm is canonical in active scripts; retaining two lockfiles risks version drift.                     |
| `scripts/run-web.mjs`                                                  | Cross-platform launcher; validates `WEB_PORT`, invokes the installed Next CLI, forwards termination signals.                       |
| `.env.local.example`                                                   | Public configuration contract. Separates web/API ports, optional explicit BFF target, Supabase, Meta, encryption, cron, AI tuning. |
| `next.config.ts`                                                       | Next behavior, experimental settings, image/security response behavior. Build currently emits an ES-module package-type warning.   |
| `tsconfig.json`, `next-env.d.ts`                                       | Strict TypeScript, bundler resolution, JSX and `@/*` source alias.                                                                 |
| `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.editorconfig` | Static quality and formatting policy. Repository-wide historical lint debt remains.                                                |
| `vitest.config.ts`                                                     | Colocated TypeScript unit tests.                                                                                                   |
| `components.json`, `src/app/globals.css`                               | shadcn/Tailwind v4 component and token foundation.                                                                                 |
| `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `LICENSE`              | Product, release, contribution and legal contracts; some upstream claims are more aspirational than the audited fork state.        |
| `.github/*`                                                            | CI, dependency updates, security policy, templates, CODEOWNERS and deployment artwork.                                             |

### `src/app`: routes and composition

| Area                 | Files/responsibility                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root                 | `layout.tsx`, `page.tsx`, `icon.tsx`, `globals.css` establish metadata, global providers/theme, root redirect and visual system.                                                         |
| Auth                 | `(auth)/login`, `signup`, `forgot-password`, `reset-password`, plus `/auth/callback`; Supabase Auth is the only auth provider.                                                           |
| Dashboard shell      | `(dashboard)/layout.tsx` resolves membership/account context and composes navigation/header.                                                                                             |
| Core pages           | `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/flows`, `/agents`, `/bookings`, `/notifications`, `/settings`.                                       |
| Detail/editor pages  | Broadcast detail/new, automation new/edit/logs, flow editor/runs and invitation join.                                                                                                    |
| Compatibility pages  | `/bigin/org/[accountId]/...` and `/org/[accountId]/pipelines/...`; these preserve older account-prefixed URLs and should become validated redirects after canonical routes are complete. |
| Account APIs         | `/api/account/*` manages account metadata, members, invitations, ownership and API keys with role checks.                                                                                |
| AI APIs              | `/api/ai/*` manages provider config, drafts, auto-reply, knowledge, reindexing, playground, testing and usage.                                                                           |
| Automation/Flow APIs | CRUD, activation, run logs, templates, execution and secret-protected cron drains.                                                                                                       |
| Channel APIs         | `/api/settings/channels` manages provider-neutral connections; `/api/channels/webhooks/{meta,twilio}` are new normalized boundaries.                                                     |
| WhatsApp APIs        | Legacy/mature Meta config, send, media, reactions, templates, broadcasts and webhook lifecycle.                                                                                          |
| Public API           | `/api/v1/*` exposes scoped contacts, conversations, messages, broadcasts, identity and outbound webhook configuration.                                                                   |
| Service BFF          | `/api/service/[...path]` authenticates and proxies to Express without exposing the internal API.                                                                                         |
| Demo APIs            | `/api/demo/*` use demo/repository paths and are not the source of truth for production persistence.                                                                                      |

### `src/components`: UI boundaries

| Group                                                           | Responsibility                                                                                                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/` (25 files)                                                | Accessible shadcn-style primitives: buttons, inputs, dialogs, tables, navigation, feedback and overlays.                                                                                      |
| `settings/` (22)                                                | Profile, account/team, WhatsApp, AI, API keys and channel connection setup; the channel panel exposes real SMTP/Resend/Twilio setup and explicit unavailable states for unfinished providers. |
| `inbox/` (11)                                                   | Conversation list, message timeline, composer, assignments, notes/actions and responsive inbox shell.                                                                                         |
| `pipelines/` (11)                                               | Kanban/workspace, filters, forms, drag/drop and SQLite/demo repository integration points.                                                                                                    |
| `flows/` (9)                                                    | React Flow editor, node palette/configuration, state and run views.                                                                                                                           |
| `dashboard/` (8)                                                | Metrics, charts, activity and date-range presentation.                                                                                                                                        |
| `contacts/` (6)                                                 | List/detail/import/filter/contact interactions.                                                                                                                                               |
| `broadcasts/` (4)                                               | Campaign creation, recipient/template configuration and result presentation.                                                                                                                  |
| `layout/`, `providers/`, `presence/`                            | Global shell/navigation, SWR/theme providers and member presence.                                                                                                                             |
| `agents/`, `automations/`, `bookings/`, `auth/`, `interactive/` | Feature-specific page shells and controls. Some are early-stage UI surfaces relative to persisted domain depth.                                                                               |

### `src/lib`: domain and infrastructure

| Group                                 | Responsibility, persistence and status                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/`                           | Browser/server clients. Server client participates in cookie-backed Auth; service-role use must remain server-only.                                                                     |
| `auth/`, `account/`                   | Membership context, roles, invitation safety, API context and account operations. Tests cover role and invitation logic.                                                                |
| `whatsapp/` (33 files)                | Mature Meta transport: encryption, registration, sending, media, templates, webhook normalization, interactive messages, reactions, contact/conversation resolution and delivery state. |
| `channels/` (11)                      | Provider-neutral types, capability registry, credential envelopes and adapters. Foundation is implemented; provider parity is not.                                                      |
| `ai/` (27)                            | OpenAI/Anthropic BYO-key generation, encrypted configuration, knowledge retrieval/embeddings, draft/auto-reply, usage, handoff and safety rules.                                        |
| `flows/` (14)                         | Graph validation/layout, execution, fallback and deterministic routing.                                                                                                                 |
| `automations/` (9)                    | Trigger/action validation, engine and scheduled continuation. Required precedence is Flows → Automations → AI.                                                                          |
| `api/`, `api-keys/`, `webhooks/`      | Public API auth/pagination/errors, key hashing/scopes and signed retrying outbound delivery.                                                                                            |
| `pipelines/` (10)                     | Pipeline/deal models, validation, workspace operations and SQLite-backed/demo persistence. SQLite is an architectural exception and not a replacement for Supabase production state.    |
| `contacts/`, `inbox/`, `dashboard/`   | Domain projections, filters, date/metric helpers and view models.                                                                                                                       |
| `storage/`, `cache/`, `rate-limit.ts` | Server-side storage/cache/rate controls; in-memory implementations are instance-local and unsuitable for strict multi-instance guarantees.                                              |
| `routing/`, `routes/`                 | Canonical simple routes plus legacy account-prefixed generators; consolidation remains incomplete.                                                                                      |
| `demo/`                               | Seed/demo data and repositories; not production authority.                                                                                                                              |
| `service-api-url.ts`                  | Single tested resolver for Express BFF target and port synchronization.                                                                                                                 |

### Express internal API

| File                               | Responsibility                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `server/index.ts`                  | Loads validated config, binds host/port and performs graceful shutdown.                                   |
| `server/config.ts`                 | Zod validation for API host/port and Supabase public credentials.                                         |
| `server/app.ts`                    | Express composition, Helmet, JSON limits, structured logging/redaction, health probes and domain routers. |
| `server/http/auth.ts`              | Supabase bearer-token authentication.                                                                     |
| `server/http/context.ts`           | Request/account context and request ID propagation.                                                       |
| `server/http/errors.ts`            | Stable HTTP error translation.                                                                            |
| `server/domains/account/routes.ts` | First extracted domain router; most business logic still lives in Next route handlers.                    |

### MCP package

`mcp-server/package.json`, TypeScript config, entrypoint, API client, auth/config, tool definitions, schemas and tests form an independently runnable MCP bridge. It consumes the public REST API rather than bypassing application authorization. Writes are opt-in; public API scope and account checks remain the security boundary. `docs/mcp.md` is its operator contract.

### Documentation

- `docs/enterprise-v1-architecture.md`: this current-state audit and approved target.
- `docs/architecture-delta.md`: concise differences from upstream snapshots.
- `docs/v1-implementation-log.md`: chronological evidence, validation and blockers.
- `docs/public-api.md`, `docs/mcp.md`: local API/tool authority.
- `docs/upstream-wacrm/*`: comparison snapshots only; intentionally not rewritten.

## 5. Route inventory

The build exposes 29 page files and 60 route-handler files. Pages include four auth pages, 19 canonical feature/detail pages, one join route and six legacy account-prefixed variants. API families are account (8), AI (9), automations (5), flows (6), channel/settings (3), quick replies (2), public v1 (12), WhatsApp (10), invitations (2), demo (2), auth callback (1), and service BFF (1).

`src/proxy.ts` is the Next 16 request boundary. Public prefixes include auth callbacks, join/invitation paths, webhooks, public APIs and the service BFF; protected dashboard routes resolve users through Supabase. Canonical URLs do not expose account IDs, while legacy variants still do.

## 6. Data architecture and migration chronology

Supabase is the sole production data/auth platform. Tenant data is keyed by `account_id`; authorization combines Auth users, membership helpers, RLS and explicit account filters in service-role paths. Storage covers private profile/chat/flow assets; Realtime supports inbox/presence updates.

| Migrations  | Capability introduced                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `001`–`005` | Core CRM, pipelines, broadcast identifiers/counting and contact deletion behavior.                                              |
| `006`–`009` | Automations, counters, avatar storage and message actions.                                                                      |
| `010`–`016` | Flows, feature flags, Meta template/registration lifecycle and flow media.                                                      |
| `017`–`020` | Shared accounts, memberships, invitations and follow-up RLS/RPC corrections.                                                    |
| `021`–`025` | Currency, phone dedupe, chat media, presence and tag filtering.                                                                 |
| `026`–`030` | API keys, notifications, outbound webhooks, AI reply and knowledge/pgvector support.                                            |
| `031`–`037` | AI grants/polish, RLS correction, interactive messages, contact/conversation dedupe and pipeline workspace.                     |
| `038`       | Omnichannel connections/identities, OAuth state, webhook receipts, channel-aware records and notification delivery/preferences. |
| `039`       | Omnichannel conversation uniqueness correction.                                                                                 |
| `040`       | SMTP and Microsoft 365 provider enum/constraint expansion.                                                                      |

### Live-schema blocker

At the last integration inspection, the connected Supabase project exposed zero public tables and zero applied RLS policies. Repository code assumes the ordered `001`–`040` baseline. Later migrations must not be applied independently; live persistence, cross-account denial, role matrices and migration idempotency remain unverified until a correct baseline exists.

## 7. Domain architecture

- **Auth/tenancy:** Supabase email/password Auth, account memberships and owner/admin/agent/viewer roles. Account scope must be enforced in every query and provider event.
- **Inbox/messages:** conversations, messages, assignments, notes, presence, media and quick replies. Current UI/data assumptions remain predominantly phone/WhatsApp-oriented.
- **Contacts:** tags, custom fields, CSV workflows, dedupe and phone/email identity foundation.
- **Pipelines/deals:** legacy and new workspace routes coexist; some workspace paths use SQLite/demo repositories and need production persistence convergence.
- **Broadcasts/templates:** mature Meta template and broadcast mechanics; channel-neutral campaign semantics are not yet complete.
- **Automations/Flows:** two engines with deterministic precedence and cron continuation; capability checks are required before email actions.
- **AI/knowledge:** BYO encrypted OpenAI/Anthropic credentials, grounded retrieval, usage limits and handoff. No global model credential is required.
- **Bookings/agents/notifications:** routes and UI exist; notification schema was expanded by migration `038`, but complete delivery-center behavior remains target work.
- **Settings/providers:** generic connection model and settings surface are present; provider lifecycle completeness varies.
- **Public API/webhooks/MCP:** additive REST contract, scoped hashed keys, signed outbound delivery and an MCP consumer.

## 8. Provider implementation matrix

| Provider        | Contract/schema                            | Settings                              | Outbound                       | Inbound/webhook          | OAuth/sync              | Production status                                                         |
| --------------- | ------------------------------------------ | ------------------------------------- | ------------------------------ | ------------------------ | ----------------------- | ------------------------------------------------------------------------- |
| Meta WhatsApp   | Mature legacy + neutral foundation         | Existing WhatsApp + staged Channels   | Implemented                    | HMAC webhook implemented | Registration, not OAuth | Most complete provider; neutral migration/backfill still pending live DB. |
| Twilio WhatsApp | Types/capabilities/credentials present     | Functional credential setup/test path | Partial/not end-to-end proven  | Signed boundary exists   | N/A                     | Incomplete transport lifecycle.                                           |
| Gmail           | Types/schema/capabilities present          | Explicitly unavailable                | Not implemented end-to-end     | Not implemented          | Not implemented         | Target only beyond foundation.                                            |
| Microsoft 365   | Enum/schema/capabilities present           | Explicitly unavailable                | Not implemented                | Not implemented          | Not implemented         | Target only.                                                              |
| Resend          | Types/schema/settings path present         | Functional setup surface              | Partial/staged                 | Not complete             | N/A                     | Not release-ready end to end.                                             |
| SMTP            | Adapter and encrypted settings implemented | Functional setup/test                 | Nodemailer adapter implemented | Not applicable           | N/A                     | Most complete new email sender; live DB/provider verification pending.    |

No provider silently falls back to another. A connection must pass health verification before enablement, secrets remain encrypted/write-only, and switching providers requires appropriate new credentials.

## 9. Cross-cutting quality

### Security

Strengths include Supabase RLS design, role helpers, encrypted provider and AI credentials, Meta HMAC verification, API-key hashing, signed webhooks, service-only secret handling, request-header redaction, body limits, stable auth redirects and BFF header allowlists. Remaining risks are unverified live RLS, incomplete signature/OAuth implementations for new providers, HTML/attachment controls required for email, and instance-local rate/cache behavior.

### Observability and reliability

Express supplies request IDs, structured Pino HTTP logs, liveness/readiness probes and graceful shutdown. Provider-neutral webhook receipts introduce idempotency storage. Missing production-grade areas include distributed traces/metrics, durable job queues, dead-letter operations, persisted provider retry dashboards and multi-instance-safe throttling.

### Testing and validation

The repository has broad colocated Vitest coverage. On this audit:

- `pnpm exec vitest run src/lib/service-api-url.test.ts`: 4/4 passed.
- `pnpm test`: passed, 653 tests across 71 files.
- `pnpm typecheck`: passed after the resolver type correction.
- Changed-file ESLint: passed.
- `pnpm build`: passed; 46 static-generation entries completed and routes compiled.
- Build warnings: module-type warning for `next.config.ts`; edge runtime disables static generation for affected route(s).
- Alternate `WEB_PORT=3100` was observed by Next. A second dev instance could not remain active because Next 16 enforces a single `.next/dev` lock for one checkout, independent of port.
- Full alternate two-process health/browser verification was not completed in the sandbox: API startup initially lacked Supabase variables, and later process probes timed out. This is an environment limitation, not evidence of a successful live preview.

### Accessibility and responsive design

The UI uses semantic shadcn primitives and has responsive shells, but full keyboard, screen-reader and 941×681 dark-mode browser regression coverage is not established for every page. Provider/channel identity must always be conveyed in text, not color alone.

## 10. Current risks and technical debt

| Priority | Risk                                               | Consequence                                                          | Required action                                                                             |
| -------- | -------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Critical | Supabase baseline absent in connected environment  | Persistence and RLS cannot be trusted or provider settings exercised | Apply `001`–`040` in order to a controlled project; run role/cross-account probes.          |
| High     | Docs/target exceed implemented provider behavior   | False release confidence                                             | Keep provider matrix evidence-based; gate UI on implemented capabilities.                   |
| High     | Canonical and legacy routes coexist                | Duplicate maintenance and account-ID URL leakage                     | Replace legacy page bodies with validated redirects after parity tests.                     |
| High     | SQLite/demo/in-memory paths coexist with Supabase  | Restart/multi-instance data inconsistency                            | Converge production paths on Supabase or clearly isolate demo mode.                         |
| High     | Email OAuth/sync/webhook lifecycle missing         | Omnichannel target incomplete                                        | Implement one provider vertically before adding breadth.                                    |
| Medium   | Two lockfiles                                      | Non-reproducible installs                                            | Retain pnpm lock only after deployment tooling confirms pnpm.                               |
| Medium   | Next dev lock blocks two servers from one checkout | Alternate-port verification can be confused with port collision      | Stop the existing Next dev process or use a separate worktree/build for concurrent testing. |
| Medium   | Repository-wide lint debt                          | Signal dilution and CI risk                                          | Establish lint baseline and burn down by domain without suppressing new errors.             |
| Medium   | Next config ESM warning                            | Startup noise and parsing overhead                                   | Align package/config module format.                                                         |
| Medium   | Express extraction is shallow                      | Duplicate Next/Express business boundaries                           | Define which domains move to Express; avoid two implementations.                            |

## 11. Approved Enterprise V1 target

V1 remains a single-company, multi-user omnichannel CRM with Meta/Twilio WhatsApp, Gmail and optional independent email providers, unified contacts/conversations, capability-driven composers, durable notifications, AI grounding, provider diagnostics and simple canonical URLs. V2 is the first version allowed to add multi-company account switching; V1 still preserves `account_id` at every domain boundary.

Target security requires AES-256-GCM credentials, one-time hashed OAuth state, verified provider events, sanitized email HTML, private bounded attachments, explicit account filters for service-role work, durable idempotency and no secrets in logs/client payloads. A feature is complete only when schema, source, persistence, RLS, tests and operational validation agree.

## 12. Prioritized implementation sequence

1. Establish and verify the Supabase migration baseline and RLS matrix.
2. Complete one vertical provider path (recommended Gmail or SMTP depending inbound requirement): connect, test, enable, send, receive/sync, idempotency, UI and reload persistence.
3. Backfill Meta into channel connections without regressing existing WhatsApp behavior.
4. Complete canonical-route consolidation and remove production dependence on SQLite/demo repositories.
5. Build persisted notification delivery and provider health operations.
6. Add Twilio, Resend and Microsoft adapters only through the neutral registry.
7. Add end-to-end browser, webhook, OAuth, accessibility and multi-instance reliability gates.
8. Resolve lint/config/lockfile debt and publish a release readiness checklist.

## 13. Completion criteria

Release requires ordered migrations, verified RLS for all roles and cross-account denial, provider signature/OAuth/idempotency tests, end-to-end send/receive persistence, Meta regressions, accessible responsive browser checks, clean type/test/build gates, no changed-file lint errors, and no credentials or customer content in logs/client bundles. Until those gates pass against a live Supabase baseline, this repository is an advanced implementation in progress rather than a fully validated omnichannel V1 release.

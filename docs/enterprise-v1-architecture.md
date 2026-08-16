# wacrm current-state architecture and Enterprise V1 target

> Status: target contract for Enterprise V1. **Sections 2–4 describe the
> as-built system and were re-verified against the running application;
> sections 5+ remain the forward-looking target.**
> Originally audited 2026-07-13 on branch `architecture-report`.
> Authority: applied Supabase schema → repository migrations → executable source → this report → upstream snapshots.
>
> **For the as-built system, prefer `.agents/context/`** — `hld.md`,
> `lld.md`, `api-routes.md`, and the generated `database-schema.md`
> (`pnpm db:doc`) are kept current. This document is the *target* contract
> and the reasoning behind it.

## 1. Executive summary

wacrm is a self-hostable, account-scoped CRM centered on WhatsApp conversations. It is a **single** Next.js 16 App Router application talking directly to Supabase (Postgres + Auth + Storage + Realtime, RLS on every table), with an optional MCP server and provider adapters under active development.

Verified current shape:

| Fact | Value |
| --- | --- |
| Processes | 1 (Next.js 16.2.12) |
| Feature modules | 27 under `src/features/` |
| Route handlers | 115 across 19 namespaces |
| Public API routes | 25 under `/api/v1` |
| Migrations | 131 |
| Tables in `public` | 88, RLS enabled on all 88 |
| DB functions | 193 |
| Tests | 913 passing across 99 files |

**A previous iteration split business logic into a separate Express 5 API under `server/`, reached through an `/api/service/[...path]` BFF forwarder. That has been removed** — there is no `server/` directory, no `/api/service` route, and no `concurrently`. `pnpm dev` runs one process via `scripts/run-web.mjs`. Domain code now lives in feature modules (`src/features/<domain>/{components,lib,hooks}`) rather than a flat `src/lib/<domain>/`, and `pnpm check:boundaries` fails the build when one feature reaches into another's internals.

The most important distinction is between **implemented current state** and **approved V1 target state**. Meta WhatsApp is the mature transport. A provider-neutral schema, contracts, registry, settings API/UI, SMTP adapter, and Meta/Twilio webhook boundaries exist, but full Gmail, Microsoft 365, Resend, and Twilio transport lifecycles are not complete.

## 2. Runtime and process topology

```text
Browser
  |
  | HTTPS / same-origin
  v
Next.js 16.2.12 / React 19.2.4 (WEB_PORT, default 3000)
  |- App Router pages and layouts
  |- Supabase session refresh in src/proxy.ts
  |- authenticated route handlers (115, 19 namespaces)
  |- public REST API /api/v1 (25 routes, stability contract)
  `- OAuth and webhook boundaries (Meta HMAC, Twilio signature)
          |
          v
Supabase Auth/Postgres/Storage/Realtime  (88 tables, RLS on all 88)

Provider services  --> Meta, SMTP today; broader adapters are staged/partial
External tools     --> mcp-server --> public API
```

`pnpm dev` runs a **single** process: `scripts/run-web.mjs` validates `WEB_PORT` and launches the local Next binary. There is no second API process to supervise, so `concurrently`, `API_HOST`, `API_PORT`, `EXPRESS_API_URL`, and `src/lib/service-api-url.ts` are all gone.

### Request and trust boundaries

1. Browser traffic enters Next.js only; provider secrets and service-role credentials must never enter client bundles.
2. `src/proxy.ts` refreshes Supabase sessions and protects application routes.
3. Route handlers authorize against Supabase membership/RLS via
   `getCurrentAccount()`; `requireSuperAdmin()` gates all `/api/admin/*`.
4. Service-role usage (`channelAdmin()`) bypasses RLS and MUST scope
   `account_id` in every query by hand.
5. Public API keys are hashed and scoped; outbound webhooks are signed.
6. Inbound provider webhooks must verify provider signatures before normalization or persistence, and fail closed when the signing secret is unset.

## 3. Source-controlled project structure

```text
.
├── .github/                 CI, ownership, security, issue/PR policy and assets
├── docs/                    local authoritative docs and upstream comparison snapshots
├── mcp-server/              standalone Model Context Protocol client/server package
├── messages/en.json         application message catalog
├── public/                  static icons, manifest and images
├── .agents/context/         agent context pack (as-built HLD/LLD/schema)
├── scripts/                 run-web.mjs, push-supabase-schema.mjs,
│                            generate-schema-doc.mjs, check-boundaries.mjs
├── src/
│   ├── app/                 App Router pages, layouts and route handlers
│   ├── features/            27 domain modules: components/, lib/, hooks/
│   ├── components/          SHARED UI only: ui/, layout/, providers/,
│   │                        shared/, tremor/, prompt-kit/
│   ├── hooks/               generic app-wide hooks
│   ├── lib/                 cross-cutting infra: data/, supabase/, api/,
│   │                        cache/, storage/, email/, routing/, account/
│   ├── contracts/           shared request/response contracts
│   ├── i18n/                request config
│   ├── types/               ambient/shared declarations
│   └── proxy.ts             Next 16 session/auth boundary
├── supabase/migrations/     131 idempotent migrations, applied in filename order
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
| `package.json`, `pnpm-lock.yaml`                                       | Runtime/dependency contract. pnpm is canonical (`packageManager` field); the duplicate `package-lock.json` has been removed.       |
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
| Alerts APIs          | `/api/alerts/destinations` (admin) and `/api/alerts/dispatch` (`CRON_SECRET`) fire threshold alerts.                                                                                     |
| Assistant APIs       | `/api/assistant/{chat,sessions,sessions/[id]}` back the in-app agentic assistant.                                                                                                        |
| MCP                  | `/api/mcp/[transport]` exposes the MCP server in-app, authenticated by API key.                                                                                                          |

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

### `src/features`: domain modules

Domain code is colocated per feature as `src/features/<domain>/{components,lib,hooks}`
and imported via `@/features/<domain>/...`. The flat `src/lib/<domain>/`
layout this section previously described has been fully migrated;
`pnpm check:boundaries` now fails the build when one feature imports
another feature's internals.

| Module | Responsibility, persistence and status |
| --- | --- |
| `auth/`, `agents/`, `admin/` | Membership context, roles, invitation safety (incl. the pre-signup `check-email` guard), API context, platform console. |
| `whatsapp/` | Mature Meta transport: encryption, registration, sending, media, templates, webhook normalization, interactive messages, reactions, contact/conversation resolution and delivery state. |
| `channels/` | Provider-neutral types, capability registry, credential envelopes and adapters. Foundation is implemented; provider parity is not. |
| `assistant/` | OpenAI/Anthropic BYO-key generation, encrypted configuration, knowledge retrieval/embeddings, draft/auto-reply, usage, handoff and safety rules. Owns `lib/ai/`. |
| `flows/` | **The unified workflow engine.** Graph validation/layout, execution, fallback and deterministic routing. The former `automations/` module was folded in here; precedence remains Flows → Automations → AI. |
| `api-keys/`, `webhooks/` | Key hashing/scopes and signed retrying outbound delivery. |
| `pipelines/`, `contacts/`, `inbox/`, `dashboards/` | Domain projections, filters, date/metric helpers and view models. |
| `alerts/` | Threshold rules, delivery destinations and fired events (`/api/alerts/dispatch` is cron-gated). |
| `broadcasts/`, `templates/`, `catalog/`, `appointments/` | Campaign, template, product and booking surfaces. |
| `onboarding/`, `settings/`, `brand/`, `module-fields/` | Workspace setup, configuration and per-account field visibility. |
| `support/`, `team-chat/`, `presence/`, `interactive/`, `external-sources/` | Tenant support tickets, internal chat, member presence, interactive messages, CSV/external recipient sources. |

### `src/lib`: cross-cutting infrastructure

| Group | Responsibility |
| --- | --- |
| `supabase/` | Browser/server clients. Server client participates in cookie-backed Auth; service-role use must remain server-only. |
| `data/` | Supabase repositories per domain. |
| `api/` | Public API auth, pagination and error translation. |
| `storage/`, `cache/`, `rate-limit.ts` | Server-side storage/cache/rate controls; in-memory implementations are instance-local and unsuitable for strict multi-instance guarantees. |
| `routing/`, `routes/` | Canonical simple routes plus legacy account-prefixed generators; consolidation remains incomplete. |
| `email/`, `account/`, `navigation/`, `audit-events.ts` | Outbound mail, account helpers, nav model, audit trail. |
| `quotas/` | Plan limit enforcement against `account_quotas` / `usage_counters`. |
| `phone/`, `url/`, `currency.ts`, `themes.ts`, `display-name.ts` | Shared formatting and normalization helpers. |

### MCP package

`mcp-server/package.json`, TypeScript config, entrypoint, API client, auth/config, tool definitions, schemas and tests form an independently runnable MCP bridge. It consumes the public REST API rather than bypassing application authorization. Writes are opt-in; public API scope and account checks remain the security boundary. `docs/mcp.md` is its operator contract.

### Documentation

- `docs/enterprise-v1-architecture.md`: this current-state audit and approved target.
- `.agents/context/`: the as-built context pack (HLD, LLD, api-routes, generated schema). Prefer it for current state.
- `docs/archive/architecture-delta.md`: concise differences from upstream snapshots (archived).
- `docs/public-api.md`, `docs/mcp.md`: local API/tool authority.
- `docs/upstream-wacrm/*`: comparison snapshots only; intentionally not rewritten.

## 5. Route inventory

The build exposes 29 page files and 60 route-handler files. Pages include four auth pages, 19 canonical feature/detail pages, one join route and six legacy account-prefixed variants. API families are account (8), AI (9), automations (5), flows (6), channel/settings (3), quick replies (2), public v1 (12), WhatsApp (10), invitations (3), demo (2), auth callback (1), and service BFF (1).

The three invitation handlers are `peek` (unauthenticated preview of workspace
name and role for the confirmation screen), `check-email` (pre-signup address
guard, see §7) and `redeem` (the single-use POST that inserts membership).

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
  - **Invite address guard (pre-signup).** When `/login` or `/signup` is reached
    with `?invite=<token>`, the form calls
    `POST /api/invitations/[token]/check-email` **before** touching Supabase
    Auth. This exists because `supabase.auth.signUp` is a point of no return:
    the `handle_new_user` trigger runs inside it, finds no invitation matching a
    mismatched address, and bootstraps a brand-new workspace instead. The user
    then lands on `/join` holding an account they never wanted and cannot use
    to accept. The route compares server-side against `invited_email` and
    returns only `{ matches, reason }` — `'expired' | 'already_accepted' | null`
    — so the invited address is never disclosed to the browser. An unreadable
    or failed response is treated as "proceed": redemption re-checks the
    address anyway (ADR-004 F1), so a network blip must not lock a legitimate
    invitee out of signing up. This is a UX guard in front of the real
    boundary, never a replacement for it.
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

Tenant-visible activity is recorded in `audit_events`, and the alerts subsystem (`alert_rules` → `alert_events` → `alert_deliveries`) turns threshold breaches into notifications. Provider-neutral webhook receipts provide idempotency storage.

Removing the Express layer also removed the request-ID propagation, Pino HTTP logs, and `/health/live` + `/health/ready` probes it supplied — **re-establishing structured request logging and health endpoints on the Next.js surface is outstanding work**, not a solved problem. Also missing: distributed traces/metrics, durable job queues, dead-letter operations, persisted provider retry dashboards, and multi-instance-safe throttling (`rate-limit.ts` and the in-memory cache are instance-local).

### Testing and validation

The repository has broad colocated Vitest coverage. On this audit:

- `pnpm test`: passed, 913 tests across 99 files.
- `pnpm typecheck`: passed.
- `pnpm check`: the aggregate gate — typecheck + lint + `check:boundaries` + test.
- Changed-file ESLint: passed.
- `pnpm build`: passed; 46 static-generation entries completed and routes compiled.
- Build warnings: module-type warning for `next.config.ts`; edge runtime disables static generation for affected route(s).
- Alternate `WEB_PORT=3100` was observed by Next. A second dev instance could not remain active because Next 16 enforces a single `.next/dev` lock for one checkout, independent of port.
- Full alternate two-process health/browser verification was not completed in the sandbox: API startup initially lacked Supabase variables, and later process probes timed out. This is an environment limitation, not evidence of a successful live preview.

### Accessibility and responsive design

The UI uses semantic shadcn primitives and has responsive shells, but full keyboard, screen-reader and 941×681 dark-mode browser regression coverage is not established for every page. Provider/channel identity must always be conveyed in text, not color alone.

#### Feedback surface: toasts

Transient success/failure feedback goes through **sonner**, mounted once as
`ThemedToaster` in the root layout (`position="top-right"`). Both auth forms use
it, so sign-in and sign-up report failures identically: `showLoginError` and
`showSignupError` wrap `toast.error(title, { description })`.

Two conventions worth keeping:

- **Do not render the same message inline as well.** The auth forms keep an
  `error` state purely to drive `aria-invalid` on the affected fields; the toast
  is the visible copy. Printing both duplicated one sentence on a short form.
- **`ThemedToaster` must override `fontFamily`.** Sonner hard-codes its own
  `ui-sans-serif, system-ui, …` stack on `[data-sonner-toaster]`, which does not
  pick up the app's Inter. The override starts on the container — setting
  `inherit` only on the toast would inherit that same wrong stack from the
  parent — and toasts then inherit Inter from `<body>`. Left unset, toasts
  render in whatever generic face the platform resolves that list to, which on
  some platforms is a mono-looking fallback.

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
| Medium   | Express removal dropped request logging and health probes | No structured request IDs, Pino logs, or `/health/{live,ready}` on the Next surface | Re-add request-ID propagation, structured logging and health endpoints as Next.js instrumentation. |

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

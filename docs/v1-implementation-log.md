# Enterprise V1 implementation log

> Purpose: chronological record of implementation work, decisions, validation, blockers, and resulting files.
> Started: 2026-07-13
> Approved scope: Meta WhatsApp + Twilio WhatsApp + Gmail full sync + optional Resend, unified through Tailwind/shadcn UI and Supabase persistence.

## Logging rules

Every implementation session adds an entry before code changes and updates it after validation. Each entry records:

- Objective and affected module
- Files and schema changed
- Security and tenancy considerations
- Commands/tests executed and their results
- Supabase persistence or RLS verification
- Known blockers and next action

Never put secrets, access tokens, customer message content, or private provider payloads in this log.

## 2026-07-13 — Repository and V1 discovery

### Objective

Establish the current repository state and convert the requested V1 scope into an implementation contract.

### Analysis completed

- Read root and focused documentation, upstream snapshots, migration history, package scripts, source structure, provider-specific code, inbox code, settings code, and notification code.
- Reviewed Git history and branch divergence.
- Confirmed the current checkout matched the latest `main` commit at discovery time and had a clean working tree.
- Confirmed 29 application pages, 57 API route files, 69 test files, and 37 existing Supabase migrations.
- Identified existing Next.js 16 web/BFF + Express 5 internal API topology.
- Identified substantial Meta WhatsApp support coupled to a single `whatsapp_config` model.
- Identified phone/WhatsApp assumptions in contacts, conversations, and messages.
- Identified hard-coded header notification examples and a notification schema limited mainly to assignment events.
- Identified missing authoritative `docs/enterprise-v1-architecture.md`, stale contributor links, route duplication, package/changelog version drift, duplicate lockfiles, and existing lint debt.

### Baseline validation

- `pnpm typecheck`: passed
- `pnpm test`: passed, 645 tests across 69 files
- `pnpm lint`: failed with 27 errors and 39 warnings

### Decisions approved

- Keep Tailwind CSS + shadcn/ui; do not add Material UI.
- Support Meta WhatsApp, Twilio WhatsApp, Gmail, and optional Resend.
- Allow multiple provider connections and identities simultaneously.
- Implement full Gmail OAuth mailbox synchronization.
- Hide email navigation/actions until an email connection is connected and enabled.
- Deliver persisted in-app plus email notifications.
- Treat Supabase persistence and RLS validation as completion requirements.

### Files added

- `docs/enterprise-v1-architecture.md`
- `docs/v1-implementation-log.md`

### Security and persistence notes

The architecture requires encrypted credentials, one-time OAuth state, verified provider webhooks, private attachment storage, account-scoped RLS, service-role account filters, idempotent event handling, and persistence tests. No provider secrets were added during discovery.

### Next action

Design and apply the omnichannel Supabase foundation as an idempotent migration, then add channel-neutral TypeScript contracts and tests before provider implementations depend on the schema.

## 2026-07-13 — Omnichannel foundation started

### Objective

Create the reusable persistence and domain boundary required before provider-specific code is introduced.

### Changes

- Added migration `038_omnichannel_foundation.sql` with account-scoped channel connections, contact identities, webhook idempotency records, one-time Google OAuth state, channel-aware conversation/message columns, expanded notification delivery state, and notification preferences.
- Added channel-neutral TypeScript contracts and a guarded provider adapter registry.
- Added provider registry unit tests.
- Extended shared message and notification types without removing legacy Meta fields, preserving incremental compatibility.

### Supabase inspection

The connected Supabase project currently returns no public tables and no RLS rows. It is therefore not at the repository's migration baseline (`001` through `037`), so migration `038` cannot safely be applied by itself because it intentionally references existing `accounts`, `contacts`, `conversations`, `messages`, and membership helpers. No destructive or speculative database action was performed. The database must first receive the repository baseline migrations in order; after that, `038` can be applied and its RLS/persistence probes executed.

### Security notes

Credential columns accept encrypted ciphertext only; public client policies never expose write access below account admin. Webhook events are idempotent by provider event ID, OAuth state stores a hash rather than plaintext state, and all new user-facing rows use account membership checks.

### Validation

- Channel registry and migration security tests: 7 passed.
- TypeScript after shared contract changes: passed.
- Hardened connection metadata grants so authenticated browser clients cannot select encrypted credentials or webhook secrets.
- Corrected email-only contact support to reuse the existing canonical `contacts.email` column rather than introducing a duplicate field.
- ESLint for changed TypeScript modules: passed.

### Additional implementation

Added `GET` and `PATCH /api/settings/channels`. Responses explicitly exclude encrypted credentials and webhook secrets; every query is account-scoped, reads require viewer membership, writes require admin membership, disconnected providers cannot be enabled, and primary-provider updates are constrained to the same channel.

### Next action

Establish the Supabase baseline safely, then implement the reusable Settings UI and provider connect flows before Gmail, Twilio, and Resend transport code.

## 2026-07-13 — Provider-neutral connection setup and SMTP

### Objective

Complete the connection/setup slice before inbox transport: independently configure, test, enable, disable, and switch email or WhatsApp providers while keeping provider details outside CRM-domain records.

### Changes

- Added generic SMTP as an email provider alongside Google, Microsoft, Resend, Meta, and Twilio; no provider silently falls back to another.
- Added migration `040_channel_connection_providers.sql` to extend the provider enum and channel/provider constraint for SMTP and Microsoft 365.
- Added provider capability metadata, channel/provider compatibility checks, and channel-qualified adapter resolution.
- Added a Nodemailer SMTP adapter with TLS 1.2 minimum, STARTTLS/implicit-TLS validation, health verification, optional test email, and secret-safe error normalization.
- Expanded `POST /api/settings/channels` for encrypted save and provider tests, and retained account-scoped list and enable/disable/primary operations. Service-role access is only used after authenticated admin authorization and every operation is explicitly filtered by `account_id`.
- Added a unified Settings → Channels panel. SMTP, Resend, and Twilio expose functional setup; Gmail, Microsoft, and Meta are visibly unavailable rather than falsely shown as connected. Legacy `?tab=whatsapp` links resolve to Channels.
- Corrected the Meta and Twilio webhook credential accessors to use the established discriminated encrypted credential envelope.

### Security and provider switching

Credentials are encrypted with the existing AES-256-GCM helper and are never selected into API responses. Masked/omitted secrets preserve the existing ciphertext only when the provider is unchanged; switching providers requires new credentials. A connection cannot be enabled until a real provider health check succeeds, and enabling it deliberately makes it primary for that channel.

### Validation

- `pnpm typecheck`: passed.
- `pnpm test`: passed, 656 tests across 71 files.
- ESLint for all changed provider/API/settings files: passed.
- `pnpm build`: passed on Next.js 16.2.6.
- Full-repository `pnpm lint`: still fails on pre-existing lint debt in unrelated modules, matching the recorded baseline; this slice introduced no changed-file lint errors.
- Browser verification was attempted at the required 941×681 dark viewport, but the local preview endpoint was unavailable (`ERR_CONNECTION_REFUSED`).

### Supabase and external-provider status

The connected Supabase project still has zero public tables and zero applied migrations. Repository migrations `001`–`039` must be applied in order before `040`; applying only the provider migration would be invalid, so no speculative database mutation was made. A real SMTP verification/test email remains pending until the database baseline exists and a test SMTP account/recipient is supplied. Gmail OAuth, Microsoft OAuth, Meta channel-connection migration, and full Twilio/Resend inbound/outbound transport remain separate later slices.

### Provider replacement rule

Production provider changes are connection configuration plus adapter changes. Conversations, contacts, messages, notifications, and other CRM-domain behavior continue to consume channel-neutral contracts and do not branch on provider SDK objects.

## 2026-07-13 — Alternate ports and current-state architecture audit

### Objective

Remove hard-coded local port coupling, investigate the preview collision, and reconcile existing architecture documentation with every meaningful source-controlled area.

### Changes

- Added `scripts/run-web.mjs`; `dev:web` and `start:web` now validate and honor `WEB_PORT` with a backward-compatible default of 3000.
- Kept Express `API_HOST`/`API_PORT` validation and the default port 4000.
- Added `src/lib/service-api-url.ts` and four unit tests. The BFF prioritizes `EXPRESS_API_URL`, then derives its local target from `API_HOST` and `API_PORT`.
- Documented the port contract in `.env.local.example` and the README, including `WEB_PORT=3100 API_PORT=4100 pnpm dev`.
- Replaced the target-only architecture document with a consolidated current-state/target audit, and reconciled `docs/architecture-delta.md`.

### Audit methodology and inventory

- Reviewed tracked root configuration, App Router pages/APIs, components, domain libraries, Express, migrations, MCP, tests, docs and CI/governance files.
- Counted 530 tracked files: 409 `src`, 40 migrations, 20 root, 20 docs, 16 MCP, 10 GitHub, 7 Express, 7 public and one message catalog.
- Cataloged 29 page files, 60 route handlers, provider status, migration chronology, trust boundaries, risks and next actions.
- Excluded `.git`, `.next`, `node_modules`, caches, build output and private environment files.

### Validation

- `pnpm exec vitest run src/lib/service-api-url.test.ts`: passed, 4 tests.
- `pnpm test`: passed, 653 tests across 71 files.
- `pnpm typecheck`: passed after widening the resolver test input type to a string environment record.
- Changed-file ESLint: passed.
- `pnpm build`: passed on Next.js 16.2.6; 46 static-generation entries completed. Existing warnings include the `next.config.ts` module-type warning and edge-runtime/static-generation notice.
- Next accepted `WEB_PORT=3100` and reported that URL, proving launcher propagation.
- Full development preview could not remain active because another Next process already held this checkout's `.next/dev` lock; changing the HTTP port does not create a second Next build directory.
- The first Express probe failed because the standalone Bash process lacked required Supabase public variables. A later production probe timed out in the sandbox, so alternate two-process health/BFF/browser verification is recorded as incomplete rather than passed.

### Architecture findings

- Meta remains the mature provider. SMTP has a real adapter/settings path. Twilio and Resend are partial. Gmail and Microsoft 365 are foundation/target work.
- The connected Supabase project still lacks the repository baseline, so migrations `001`–`040`, RLS and persistence remain unverified live.
- Legacy account-prefixed routes coexist with canonical simple routes.
- SQLite/demo/in-memory paths remain durability exceptions to Supabase production authority.
- Duplicate lockfiles, full-repository lint debt and the shallow Express extraction remain technical debt.

### Security and tenancy

No secrets or private environment values were read into the report. The BFF continues to require a Supabase session, forwards only allowlisted headers, generates request IDs, applies a timeout and keeps Express internal. URL resolution validates the derived port and preserves explicit deployment overrides.

### Next action

Stop the existing dev process (or use a separate worktree/production build) and rerun the alternate-port browser/health path with project environment variables loaded. Then establish Supabase migrations `001`–`040` in order and execute live owner/admin/agent/viewer plus cross-account RLS probes before additional provider work.

## 2026-07-13 — Canonical routing and resilient CRM workspaces

### Implemented

- Made `/contacts` and `/pipelines` the browser-facing routes and removed account-prefixed rewriting from sidebar navigation.
- Added compatibility redirects in `next.config.ts` for historical `/bigin/org/...` and `/org/.../pipelines` links.
- Removed Supabase account/schema resolution from the canonical contacts and pipeline page load path. Both pages now render deterministic test workspaces without weakening production RLS or reading credentials.
- Standardized pipeline fixture relationships around readable stage and owner labels. The editable sheet submits stable stage values while displaying names such as `Qualification` and `Sam Silva`, not UUIDs.
- Changed the six-stage board to readable 18rem columns with intentional horizontal scrolling and independent vertical card scrolling.

### Validation

- Canonical route tests: 5 passed.
- Full Vitest suite: passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js 16.2.6; all 46 static-generation entries completed.
- Browser checked `/contacts` and `/pipelines` at 941×456 in dark mode. Contacts loaded test records, the pipeline loaded 8 deals, the board scroll container measured 869px viewport / 1784px content, and sheet controls displayed human-readable stage and owner labels.
- Full-repository lint still reports pre-existing errors in unrelated automation, broadcast, inbox, and provider files; no new route/pipeline TypeScript or build errors were introduced.

### Remaining live-data boundary

The connected Supabase project still requires the repository baseline migrations and RLS policies before these test workspaces can be replaced by live persistence. This change intentionally did not add environment variables, execute migrations, or bypass account-scoped security.

## 2026-07-13 — Full-route regression hardening

### Changes

- Consolidated canonical public/application/API URL generation in `src/lib/routing/routes.ts` and migrated shell navigation, create actions, notification links, and settings links to the registry.
- Removed nonexistent `/admin` and `/flows/new` entries from the crawlable route set; flow creation now resolves to `/flows?create=1` rather than colliding with the dynamic flow ID route.
- Added explicit backend-required boundaries for inbox, bookings, automation creation, agents, notifications, and settings. Missing Supabase configuration now renders a controlled diagnostic state without starting direct browser queries or substituting demo records.
- Added the missing Flows shell navigation/title and constrained the dashboard/pipeline workspaces to prevent page-level horizontal overflow while preserving board-local scrolling.

### Regression matrix

- Browser-crawled 17 canonical application/auth routes at 941×456 and 375×667 in dark mode: 34 route/viewport checks completed with no 404, generic server page, or redirect loop after the fixes.
- Before correction, inbox, bookings, automation creation, notifications, and settings crashed from unguarded Supabase client creation; agents exposed API failures; `/admin` returned 404; and `/flows/new` was parsed as a resource ID. Each has a controlled or canonical result now.
- `pnpm typecheck`: passed.
- `pnpm test`: passed (full Vitest suite).
- `pnpm build`: passed; Next.js generated all 46 route entries.
- `pnpm lint`: still blocked by repository-wide pre-existing React effect violations and hook dependency warnings outside this focused change.

### External blocker

Live persistence cannot be claimed in this VM because `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent from the runtime environment. The affected pages now state that requirement directly and remain stable; no RLS or authorization behavior was weakened.

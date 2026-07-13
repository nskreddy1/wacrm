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

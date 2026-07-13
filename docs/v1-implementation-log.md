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

# Enterprise V1 omnichannel CRM architecture

> Status: approved implementation contract
> Last updated: 2026-07-13
> Authority: live Supabase schema and migrations → source code → this document → upstream snapshots

## Product contract

V1 is a single-company, multi-user sales CRM that unifies customer conversations, contact history, sales execution, automation, and AI assistance. It preserves the existing WhatsApp CRM and adds full email capability through reusable channel adapters.

V1 supports these independently connectable account-level providers:

- Meta Cloud API for WhatsApp
- Twilio for WhatsApp
- Gmail through Google OAuth, with full send, receive, reply, and thread synchronization
- Resend as an optional independent email provider

An account may enable multiple providers and sender identities simultaneously. Email navigation and customer-email actions remain hidden until at least one Gmail or Resend connection is both connected and enabled. Authorized administrators can always access provider setup in Settings.

## V1 scope

V1 includes:

- Unified WhatsApp and email inbox
- Contacts with phone and email identities
- Assignment, team roles, internal notes, tags, quick replies, and presence
- Pipelines and deals
- Broadcasts and templates where supported by provider capabilities
- Automations and Flows with explicit channel capability checks
- AI drafts, auto-replies, knowledge retrieval, handoff, and usage tracking
- Bookings
- In-app and email notifications
- Provider configuration, health, diagnostics, and independently controlled toggles
- Public REST API, signed outbound webhooks, and MCP compatibility
- Account-scoped Supabase persistence, Realtime, Storage, and Row Level Security

V2 is the first version allowed to add multi-company membership and account switching. V1 keeps `account_id` at every domain boundary so V2 does not require destructive schema changes.

## System topology

```text
Browser
  |
  v
Next.js 16 web and BFF
  |- authenticated pages and same-origin APIs
  |- provider OAuth callbacks
  |- Meta, Twilio, Gmail, and Resend webhooks
  |- public /api/v1 API
  |
  +--> Express 5 internal business API through /api/service/*
  |
  +--> Supabase Postgres, Auth, Storage, and Realtime
  |
  +--> provider adapters
         |- Meta Cloud API
         |- Twilio
         |- Gmail API
         `- Resend
```

Browser code never receives provider credentials. Next.js owns webhook and OAuth boundaries. Reusable business operations may be delegated to Express while account authorization remains mandatory at every boundary.

## Reusable module boundaries

Shared channel contracts live under `src/lib/channels/` and express capabilities rather than vendor-specific branches.

Core contracts:

- `Channel`: `whatsapp` or `email`
- `ChannelProvider`: `meta_whatsapp`, `twilio_whatsapp`, `gmail`, or `resend`
- `ChannelConnection`: encrypted account-owned provider configuration and health state
- `ChannelIdentity`: a phone number, WhatsApp sender, Gmail mailbox, or verified Resend sender
- `ProviderCapabilities`: send, receive, media, templates, interactive messages, reactions, threading, rich text, and attachments
- `InboundEvent`: normalized inbound message or delivery event
- `OutboundMessage`: normalized send request with provider-specific options isolated in adapter metadata
- `ProviderAdapter`: connection test, identity discovery, send, event verification, event normalization, and health operations

The provider registry resolves adapters and enabled identities. Inbox, notifications, automations, Flows, broadcasts, public APIs, and MCP code call shared channel services rather than vendor SDKs directly.

## Supabase data model

The omnichannel foundation extends existing data without deleting WhatsApp-compatible columns.

### Provider configuration

- `channel_connections`: account, provider, channel, encrypted secrets/tokens, enabled state, lifecycle status, capabilities, health, sync cursor, expiry, error diagnostics, metadata, and audit fields
- `channel_identities`: connection-owned senders/mailboxes with normalized address, provider external identifier, display name, enabled/default state, and metadata
- `channel_oauth_states`: short-lived, hashed, one-time OAuth state linked to account and initiating user

### Customer and conversation data

- Existing contacts remain account-scoped
- `contact_identities` stores normalized phone and email contact points without merging unrelated contacts
- Existing conversations gain channel, provider connection, provider identity, external thread identifier, subject, participant metadata, and sync timestamps
- Existing messages gain channel, provider message identifier, idempotency key, email headers and participants, subject, reply/thread references, normalized delivery state, and provider metadata
- `message_attachments` stores normalized attachment records; persisted files use private Supabase Storage
- Email sync/watch state records Gmail history cursors and watch expiry

### Notifications and reliability

- Existing notifications expand to assignments, mentions, inbound replies, provider failures, sync failures, campaigns, and automation errors
- Notification preferences are per user and event, with independent in-app and email delivery choices
- Delivery attempts are persisted so email notification failure cannot roll back the CRM action
- Provider events and webhook receipts use idempotency keys and bounded retry/error records

All tenant tables require account-scoped RLS. Provider configuration writes require owner/admin authority. Member reads are capability-limited. Service-role webhook and sync operations still filter explicitly by account.

## Provider behavior

### Meta WhatsApp

Existing registration, webhook HMAC validation, templates, media, reactions, interactive messages, delivery/read receipts, broadcasts, Flows, automations, and AI precedence are preserved. Existing configuration is migrated into the shared connection model.

### Twilio WhatsApp

Twilio supports independently enabled WhatsApp sender identities, signed inbound/status callbacks, text and media sending, normalized delivery status, connection testing, and encrypted credentials.

### Gmail

Gmail uses Google OAuth with least-privilege scopes, one-time state validation, encrypted refresh tokens, mailbox profile discovery, initial and incremental history synchronization, push-watch renewal, MIME/thread-aware send and reply, attachments, revocation, and reconnect diagnostics.

### Resend

Resend is an optional second email provider, not an implicit Gmail failure fallback. It supports verified sender identities, outbound email, inbound events when configured, delivery/bounce/complaint events, webhook verification, and independent enablement.

## Unified inbox behavior

The inbox exposes All, WhatsApp, and Email views when capabilities permit. Every conversation and identity shows its channel and provider in accessible text, not color alone.

The composer is capability-driven:

- WhatsApp: text, media, templates, interactive messages, and reactions when supported
- Email: To, CC, BCC, subject, rich content, attachments, signature, and thread-aware replies
- Multiple identities: an identity selector lists enabled senders valid for the current channel

Outbound delivery persists a pending message before calling a provider, then records provider identifiers, normalized status, and errors. Inbound processing is idempotent. Contact activity can combine phone and email identities only when explicitly linked to the same contact.

## Automation and AI rules

The existing deterministic precedence remains mandatory:

1. Flows
2. Automations
3. AI auto-reply

Each trigger/action checks provider capabilities. Unsupported email semantics are hidden and rejected server-side. AI safeguards, usage limits, knowledge grounding, sticky handoff, and account-level metering remain in force.

## Interface contract

Tailwind CSS and shadcn/ui are the only component foundation for V1. Shared page shells, headers, metric cards, filter bars, tables, forms, connection cards, status badges, message primitives, skeletons, empty states, error panels, and permission gates must be reusable.

The interface must be responsive, keyboard accessible, screen-reader understandable, and visually consistent. Provider setup uses connection cards with connected/enabled/health states, test/reconnect/disconnect actions, diagnostics, and independent toggles. Secrets are write-only in the browser.

## Notifications

Notifications are saved in Supabase first and rendered through a real unread notification center. Per-user preferences control in-app and email delivery for assignments, mentions, replies, provider health, campaigns, and automation errors.

Email notification delivery uses an explicitly selected enabled Gmail or Resend identity. It does not silently switch providers after a delivery failure.

## Security contract

- Encrypt provider credentials with AES-256-GCM at rest
- Never return decrypted credentials to browser payloads
- Never log tokens, authorization headers, webhook secrets, customer message bodies, or attachment contents
- Verify Meta HMAC, Twilio signatures, Gmail OAuth state, and Resend webhook signatures
- Sanitize email HTML before rendering
- Restrict attachment type, size, storage path, and signed-URL lifetime
- Enforce role and account access in RLS/RPC or server code, never only in UI
- Keep public API changes additive

## Persistence and acceptance requirements

A feature is not complete because its UI renders. Tests must prove that data is saved, reloadable, account-scoped, and protected in Supabase.

Required release gates:

- Idempotent migration and backfill checks
- RLS tests for owner, admin, agent, viewer, and cross-account denial
- Provider adapter, signature, OAuth, MIME, normalization, and idempotency unit tests
- API tests for connect, enable, disable, reconnect, webhook, send, receive, sync, and permissions
- End-to-end persistence checks across reload/restart
- Existing Meta WhatsApp regression coverage
- Accessibility and responsive browser checks
- Passing `pnpm lint`, `pnpm typecheck`, `pnpm test`, and production build
- No credentials in client bundles or logs

## Delivery order

1. Architecture, work log, shared types, schema, RLS, and Meta backfill
2. Provider registry and Meta adapter migration
3. Twilio WhatsApp
4. Gmail OAuth, sync, receive, send, and reply
5. Optional Resend
6. Unified inbox and connection-aware interface
7. Notification persistence and email delivery
8. Existing module audit and compatibility cleanup
9. Supabase, browser, regression, security, and release validation

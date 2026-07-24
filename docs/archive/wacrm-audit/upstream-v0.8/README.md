# Upstream WACRM v0.8 evidence index

The source snapshots in [`../../upstream-wacrm/`](../../upstream-wacrm/) are preserved unchanged. They were retrieved from `wacrm.tech/docs` on 2026-07-13 and are historical evidence, not current-fork authority.

| Snapshot                                                               | Upstream contract                               | Current verification question                                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [README](../../upstream-wacrm/README.md)                               | Authority order and snapshot map                | Use executable current source ahead of snapshots.                                          |
| [architecture](../../upstream-wacrm/architecture.md)                   | Next 16 + Supabase + Meta, no dedicated backend | Current adds Express, BFF, public API and MCP.                                             |
| [supabase setup](../../upstream-wacrm/supabase-setup.md)               | Ordered migrations and Supabase services        | Current requires all `001`–`040`; live application remains unverified.                     |
| [environment variables](../../upstream-wacrm/environment-variables.md) | Supabase, Meta, encryption, cron                | Current adds ports/BFF, AI tuning, provider and MCP variables.                             |
| [deployment](../../upstream-wacrm/deployment-hostinger.md)             | Single-app Hostinger deployment                 | Current has two supervised processes and separate health requirements.                     |
| [inbox](../../upstream-wacrm/inbox.md)                                 | WhatsApp shared inbox and realtime              | Current adds quick replies, reactions, AI, presence and channel foundation.                |
| [contacts](../../upstream-wacrm/contacts.md)                           | Contacts, tags, custom fields, import           | Current adds account scope, dedupe and identity foundation.                                |
| [pipelines](../../upstream-wacrm/pipelines.md)                         | Kanban pipelines/deals                          | Current contains legacy and enterprise routes plus Supabase/SQLite/demo repository paths.  |
| [templates](../../upstream-wacrm/templates.md)                         | Meta template lifecycle                         | Current remains Meta-mature; omnichannel template parity is incomplete.                    |
| [broadcasts](../../upstream-wacrm/broadcasts.md)                       | WhatsApp campaign builder/status                | Current adds public API and richer status logic; channel-neutral campaigns remain partial. |
| [AI assistant](../../upstream-wacrm/ai-assistant.md)                   | Drafting/AI behavior                            | Current adds BYO OpenAI/Anthropic config, retrieval, usage and handoff.                    |
| [settings](../../upstream-wacrm/settings.md)                           | Profile, WhatsApp, tags/templates               | Current adds account/team, API keys, AI, security and provider-neutral connections.        |
| [members](../../upstream-wacrm/members.md)                             | Shared account roles                            | Current has membership/invitation/ownership APIs and role checks.                          |
| [public API](../../upstream-wacrm/public-api.md)                       | Additive REST surface                           | Current has scoped hashed keys, more endpoints, webhooks and MCP consumption.              |
| [changelog](../../upstream-wacrm/changelog.md)                         | Upstream feature history                        | Current Git/source determines fork lineage; no invented intermediate versions.             |

## Upstream system model

The upstream documentation describes a single Next.js server using Supabase directly. Supabase provides email/password Auth, PostgreSQL with user-scoped RLS, Storage and Realtime. Meta Cloud API is the only mature message transport; encrypted tokens are stored using AES-256-GCM, inbound signatures use `META_APP_SECRET`, scheduled automation waits are drained by an authenticated HTTP cron call, and process-local rate limiting is acknowledged as a scaling limitation.

## Upstream principal flows

- **Auth:** browser form → Supabase Auth → cookie-backed session → protected dashboard.
- **Inbound WhatsApp:** Meta webhook → HMAC verification → service-role contact/conversation/message persistence → automation dispatch → Realtime UI fan-out.
- **Outbound WhatsApp:** composer → authenticated send route → rate check → decrypt connection token → Meta API → persist `sent` message → Realtime reconciliation.
- **Contacts:** authenticated pages and routes → RLS-scoped contact/tag/custom-field tables.
- **Pipelines:** dashboard UI → pipeline/stage/deal tables → drag/update operations.
- **Broadcasts:** template/audience/personalization/schedule → recipient fan-out → delivery counters.
- **Automations:** trigger match → ordered action tree → pending execution for wait nodes → cron continuation.

## Interpretation rules

Exact names in snapshots are retained. Where upstream says “implemented,” this audit verifies the current code independently. Newer current features are not retroactively inserted into upstream v0.8, and current compatibility paths are not presented as upstream architecture.

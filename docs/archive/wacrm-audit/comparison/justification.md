# File/method justification audit

Date: 2026-07-16. Branch: `fork-sync-and-audit`. Baseline: `docs/wacrm-audit/` pinned audit (2026-07-13) plus upstream doc snapshots in `docs/upstream-wacrm/`.

Every top-level `src/lib/*` and `src/app/api/*` family (plus the Express `server/` tree) is listed with its purpose, upstream equivalent, and verdict. Legend:

- **keep** — justified, production path, aligned with upstream or a documented enterprise addition.
- **keep (fork addition)** — no upstream equivalent; enterprise feature with a documented reason to exist.
- **removed** — demo/mock/SQLite path removed in Phase B (kept in the table for the audit trail).
- **needs-fix** — justified to exist but has a defect fixed (or flagged) in this pass.
- **flagged** — exists but has no confirmed production consumer; removal decision deferred to the user.

## `src/lib/*`

| Family | Purpose | Upstream equivalent | Verdict |
| --- | --- | --- | --- |
| `lib/account` | Account membership context, roles (owner/admin/agent/viewer), invitations | Partial (upstream is user-ownership only) | keep (fork addition: multi-tenancy) |
| `lib/ai` | BYO OpenAI/Anthropic config, drafts, knowledge, usage metering, auto-reply (`auto-reply.ts` routes through orchestrator) | Partial (upstream has an assistant feature) | keep |
| `lib/api` | Shared API route helpers (auth guards, JSON errors) | Implicit in upstream routes | keep |
| `lib/api-keys` | Hashed + scoped public API keys for `/api/v1` | Upstream documents a REST API | keep (fork addition: key hashing/scopes) |
| `lib/auth` | Supabase session helpers | Same pattern upstream | keep |
| `lib/automations` | Trigger/action/wait engine, cron drain, admin client | Same feature upstream | keep |
| `lib/broadcast-status.ts` | Broadcast lifecycle status mapping | Upstream broadcasts | keep |
| `lib/cache` | Process-level caches | None (upstream is stateless routes) | keep (perf addition; no correctness dependency) |
| `lib/channels` | Channel contracts, provider adapters (Meta, Twilio), AES-256-GCM credential encryption, inbound persistence | None (upstream is Meta-only) | keep (fork addition: omnichannel core) |
| `lib/contacts` | Contact repositories (Supabase), phone dedupe, identities | Upstream contacts | keep — `mock-repository.ts` **removed** (Phase B) |
| `lib/currency.ts` | Currency formatting for pipelines | Upstream pipelines | keep |
| `lib/dashboard` | Dashboard data repository (Supabase) | Upstream dashboard | keep — `mock-repository.ts` **removed** (Phase B) |
| `lib/data` | Data-source runtime (`runtime.ts`) | None | needs-fix → fixed: mock branch removed, Supabase-only fail-fast (Phase B). `mock-db.ts` **removed** |
| `lib/demo` | Seeded demo CRM data | None | **removed** (Phase B, strict removal per user decision) |
| `lib/download-csv.ts` | Client CSV export | Upstream contacts export | keep |
| `lib/flows` | Visual flow graph engine, runs, templates, `meta-send.ts` (routes through orchestrator) | None in upstream snapshot | keep (fork addition: visual flows) |
| `lib/inbox` | Inbox data helpers, realtime | Upstream inbox | keep |
| `lib/navigation` | Workspace navigation model | Upstream settings/nav | keep |
| `lib/orchestration` | Outbound channel orchestrator (`outbound.ts`), delivery status mirroring (`status.ts`) | None (upstream calls Meta API directly) | keep (fork addition: provider-neutral sends; both Meta + Twilio flow through it) |
| `lib/pipelines` | Pipeline runtime + Supabase repository | Upstream Supabase Kanban | keep — `sqlite-pipeline-repository.ts` **removed** (Phase B) |
| `lib/presence.ts` | Agent presence via Supabase realtime | Upstream inbox presence | keep |
| `lib/rate-limit.ts` | Fixed-window rate limiting (upstream `RATE_LIMITS` pattern) | Same pattern upstream | keep |
| `lib/routes` / `lib/routing` | Route constants used by proxy + UI | Implicit upstream | keep |
| `lib/service-api-url.ts` | URL builder for `/api/service/*` BFF | None | flagged — only consumers are `proxy.ts` public-prefix list and `lib/routing/routes.ts`; see `server/` row |
| `lib/storage` | Supabase storage/media helpers | Upstream media | keep |
| `lib/supabase` | Browser/server/admin Supabase clients | Same upstream | keep |
| `lib/template-status.ts` | Meta template approval status mapping | Upstream templates | keep |
| `lib/themes.ts`, `lib/utils.ts` | UI theming + cn utilities | Same upstream | keep |
| `lib/webhooks` | Signed outbound webhooks for public API consumers | None | keep (fork addition: public API parity) |
| `lib/whatsapp` | Meta Cloud API client, encryption, webhook signature helper, `send-message.ts` (routes through orchestrator) | Core upstream feature | keep |

## `src/app/api/*`

| Family | Purpose | Upstream equivalent | Verdict |
| --- | --- | --- | --- |
| `api/account/**` | Account CRUD, members, invitations, API keys, ownership transfer | Partial (upstream members) | keep — mock branch **removed** (Phase B) |
| `api/ai/**` | AI config, drafts, knowledge, playground, usage, auto-reply toggle | Partial | keep |
| `api/automations/**` | Automation CRUD, engine, cron drain | Same upstream | keep — cron comparison made timing-safe (Phase D, this pass) |
| `api/channels/webhooks/meta` | Omnichannel Meta inbound webhook (per-connection app secret) | Upstream single Meta webhook | needs-fix → fixed: HMAC unified via shared `verifyMetaSignatureWithSecret` (Phase C, this pass) |
| `api/channels/webhooks/twilio` | Twilio inbound + delivery status webhook | None (fork addition) | needs-fix → fixed: signature URL now canonical (forwarded proto/host), fail-closed (Phase C, this pass) |
| `api/flows/**` | Flow CRUD, runs, templates, cron | None | keep (fork addition) |
| `api/invitations/**` | Invitation peek/redeem | Partial | keep |
| `api/quick-replies/**` | Quick reply CRUD | Upstream inbox | keep |
| `api/service/[...path]` | BFF proxy to Express internal API (bearer auth + allowlist in `server/http/auth.ts`) | None | flagged — no production consumer beyond routing plumbing; recommend removal in a future pass if the Express API stays unused |
| `api/settings/channels` | Channel connection CRUD (encrypted credentials) | Upstream WhatsApp settings | keep (fork addition: omnichannel) |
| `api/v1/**` | Public REST API (session, dashboard, notifications, workspace, contacts, conversations, messages, broadcasts, webhooks, me) | Upstream documented REST API | keep — all mock branches **removed** (Phase B) |
| `api/whatsapp/webhook` | Legacy/global Meta webhook (env `META_APP_SECRET`, fail-closed) | Core upstream webhook | keep |
| `api/whatsapp/{send,react,media,templates,config,broadcast}` | Meta send/react/media/template sync/config/broadcast | Core upstream | keep — see broadcast gap below |
| `api/demo/crm` | Seeded demo CRM endpoint | None | **removed** (Phase B) |

## `server/` (Express 5 internal API)

| Family | Purpose | Upstream equivalent | Verdict |
| --- | --- | --- | --- |
| `server/**` | Supervised Express API behind `/api/service/*`: bearer auth, allowlist, probes, logging | None (upstream is single Next.js app) | flagged — auth and allowlist verified enforced (`server/http/auth.ts`); only `src/proxy.ts` and `src/lib/routing/routes.ts` reference the BFF prefix. No page/component calls it. **Recommendation: remove in a dedicated pass unless a production consumer is identified.** Decision deferred to the user. |

## Twilio broadcast/template gap (audit only — no implementation this pass)

- **Current state:** `api/whatsapp/broadcast` calls `sendTemplateMessage` from `lib/whatsapp/meta-api` directly; broadcasts and template sync are Meta-only. The Twilio adapter (`lib/channels/adapters/twilio.ts`) already supports template sends via ContentSid, but nothing routes broadcasts through it.
- **Recommendation:**
  1. Route `api/whatsapp/broadcast` through `lib/orchestration/outbound.ts` so the provider is resolved per channel connection instead of hardcoding Meta.
  2. Add Twilio Content API template sync alongside the Meta template sync (map ContentSid ↔ template rows).
  3. Extend broadcast status mirroring to consume Twilio status callbacks (the webhook plumbing already exists via `applyMessageDeliveryStatus`).
- **Decision:** deferred to the user; do not implement until approved.

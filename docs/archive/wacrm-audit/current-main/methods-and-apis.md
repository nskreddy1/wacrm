# Methods, APIs and call graphs

This reference groups the repository’s exported methods by domain while preserving exact identifiers. For every method, its file is the signature authority; TypeScript types and Zod schemas define inputs/outputs. Local callbacks in UI files are implementation details of their owning component and follow the owning flow below.

## Cross-cutting methods

| Method | Location | Called by / calls | Behavior and failure |
| --- | --- | --- | --- |
| `proxy` | `src/proxy.ts` | Next request pipeline → Supabase SSR client | Refreshes auth and gates protected paths; missing public Supabase config prevents backend-backed auth. |
| `createClient` | `src/lib/supabase/{client,server}.ts` | pages, hooks, route handlers | Creates browser or cookie-aware server client. Server variant awaits cookie APIs. |
| `AuthProvider`, `useAuth` | `src/hooks/use-auth.tsx` | root/dashboard clients → SWR `/api/v1/session` | Supplies user/account/membership/capabilities; hook throws outside provider. |
| `DashboardCacheProvider` | `src/components/providers/dashboard-cache-provider.tsx` | dashboard layout → SWRConfig | Namespaces cache by account/path and provides shared JSON fetch/error rules. |
| `checkRateLimit` | `src/lib/rate-limit.ts` | send/sensitive routes | Fixed-window process-local map; returns/rejects on quota, not durable across instances. |
| `resolveServiceApiUrl` | `src/lib/service-api-url.ts` | service BFF | Validates explicit Express URL or derives host/port; invalid configuration fails before proxying. |

## Auth, account and authorization

`resolveAccountContext`, API-context helpers, role predicates and capability hooks are called before account-scoped work. `set_member_role`, `remove_account_member`, `transfer_account_ownership`, `peek_invitation`, and `redeem_invitation` are SQL RPC boundaries. `useCan`/role metadata convert membership role to UI capability, but server routes repeat authorization; UI hiding is not security.

Account route methods:

- `GET/PATCH /api/account`: read/update account metadata after membership/role validation.
- `GET/POST /api/account/members|invitations`: list members/invites and create invitations.
- `PATCH/DELETE /api/account/members/[userId]`: role update/removal through protected RPCs.
- `DELETE /api/account/invitations/[id]`: revoke pending invite.
- `POST /api/account/transfer-ownership`: owner-only transfer RPC.
- API key methods call key generation/hash/scope validation in `src/lib/api-keys/*`; raw keys are not stored.

## AI methods

| Module | Principal exported methods | Invocation/data flow |
| --- | --- | --- |
| `config.ts`, `validate.ts`, `defaults.ts` | provider config read/write/validation and timeout/context defaults | Settings APIs → encrypted config table; invalid provider/model/key fails before generation. |
| `generate.ts`, providers | generation abstraction | draft/playground/auto-reply → selected OpenAI/Anthropic provider → timeout/structured result → usage log. |
| `context.ts`, `query.ts`, `knowledge.ts`, `chunk.ts`, `embeddings.ts` | context assembly, retrieval, indexing/chunking/embedding | knowledge API/reindex → document/chunk tables and pgvector/FTS RPCs; retrieval is account-scoped. |
| `auto-reply.ts`, `handoff.ts`, `usage.ts` | reply eligibility/slot, handoff decision, quotas/logging | inbound orchestration → claim slot RPC → grounded generation → send or human handoff. |

Routes expose config `GET/POST/DELETE`, draft/playground/test/autoreply `POST`, knowledge CRUD/reindex, and usage `GET`. Errors use authenticated JSON responses; provider/network failures must not be presented as successful sends.

## Messaging and WhatsApp methods

`send-message.ts` orchestrates authenticated outbound messages. `meta-api.ts` owns Meta HTTP/media/resumable operations. `template-send-builder.ts`, `template-components.ts`, validators and status normalizers produce Meta-compliant payloads. `resolve-conversation.ts` deduplicates contact/conversation lookup. `webhook-signature.ts` verifies HMAC-SHA256. `encryption.ts` encrypts/decrypts credentials using AES-256-GCM and supports legacy compatibility. `interactive.ts` builds interactive message structures; reaction and reply helpers map message action state.

Routes: config `GET/POST/DELETE`, registration verify `GET`, send/react/broadcast `POST`, media `GET`, templates sync/submit/update/delete, and webhook `GET/POST`. The legacy WhatsApp route family is the mature Meta implementation; generic `/api/channels/webhooks/{meta,twilio}` normalizes provider boundaries but is not equivalent in maturity.

## Automation and Flow methods

- Automation `validate` checks trigger/action schemas; `steps-tree` converts persisted parent/position rows to executable order; `engine` selects active account automations, logs execution and schedules waits; `meta-send` performs Meta actions.
- Flow `validate` checks graph and node configurations; `edges` enforces legal transitions; `layout` computes graph placement; `engine` creates runs/events and executes nodes; `fallback` defines deterministic next behavior; `meta-send` performs transport actions.
- Ordering contract for inbound automation is **Flows → Automations → AI auto-reply**.
- Cron endpoints compare `x-cron-secret` to `AUTOMATION_CRON_SECRET` and drain due persisted work. Missing/mismatched secrets fail closed.

## Contacts, dashboard, pipelines and state methods

Contact filter/dedupe/import methods parse CSV, resolve tags and normalize phone identities before repository writes. Dashboard query/date methods create account-scoped metric projections consumed through `/api/v1/dashboard`. Pipeline `domain`, `validation`, `mappers`, actions and repository interfaces separate UI from storage. `pipeline-runtime` chooses a repository; `supabase-pipeline-repository` is production-oriented while `sqlite-pipeline-repository`, mock data and demo APIs are non-authoritative alternatives.

Flow editor methods (`FlowEditorProvider`, `useFlowEditor`, reducer-like callbacks) own nodes, edges, selection, dirty/validation state and save/activation actions. Theme methods (`ThemeProvider`, `useTheme`) own `data-theme`/`data-mode`; preferences are browser-local. Presence/realtime/unread hooks subscribe or poll account-specific resources and clean up subscriptions when identity/account changes.

## Public API contract

| Family | Methods | Scope/purpose |
| --- | --- | --- |
| `/api/v1/me` | GET | authenticated key/session identity and account. |
| `/api/v1/contacts`, `/[id]` | GET, POST, PATCH | contacts read/write with pagination/validation. |
| `/api/v1/conversations`, `/[id]`, `/messages` | GET | conversation/thread reads. |
| `/api/v1/messages` | POST | outbound message request. |
| `/api/v1/broadcasts`, `/[id]` | POST, GET | campaign create/status. |
| `/api/v1/webhooks`, `/[id]` | GET, POST, PATCH, DELETE | signed outbound webhook configuration. |
| `/api/v1/dashboard` | GET | dashboard projection. |
| `/api/v1/session` | GET, DELETE | browser session payload/sign-out. |
| `/api/v1/notifications` | GET, PATCH | list/mark notification state. |
| `/api/v1/workspace/*` | CRUD/read | UI-oriented contacts, inbox summary and automation resources. |

`createApiContext` accepts session or API key, verifies hash/status/scope, resolves account, and provides request context. Pagination methods parse bounded cursors/limits. `respond` helpers standardize data/error JSON. Webhook `sign` creates request signatures; delivery validates destinations against SSRF rules, applies retries and records failures.

## Express and BFF methods

`createApp` composes JSON limits, Helmet, Pino, health routes and domain routers. `loadConfig` uses Zod. Auth middleware extracts bearer token, asks Supabase Auth for the user, and rejects absent/invalid credentials. Context middleware creates/request-propagates `x-request-id`. Error middleware maps known HTTP errors to stable JSON. Account router methods are invoked only through the same-origin BFF today; most domains remain in Next route handlers.

## MCP methods

`loadConfig` requires a valid base URL/API key and reads write/broadcast flags. `WacrmClient` performs authenticated public API calls and normalizes API errors. Read tools expose identity, contacts, conversations, messages and broadcast status. Write tools create/update contacts and send messages only when enabled. Broadcast creation has a second explicit flag. Tool schemas validate inputs before an HTTP call; public API scopes remain authoritative.

## Failure and side-effect conventions

- Authentication failure: 401; membership/scope/role failure: 403; missing row: 404; invalid input: 400/422; conflicts/rate limits/provider failures use explicit non-2xx responses.
- Supabase writes, provider sends, storage uploads, run logs, usage logs and outbound webhooks are side effects and must be account scoped.
- SWR mutation/revalidation follows successful writes; optimistic messaging/pipeline UI must rollback or mark failure.
- Webhook and cron methods are retry-sensitive; receipt/provider IDs and persisted pending rows provide the intended idempotency boundaries.

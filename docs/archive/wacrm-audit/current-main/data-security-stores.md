# Data, security and stores

## Production authority

Supabase is the intended production system of record: Auth for users/sessions, PostgreSQL for domain data, Storage for media and Realtime for inbox/presence. The repository does not use an ORM. Migrations must be applied in numeric order; later corrections depend on earlier objects.

## Migration and object map

| Range | Objects/capability |
| --- | --- |
| `001`–`005` | `profiles`, contacts/tags/custom fields/notes, conversations/messages, WhatsApp config/templates, pipelines/stages/deals, broadcasts/recipients; timestamps, auth profile trigger, RLS, indexes and incremental broadcast counters. |
| `006`–`009` | automations/steps/logs/pending executions, execution counter RPC, `avatars` bucket, replies/reactions. |
| `010`–`016` | flows/nodes/runs/events, run constraints/counter, template/registration upgrades, `flow-media` bucket. |
| `017`–`020` | `accounts`, invitations, account IDs/memberships, `is_account_member`, member/ownership/invitation RPCs and broad account-scoped RLS corrections. |
| `021`–`025` | default currency, normalized-phone merge/index, `chat-media`, `member_presence`/`touch_presence`, tag filter RPC. |
| `026`–`030` | `api_keys`, `notifications`, `webhook_endpoints`, `ai_configs`, knowledge documents/chunks, FTS/semantic match RPCs and pgvector indexes. |
| `031`–`037` | AI grants/polish/usage log, profile privilege trigger, quick replies, conversation/contact dedupe, pipeline saved views/sub-pipelines/link table. |
| `038`–`040` | channel connections, contact identities, webhook receipts, OAuth state, notification preferences/delivery columns, provider enum/constraint expansion and conversation uniqueness correction. |

Storage buckets are `avatars`, `flow-media`, and `chat-media`. Migration policy text includes public readability for these objects; operators must verify this matches privacy requirements before production use.

## Tenancy and RLS

Core records move from legacy `user_id` ownership toward `account_id`. Membership helper functions and policies allow members to read/write account resources according to policy and role. Role-sensitive operations are also implemented through security-definer RPCs. Service-role clients bypass RLS and therefore every service-role query must include verified account identity; accepting account IDs directly from untrusted payloads is insufficient.

## Store inventory

| Store | Owner/lifetime | Readers/writers | Invalidation/durability |
| --- | --- | --- | --- |
| Supabase Auth | Supabase; session cookie/token | proxy, server/browser clients, Express auth | durable provider state; cookie refresh by proxy. |
| Supabase PostgreSQL | account/user scoped | route handlers, domain libs, RPCs | durable; transaction/RLS semantics; live application currently unverified. |
| Supabase Storage | bucket/object | avatar/flow/chat upload and media routes | durable object state; policy privacy must be verified. |
| Supabase Realtime | channel subscription | inbox/presence hooks | ephemeral stream over durable rows; reconnect/refetch required. |
| SWR cache | browser provider, account/path scoped | auth/dashboard/contacts/inbox/pipeline/settings hooks/components | memory cache; mutate/revalidate; reset/namespace on account route. |
| `AuthContext` | React tree | `AuthProvider`/`useAuth` | derived from session SWR; not persistence. |
| `ThemeContext` | browser | `ThemeProvider`/`useTheme` | theme/mode in localStorage; device scoped, UI preference only. |
| Flow editor context | editor component tree | canvas/forms/header/validation | in-memory graph state; explicit save persists. View mode is localStorage. |
| Automation resources context | builder tree | builder node controls | fetched resource snapshot; component lifetime. |
| Local component state | browser component | forms/dialogs/filters/drafts | ephemeral; save/API required for durability. |
| Rate-limit map | Node process | protected routes | fixed-window, instance-local; resets on restart and differs per replica. |
| Mock DB/repositories | Node/test/demo process | demo routes/tests | non-production, resettable/test guarded. |
| SQLite pipeline repository | local filesystem/process | pipeline runtime variant | architectural exception; not Supabase account authority. |
| MCP client state | MCP process config | registered tools/API client | no CRM persistence; remote public API owns data. |
| External providers | Meta/OpenAI/Anthropic/SMTP/etc. | adapters/routes | remote durable/ephemeral state; IDs/status synchronized to Supabase. |

Browser persistence is intentionally limited to non-sensitive theme and flow-view preferences. CRM records and credentials must never use localStorage.

## Security controls

- Password hashing and sessions are Supabase Auth responsibilities.
- `src/proxy.ts` refreshes sessions and protects application navigation.
- RLS and account membership are the primary database boundary.
- WhatsApp/provider and AI secrets are encrypted server-side; `ENCRYPTION_KEY` must be stable and secret.
- Meta inbound HMAC uses `META_APP_SECRET` and fails closed.
- API keys are random, hashed at rest and scope checked; display the raw token only at creation.
- Outbound webhooks are signed; destination validation blocks SSRF patterns and delivery records failures/retries.
- Cron endpoints require `AUTOMATION_CRON_SECRET` via request header.
- Express uses Helmet, request/body limits, structured redacted logs and health probes.
- BFF forwards an allowlist of headers, propagates request ID, applies timeout and disables caching.

## Security gaps and verification requirements

1. Apply `001`–`040` to the intended Supabase project, then enumerate tables/functions/policies/buckets and compare to this manifest.
2. Execute cross-account denial tests for every policy and service-role route.
3. Confirm bucket privacy; public chat/flow media may be unacceptable.
4. Replace process-local rate limits with shared durable throttling for horizontal scale.
5. Complete Twilio signature validation and Gmail/Microsoft OAuth state/token lifecycle before enabling those providers.
6. Confirm HTML/attachment scanning and provider retry/idempotency for email transports.
7. Rotate all leaked/suspected credentials; documentation intentionally contains names only.

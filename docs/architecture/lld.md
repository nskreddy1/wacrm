# Low-Level Design (LLD)

The "how, with real names". Every signature below is copied from the
codebase, not invented. Read `hld.md` first for the shape of the
system; read this when you are about to write code.

---

## 1. Directory layout and what each layer may do

```
src/
├── app/
│   ├── (auth)/…                 sign-in, invite redemption
│   ├── (dashboard)/             27 pages, tenant-facing
│   │   ├── settings/…
│   │   └── admin/
│   │       ├── (console)/       route group: shares the tabbed shell
│   │       │   ├── layout.tsx   super-admin gate + AdminNav
│   │       │   ├── workspaces/  tickets/  channels/  ai-agent/  platform/
│   │       └── providers/       standalone page, OWN layout + gate
│   └── api/                     115 route handlers, 19 namespaces — ALL writes
│       ├── v1/**                public, API-key authenticated
│       ├── admin/**             super-admin only, service role
│       ├── channels/webhooks/** provider ingest, signature-verified
│       └── <domain>/**          tenant-session authenticated
├── features/<domain>/
│   ├── components/              React (client + server)
│   └── lib/                     domain logic, server-only
├── lib/                         cross-cutting
│   ├── supabase/{client,server,cookie-options}.ts
│   ├── api/v1/                  public-API helpers
│   ├── data/                    RSC read helpers
│   ├── cache/keys.ts            SWR key builders
│   ├── rate-limit.ts  audit-events.ts  utils.ts
├── contracts/api.ts             shared request/response contracts
├── proxy.ts                     Next 16 middleware: session refresh + auth redirect
└── components/
    ├── ui/                      shadcn primitives
    ├── tremor/                  chart primitives
    ├── prompt-kit/              AI chat primitives
    └── themed-toaster.tsx       the single sonner mount (see §8)
```

**Layer rules**

| Layer | May do | Must never do |
|---|---|---|
| `app/**/page.tsx` | Await params, call `src/lib/data/**`, render | Mutate data |
| `app/api/**/route.ts` | Auth guard → Zod parse → rate limit → scope by `account_id` → mutate → audit | Trust any client-supplied `account_id` |
| `features/*/lib` | Domain logic, provider calls | Read cookies directly (take context as an argument) |
| `features/*/components` | UI, SWR, optimistic updates | Hold secrets or use the service-role key |
| `lib/**` | Pure/shared helpers | Import from `features/**` |

---

## 2. Auth and tenancy — the exact call chain

### 2.1 `getCurrentAccount()` — every tenant route starts here

`src/features/auth/lib/account.ts`

```ts
export const getCurrentAccount = cache(async (): Promise<AccountContext> => …)

export interface AccountContext {
  supabase: SupabaseClient       // RLS-scoped to the caller
  userId: string                 // auth.uid()
  accountId: string              // tenant boundary — use this in every filter
  role: AccountRole              // owner | admin | agent | viewer
  account: { id: string; name: string }
  permissions: readonly string[] // slugs from the workspace profile
  isOwner: boolean               // implicitly holds every permission
  status: string                 // always 'active' when resolved
  workspaceProfile: { id: string; name: string } | null
  capabilities: MemberCapabilities
}
```

Two deliberate performance choices, both documented in the source:

1. `supabase.auth.getClaims()` verifies the JWT **locally** against the
   project's public signing keys — no network hop to the Auth server,
   unlike `getUser()`. Tampered or expired tokens fail verification.
2. The `get_account_context()` RPC (migration 053) joins
   `profiles` + `accounts` in **one** query, replacing two sequential
   PostgREST round trips. It is `SECURITY INVOKER`, so RLS still
   applies.

Wrapped in React `cache()` → resolves **at most once per request**,
however many handlers call it. Request-scoped, never shared between
users.

Throws: `UnauthorizedError` (no session) · `ForbiddenError` (profile
missing account fields).

### 2.2 Role and permission guards

```ts
// src/features/auth/lib/account.ts
requireRole(min: AccountRole): Promise<AccountContext>
requirePermission(…): Promise<AccountContext>
toErrorResponse(err: unknown): NextResponse   // maps thrown errors → 401/403/400/500

// src/features/auth/lib/roles.ts   — pure, testable
roleRank(role): number
hasMinRole(role, min): boolean
isAccountRole(value): value is AccountRole
canManageMembers(role) · canEditSettings(role) · canSendMessages(role)
canViewOnly(role) · canDeleteAccount(role)

// src/features/auth/lib/permissions.ts
hasPermission(…) · deriveCapabilities(…) · isPermissionSlug(value)
```

### 2.3 Platform super-admin

```ts
// src/features/auth/lib/super-admin.ts
isSuperAdmin(email: string | null | undefined): boolean
export const requireSuperAdmin = cache(async (): Promise<SuperAdminContext> => …)
```

Used by every `/api/admin/**` route and by the two admin layouts.
Pairs with `channelAdmin()` (service role, bypasses RLS) — so the
guard is the *only* thing standing between a caller and all tenants'
data. Never add an admin route without it.

### 2.4 Public API key auth

```ts
// src/features/auth/lib/api-context.ts
requireApiKey(…): Promise<ApiKeyContext>
```

Used by `/api/v1/**`. Keys live in `api_keys` (hashed).

### 2.5 Invitations

```ts
// src/features/auth/lib/invitations.ts
generateInviteToken(): GeneratedToken     // raw token + hash
hashInviteToken(token): string            // only the hash is stored
inviteUrl(token, baseUrl): string
inviteExpiresAt(…) · clampExpiryDays(days)
```

Raw token is emailed; the DB stores only its hash. A leaked
`account_invitations` row therefore cannot be redeemed.

Three route handlers, in the order a user hits them:

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/invitations/[token]/peek` | none | workspace name + role for the confirmation screen |
| `POST /api/invitations/[token]/check-email` | none | **pre-signup address guard** (below) |
| `POST /api/invitations/[token]/redeem` | session | single-use; inserts membership, re-checks the address |

**The check-email guard exists because signup is a point of no return.**
`supabase.auth.signUp` runs the `handle_new_user` trigger *inside itself*.
On an address that does not match `invited_email`, that trigger finds no
invitation and **bootstraps a brand-new workspace**. The user then lands on
`/join`, is told the email is wrong, and is stranded holding an account they
never wanted and cannot use to accept.

So whenever `/login` or `/signup` sees `?invite=<token>`, the form calls
`check-email` **before** any Auth call. It compares server-side and returns
only `{ matches, reason }` where reason is `'expired' | 'already_accepted' |
null` — never the invited address, matching the existence-check discipline
used elsewhere in auth.

Two invariants:

- **It fails open.** An unreadable or failed response proceeds to signup,
  because redemption re-checks the address anyway (ADR-004 F1) and a network
  blip must not lock a legitimate invitee out.
- **It is never the boundary.** It only moves an unavoidable error earlier,
  to where the user can still fix it. The real enforcement stays at redemption.

---

## 3. Supabase clients — pick the right one

| Helper | File | Key | RLS | Use for |
|---|---|---|---|---|
| `createClient()` (server) | `lib/supabase/server.ts` | anon + user cookie | **enforced** | RSC reads, tenant routes |
| `createClient()` (browser) | `lib/supabase/client.ts` | anon | **enforced** | Realtime, client reads |
| `channelAdmin()` | `features/channels/lib/admin-client.ts` | service role | **bypassed** | Super-admin + webhook ingest only |
| `hasSupabaseConfig()` | `lib/supabase/server.ts` | — | — | Guard for missing env |

`channelAdmin()` is the dangerous one. Every call site must already
have passed `requireSuperAdmin()` or verified a provider webhook
signature.

---

## 4. Channels subsystem — the adapter pattern

### 4.1 The contract

`src/features/channels/lib/contracts.ts`

```ts
export interface ChannelAdapter {
  readonly provider: ChannelProvider          // meta|twilio|google|resend|smtp|microsoft|mailtrap
  readonly channel: ChannelKind               // whatsapp | email | sms
  readonly capabilities: ChannelCapabilities  // send receive healthCheck oauth testMessage
  send?(message: OutboundChannelMessage): Promise<ChannelSendResult>
  checkHealth(connection: ChannelConnection): Promise<ChannelHealth>
  sendTest?(connection, recipient): Promise<ChannelSendResult>
}

export interface OutboundChannelMessage {
  accountId: string                 // tenant scope, always present
  connection: ChannelConnection
  recipient: ChannelRecipient       // { contactId, identity, displayName? }
  contentType: ContentType
  payload?: OutboundMessagePayload
  text? · html? · subject? · mediaUrl?
  replyToExternalMessageId?: string
  idempotencyKey: string            // dedupe on provider retries
}

export interface ChannelSendResult {
  externalMessageId: string
  externalThreadId?: string
  acceptedAt: string
  providerPayload?: Record<string, unknown>
}

export interface NormalizedInboundMessage {
  provider · channel
  connectionExternalIdentity        // which of our senders received it
  externalEventId                   // idempotency key for ingest
  externalMessageId · externalThreadId?
  senderIdentity · senderName? · recipientIdentity
  subject? · text? · html? · contentType · mediaUrl?
  receivedAt · providerPayload
}
```

Every provider normalises into `NormalizedInboundMessage`, so the
inbox never learns provider-specific shapes.

### 4.2 Registry

`src/features/channels/lib/provider-registry.ts`

```ts
const PROVIDER_CHANNELS: Record<ChannelProvider, ChannelKind[]>
const PROVIDER_LABEL: Record<ChannelProvider, string>
isProviderCompatible(provider, channel): boolean
registerChannelAdapter(adapter: ChannelAdapter): void
getChannelAdapter(provider, channel): ChannelAdapter | undefined
hasChannelAdapter(provider, channel): boolean
getProviderCapabilities(provider, channel)
clearChannelAdaptersForTests(): void
```

Adapters in `features/channels/lib/adapters/`: `meta.ts`, `twilio.ts`,
`twilio-sms.ts`, `resend.ts`, `smtp.ts`, `mailtrap.ts`, registered from
`index.ts`.

### 4.3 Credentials — AES-256-GCM at rest

`src/features/channels/lib/credentials.ts`

```ts
buildProviderCredentials(…)      // shape + validate per provider
encryptProviderCredentials(…)    // → ciphertext stored in channel_connections
decryptProviderCredentials(…)    // server-only, never returned to a client
```

API responses return **masked** identities only. A decrypted secret
must never cross the network boundary to the browser.

### 4.4 Inbound pipeline

```ts
// src/features/channels/lib/inbound.ts
persistInboundChannelMessage(…)        // raw event → channel_webhook_events

// src/features/channels/lib/orchestrate-inbound.ts
orchestrateInboundChannelMessage(…)    // contact → conversation → message → triggers
```

Called from `/api/channels/webhooks/meta` and `/api/channels/webhooks/twilio`
**after** HMAC signature verification. Order matters: persist the raw
event first so a downstream bug cannot lose a customer message.

Tests: `inbound.test.ts`, `orchestrate-inbound.test.ts`,
`provider-registry.test.ts`, `omnichannel-migration.test.ts`.

### 4.5 Twilio discovery

```ts
// discovery.ts
discoverTwilioAccount(…): Promise<…>       // probe account, list senders
isDiscoveryError(error): error is DiscoveryError
// twilio-account.ts
resolveTwilioCredentials(…)
```

---

## 5. Route handler anatomy — the canonical order

Every write endpoint follows these steps. Deviating is a bug.

```ts
export async function POST(request: Request) {
  try {
    // 1. AUTH — never skip, never reorder
    const { supabase, accountId, userId } = await getCurrentAccount()
    //   admin route instead: const { … } = await requireSuperAdmin()
    //   public API instead:  const { … } = await requireApiKey(request)

    // 2. RATE LIMIT
    const rl = checkRateLimit(`send:${accountId}`, RATE_LIMITS.SEND)
    if (!rl.ok) return rateLimitResponse(rl)

    // 3. VALIDATE — Zod, reject unknown shapes
    const parsed = BodySchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('…')

    // 4. TENANT SCOPE — explicit, in addition to RLS
    const { data } = await supabase.from('t').select().eq('account_id', accountId)

    // 5. MUTATE

    // 6. AUDIT
    await logAuditEvent({ accountId, userId, action: '…', … })

    return NextResponse.json({ data })
  } catch (err) {
    return toErrorResponse(err)          // maps to 401/403/400/500
  }
}
```

### 5.1 Rate limiting

`src/lib/rate-limit.ts`

```ts
interface RateLimitOptions · interface RateLimitResult
checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult
rateLimitResponse(result: RateLimitResult): NextResponse   // 429 + Retry-After
const RATE_LIMITS = { … }                                  // named presets
__resetRateLimitForTests()
```

In-memory. **Per-instance, not global** — a serverless fleet
multiplies the effective limit. Roadmap item: move to Upstash Redis.

### 5.2 Audit

```ts
// src/lib/audit-events.ts
logAuditEvent(…): Promise<void>        // → audit_events (tenant-visible)
```

Super-admin actions additionally write `platform_audit_log`.

### 5.3 Public API helpers

`src/lib/api/v1/`

```ts
parseListParams(request: Request)
encodeCursor(row: { created_at: string; id: string }) · decodeCursor(value)
keysetFilter(cursor: Cursor | null)          // keyset pagination, not OFFSET
serializeContact(row) · serializeConversation(conv) · serializeMessage(m)
badRequest(msg) · unauthorized(msg = 'Missing or invalid API key')
forbidden(msg) · rateLimited(result) · toApiErrorResponse(err)
```

Keyset (not offset) pagination: stable under concurrent inserts and
indexed by `(created_at, id)`.

---

## 6. Read path

```ts
// src/lib/data/runtime.ts
hasSupabaseDataConfig(): boolean
getDataSource(): DataSource        // real DB vs fixture, for local/test
```

Read helpers live in `src/lib/data/{contacts,dashboard,notifications,operations}/`
and are called **directly from server components** — no self-fetch.

Other shared helpers: `lib/account/members.ts` →
`fetchAccountMembers(): Promise<AccountMember[]>`, `memberLabel(m)`.
Client cache keys: `lib/cache/keys.ts` (unit-tested in `keys.test.ts`).

---

## 7. Route inventory (115 handlers, 19 namespaces)

| Group | Guard | Routes |
|---|---|---|
| `v1/**` (28) | `requireApiKey` | contacts, conversations + messages, messages, broadcasts, dashboard, notifications, webhooks, me, session, security/{devices,login,login-activity}, workspace/{appointments,catalog,contacts,tasks,navigation,inbox/summary,automation-resources} |
| `admin/**` (12) | `requireSuperAdmin` | workspaces(+id, provision-agent), tickets(+id, messages), channels, providers, platform-settings, ai-config, assistant-config, audit |
| `account/**` (13) | `getCurrentAccount` / `requireRole` | members(+userId), invitations(+id), profiles(+id), api-keys(+id), domains/[id]/verify, email-settings, activity, transfer-ownership |
| `channels/webhooks/**` (2) | HMAC signature | meta, twilio |
| `whatsapp/**` (11) | session | send, react, broadcast, config(+verify-registration), templates/{submit,sync,twilio,[id]}, media/[mediaId], webhook |
| `ai/**` (14) | session | agents(+id), config, draft, test, playground, runs, usage, knowledge(+id, reindex), autoreply/[conversationId] |
| `flows/**` (7) | session / cron secret | flows(+id, activate, runs), cron, events, templates |
| others | session | settings/channels(+twilio-connect), templates(+test-send), support/tickets…, dashboards…, external-sources…, sms/broadcast, email/broadcast, quick-replies…, assistant/chat, invitations/[token]/{peek,redeem}, mcp/[transport] |

---

## 8. Frontend conventions

- **Server component by default.** Add `'use client'` only for state,
  effects, or event handlers. Push the boundary as deep as possible.
- **SWR for client data**, keys from `lib/cache/keys.ts`. Never fetch
  in `useEffect`.
- **Tailwind v4** — no config file. Tokens in `globals.css` under
  `@theme`. Use semantic tokens (`bg-background`, `text-foreground`),
  never raw `bg-white`.
- **Copy lives in `messages/en.json`** via next-intl. No hardcoded
  user-facing strings.
- **Charts** import from `components/ui/chart.tsx` (local wrapper:
  `ChartLegend`, `ChartTooltipContent`) plus Recharts primitives inside
  a `ResponsiveContainer`.
- **Enterprise density**: page shells use `p-4 md:p-6` with a
  `max-w-6xl` container. Titles carry the meaning; skip explanatory
  paragraphs on admin surfaces.

**Transient feedback — toasts.** All success/failure feedback goes through
**sonner**, mounted exactly once as `ThemedToaster` in the root layout
(`position="top-right"`). Do not add a second `<Toaster>`.

```tsx
toast.error('Sign-up failed', { description: message });
```

Two rules that are easy to get wrong:

- **Never render the same message inline as well.** Auth forms keep an
  `error` state solely to drive `aria-invalid` on the offending fields; the
  toast is the visible copy. `showLoginError` / `showSignupError` are the
  per-form wrappers, so sign-in and sign-up report failures identically.
- **`ThemedToaster` must force `fontFamily: 'inherit'` on the container.**
  Sonner hard-codes its own `ui-sans-serif, system-ui, …` stack on
  `[data-sonner-toaster]`, which never picks up the app's Inter. The
  override has to sit on the container, not the toast — a toast set to
  `inherit` would just inherit sonner's wrong stack from its parent. Without
  it, toasts render in whatever generic face the platform resolves that list
  to, which on some platforms is a mono-looking fallback.

---

## 9. Migrations

Plain SQL in `supabase/migrations/`, applied by
`scripts/push-supabase-schema.mjs` (idempotent — safe to re-run).

Naming: legacy `NNN_name.sql`, current `YYYYMMDDHHMMSS_name.sql`.

Checklist for a schema change:

1. Write the migration; include `account_id` on any tenant table.
2. Enable RLS and write all four policies (select/insert/update/delete)
   using `is_account_member(account_id, …)`.
3. Index every foreign key and every column used in a policy.
4. Apply, then update `database.md` (concepts) and
   `database-schema.md` (exact structure).

---

## 10. Testing

Vitest. Colocated `*.test.ts` beside the unit under test — e.g.
`rate-limit.test.ts`, `currency.test.ts`, `cache/keys.test.ts`,
`auth/lib/{account,roles,invitations,api-context}.test.ts`,
`channels/lib/{inbound,orchestrate-inbound,provider-registry,omnichannel-migration}.test.ts`.

Run: `pnpm exec vitest run` · Types: `pnpm exec tsc --noEmit`.

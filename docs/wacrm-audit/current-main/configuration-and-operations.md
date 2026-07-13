# Configuration, pinning and operations

## Environment contract

No values are recorded. `NEXT_PUBLIC_*` variables are client-visible and must never hold secrets.

| Variable | Visibility / requirement | Purpose, precedence and consumers |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public; required for real backend | Primary Supabase URL used by proxy, clients, auth UI, runtime detection and server routes. `next.config.ts` can map integration aliases. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public; required | Browser-safe anon key used by Supabase clients/proxy. Alias/publishable-key fallbacks are normalized in `next.config.ts`. |
| `SUPABASE_URL` | server fallback | Server/admin fallback if public URL is absent. |
| `SUPABASE_SERVICE_ROLE_KEY` | secret; server only | Preferred admin credential for AI/flow/automation/channel/WhatsApp server modules. |
| `SUPABASE_SECRET_KEY` | secret fallback | Alternate admin key after service-role/publishable-secret fallback chain. |
| `SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Integration naming compatibility normalized to anon public config. |
| `NEXT_PUBLIC_zepo_SUPABASE_URL`, `NEXT_PUBLIC_zepo_SUPABASE_ANON_KEY` | public compatibility | Legacy integration aliases consumed only by Next config normalization. |
| `WEB_PORT`, `PORT` | server | Next launcher port; `WEB_PORT` wins, then `PORT`, then 3000. |
| `API_HOST`, `API_PORT` | server | Express bind target; default documented as `127.0.0.1:4000`. |
| `EXPRESS_API_URL` | server optional | Explicit BFF target; otherwise derived from API host/port. |
| `NEXT_PUBLIC_SITE_URL` | public | Canonical invitation/auth redirect origin. |
| `ALLOWED_INVITE_HOSTS` | server optional | Comma-separated host allowlist for invitation link generation. |
| `NEXT_PUBLIC_APP_LOCALE` | public optional | next-intl locale, defaults to `en`. |
| `META_APP_ID` | server | Meta template/header upload operations. |
| `META_APP_SECRET` | secret; required for webhook | HMAC verification; route fails closed when missing. |
| `ENCRYPTION_KEY` | secret; required for encrypted credentials | AES key for WhatsApp/provider/AI secret envelopes; rotation requires migration strategy. |
| `AUTOMATION_CRON_SECRET` | secret | Shared header secret for automation and flow cron drains. |
| `WHATSAPP_TEMPLATES_DRY_RUN` | server optional | `true`/`1` prevents real template mutation for submit/update/delete paths. |
| `AI_REQUEST_TIMEOUT_MS` | server optional | Numeric generation timeout with code default/validation. |
| `AI_CONTEXT_MESSAGE_LIMIT` | server optional | Numeric conversation-context bound with code default/validation. |
| `WACRM_BASE_URL` | MCP required | Base URL for public REST calls; trimmed/validated. |
| `WACRM_API_KEY` | MCP secret; required | Scoped API key sent by MCP client. |
| `WACRM_ENABLE_WRITES` | MCP optional | Truthy flag registers/enables mutation tools. |
| `WACRM_ENABLE_BROADCASTS` | MCP optional | Separate truthy gate for campaign creation. |
| `NODE_ENV` | runtime | Framework mode and test-only guard enforcement. |

Provider credentials entered through Settings are stored encrypted in `channel_connections`; they are not global env requirements. AI uses per-account encrypted BYO OpenAI/Anthropic keys rather than requiring a global model key.

## Dependency and runtime pinning

- Exact direct pins: Next `16.2.6`, React/React DOM `19.2.4`, eslint-config-next `16.2.6`.
- Semver ranges: Supabase SSR `^0.12.0`, Supabase JS `^2.107.0`, Express `^5.2.1`, MCP SDK `^1.29.0`, SWR `^2.4.2`, Zod `^4.4.3`, Tailwind merge `^3.6.0`, and UI/data libraries listed in `package.json`.
- Runtime engine: Node `>=20.0.0`.
- Toolchain ranges: TypeScript `^6`, Vitest `^4.1.9`, ESLint `^9`, Tailwind `^4`, Prettier `^3.9.1`.
- Security/compatibility overrides pin minimum patched versions for `postcss`, `ip-address`, `fast-uri`, `hono`, `js-yaml`, and `@babel/core`.
- Both `pnpm-lock.yaml` and `package-lock.json` are tracked. Operational scripts call pnpm, so pnpm is the effective package-manager convention; dual lockfiles are drift risk.
- MCP has its own `package-lock.json` and package manifest, so it is independently installable/deployable.
- Database pin: migration order `001_initial_schema.sql` through `040_channel_connection_providers.sql`.
- Source pin for this report: commit `28cd0f3f7b3f5b106162bf3811abc1d5d99f376b`.

## Build and process commands

| Script | Effect |
| --- | --- |
| `pnpm dev` | Runs `dev:web` and `dev:api` concurrently. |
| `pnpm dev:web` | Loads `.env.development.local`, invokes validated Next dev launcher. |
| `pnpm dev:api` | Loads env and executes `server/index.ts` through `tsx`. |
| `pnpm build` | Next production build. |
| `pnpm start` | Supervises production web/API processes and terminates peers on failure. |
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm test` | Vitest run. |
| `pnpm lint` | ESLint repository scan. |
| `pnpm format:check` | Prettier verification. |

## Deployment topology

Deploy web and Express together only where two long-running processes and internal networking are supported; otherwise deploy Express as a separately reachable private service and set `EXPRESS_API_URL`. Health probes are `/health/live` and `/health/ready`. Preserve request IDs across reverse proxies. External schedulers must call cron endpoints with the secret header. Supabase Auth redirect URLs must include site/auth callback URLs for every environment.

## Supabase signup 403 diagnosis

`{"code":403,"error_code":"unknown","msg":"Signup is not allowed"}` means the connected Supabase project rejects new Auth users. MCP connectivity and Vercel environment synchronization do not override Auth policy. Check Supabase Authentication provider settings/allow-signups and project restrictions; existing users can still sign in if credentials and URL/key point to the intended project.

## Observability and failure handling

Express logs structured requests with sensitive header redaction and request IDs. Next/provider routes return explicit non-2xx errors. No complete distributed tracing, durable queue, dead-letter dashboard or multi-instance rate limit is implemented. Provider and cron operations should be monitored for retry storms, duplicate deliveries and stale pending executions.

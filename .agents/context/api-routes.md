# API Routes

All routes under `src/app/api/`. Conventions:
- Auth context: `getCurrentAccount()` (session + account + role) from `src/features/auth/lib/account`.
- Super admin: `requireSuperAdmin()` — throws 403; used by ALL `/api/admin/*`.
- Service role: `channelAdmin()` — bypasses RLS; MUST manually scope `account_id` (security-review rule).
- Validation: zod schema per body; `toErrorResponse(error)` for consistent errors.
- Rate limiting: `src/lib/rate-limit.ts` on sensitive/public routes.

## Namespaces

| Namespace | Purpose | Gate |
| --- | --- | --- |
| `/api/account/*` | Workspace mgmt: members, invitations, profiles, api-keys, domains, email-settings, transfer-ownership, activity | account role |
| `/api/admin/*` | Platform console: workspaces, tickets, channels (provisioning), providers (catalog/fleet/activity), ai-config, platform-settings, audit | super admin |
| `/api/ai/*` | Agents CRUD, autoreply, draft, knowledge (+reindex), playground, runs, usage, config | account |
| `/api/assistant/chat` | In-app AI assistant | account |
| `/api/channels/webhooks/{meta,twilio}` | Inbound provider webhooks — MUST verify signatures (Meta HMAC, `X-Twilio-Signature`) | signature |
| `/api/email/broadcast`, `/api/sms/broadcast`, `/api/whatsapp/*` | Channel sends, media, templates (submit/sync/twilio), reactions, webhook | account |
| `/api/external-sources/*` | CSV/external recipient sources with preview | account |
| `/api/flows/*` | Workflow CRUD, activate, runs, events ingest, cron tick, templates | account (cron: secret) |
| `/api/invitations/[token]/{peek,redeem}` | Public invite flow | token |
| `/api/mcp/[transport]` | MCP server for external AI agents | api key |
| `/api/settings/channels` (+`/twilio-connect`) | Workspace provider connection save/test/toggle; enforces `platform_provider_policies` | account admin |
| `/api/support/tickets/*` | Tenant-side support tickets | account |
| `/api/templates/*` | Template CRUD + test-send | account |
| `/api/v1/*` | Public/stable API: contacts, conversations, messages, broadcasts, webhooks, me, dashboard, notifications, session | api key or session |
| `/api/v1/security/*` | login (gated sign-in), login-activity, devices (GET list / POST touch / PATCH revoke-all / DELETE revoke-one) | session (login: anon+rate-limited) |
| `/api/v1/workspace/*` | Workspace aggregates: inbox summary, navigation, tasks, catalog, appointments, automation-resources, contacts | account |
| `/api/quick-replies`, `/api/dashboards` | Per-user/team assets | account |

## Notable flows

- **Login**: client → `POST /api/v1/security/login` (lockout check →
  Supabase password grant server-side → attempt recorded with geo →
  cookies set) → client `POST /api/v1/security/devices` (registers
  device w/ geo). Never call `signInWithPassword` from the browser.
- **Sign out everywhere**: `PATCH /api/v1/security/devices`
  `{keepCurrent:false}` → RPC deletes all `auth.sessions` →
  `DELETE /api/v1/session` clears local cookies.
- **Provider connection save**: zod → adapter exists? → platform
  policy enabled? → encrypt credentials → upsert → test.
- **Admin providers page**: `GET /api/admin/providers` returns
  `{catalog, fleet, activity}` (activity = 14-day message counts by
  channel from `admin_provider_activity` RPC, counts only, no content).

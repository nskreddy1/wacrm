# API Routes

All routes under `src/app/api/`. Conventions:
- Auth context: `getCurrentAccount()` (session + account + role) from `src/features/auth/lib/account`.
- Super admin: `requireSuperAdmin()` — throws 403; used by ALL `/api/admin/*`.
- Service role: `channelAdmin()` — bypasses RLS; MUST manually scope `account_id` (security-review rule).
- Validation: zod schema per body; `toErrorResponse(error)` for consistent errors.
- Rate limiting: `src/lib/rate-limit.ts` on sensitive/public routes.

## Namespaces

**115 route handlers across 19 namespaces.** Counts below are per namespace;
re-derive with `find src/app/api/<ns> -name route.ts | wc -l`.

| Namespace | Purpose | Gate |
| --- | --- | --- |
| `/api/account/*` | Workspace mgmt: members, invitations, profiles, api-keys, domains, email-settings, transfer-ownership, activity | account role |
| `/api/admin/*` | Platform console: workspaces, tickets, channels (provisioning), providers (catalog/fleet/activity), ai-config, `ai-models` (GET/POST model listing for a target workspace), platform-settings, audit | super admin |
| `/api/ai/*` | Agents CRUD, autoreply, draft, knowledge (+reindex), playground, runs, usage, config, `models` (GET stored-key listing / POST draft-key listing, admin) | account |
| `/api/alerts/*` (2) | `destinations` (alert delivery targets), `dispatch` (fires due alerts) | admin for destinations; `CRON_SECRET` for dispatch |
| `/api/assistant/*` (3) | In-app AI assistant: `chat`, `sessions`, `sessions/[id]` | account |
| `/api/channels/webhooks/{meta,twilio}` | Inbound provider webhooks — MUST verify signatures (Meta HMAC, `X-Twilio-Signature`) | signature |
| `/api/email/broadcast`, `/api/sms/broadcast`, `/api/whatsapp/*` | Channel sends, media, templates (submit/sync/twilio), reactions, webhook | account |
| `/api/external-sources/*` | CSV/external recipient sources with preview | account |
| `/api/flows/*` | Workflow CRUD, activate, runs, events ingest, cron tick, templates | account (cron: secret) |
| `/api/invitations/[token]/{peek,check-email,redeem}` (3) | Public invite flow. `check-email` is the pre-signup address guard: fails open, returns only `{ matches, reason }`, never the security boundary — redemption re-checks the address (see `lld.md` §2.5) | token |
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
- **Invite acceptance**: `/login?invite=<t>` or `/signup?invite=<t>` →
  `GET .../peek` (workspace name + role for the confirmation screen) →
  on submit `POST .../check-email` **before** any Supabase Auth call →
  sign-in/sign-up → `POST .../redeem` inserts the membership.
  The `check-email` hop exists because `signUp` runs `handle_new_user`
  internally, and on a mismatched address that trigger bootstraps a new
  workspace — stranding the invitee in an account they cannot use to
  accept. Guarding after sign-up would be too late to undo.
- **Sign out everywhere**: `PATCH /api/v1/security/devices`
  `{keepCurrent:false}` → RPC deletes all `auth.sessions` →
  `DELETE /api/v1/session` clears local cookies.
- **Provider connection save**: zod → adapter exists? → platform
  policy enabled? → encrypt credentials → upsert → test.
- **Model listing (ADR-005)**: `GET` lists with the account's *stored*
  key; `POST` lists with a key the operator is still *typing*, so
  first-run setup shows a provider-verified list before anything is
  saved. Both verbs on `/api/ai/models` (`requireRole('admin')`) and
  `/api/admin/ai-models` (`requireSuperAdmin()` + explicit body
  `account_id`) delegate to one shared `handleListModels()` in
  `src/features/assistant/lib/ai/list-models.ts` — the guard lives once
  so it cannot drift between verbs (ADR-005 F2). The draft key travels
  in the JSON body only: never a query string, never logged, never in a
  response, and the client's SWR cache key holds only a
  `length:last4` fingerprint (F1). Both verbs share one rate-limit
  budget. Provider failures answer `200 { models, needsKey, error?,
  code? }` — never a 500 — and only `code === 'invalid_key'` blocks the
  setup wizard; every other code warns and lets the operator continue.
- **Admin providers page**: `GET /api/admin/providers` returns
  `{catalog, fleet, activity}` (activity = 14-day message counts by
  channel from `admin_provider_activity` RPC, counts only, no content).

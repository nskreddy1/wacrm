# Database Design

Postgres on Supabase. Raw SQL migrations in `supabase/migrations/`
(numbered `001_...` early, timestamp-prefixed `2026...` later).
Apply with: `set -a && source /vercel/share/.env.project && set +a &&
node scripts/push-supabase-schema.mjs`.
Migrations are append-only — never edit an applied migration; write a
new one (see `20260726160000_fix_revoke_all_grant.sql` for the pattern).

## Domains and key tables

### Tenancy & identity
- `accounts` — workspaces (tenants). Everything hangs off `account_id`.
- `account_members` — user↔account with role; `is_account_member(account_id, roles[])` is THE RLS helper.
- `account_profiles` / permissions v2 — custom roles with granular permissions.
- `account_invitations` — token-based invites with email delivery.
- `platform_admins` — super admins for the admin console.

### Auth security (custom layer on top of Supabase Auth)
- `auth_devices` — one row per session: user_agent, ip, city/region/country, revoked_at. Deduped per device in the API.
- `login_attempts` — every gated login attempt: email, success, ip, geo. RLS: user reads own only.
- `account_lockouts` — active lockouts (5 fails/15 min → locked 15 min). Cleared on success.
- RPCs (SECURITY DEFINER, service-role only): `admin_revoke_all_auth_sessions(user, keep_session)` deletes `auth.sessions` rows = refresh-token blacklist.

### Messaging core
- `channel_connections` — provider connections per account; credentials JSON encrypted AES-256-GCM; `status`, `is_enabled`, `is_primary`, `managed_by` ('workspace'|'platform').
- `conversations` — per contact per channel; `channel` column (whatsapp|sms|email).
- `messages` — direction, status (sent/delivered/read/failed), `error_reason`, timestamps. Used by `admin_provider_activity(days)` RPC for traffic/error rollups.
- `platform_provider_policies` — provider×channel catalog switches + notes (display_name, icon_url, docs_url, sort_order customization columns).

### CRM
- `contacts` (+ lead source attribution), `pipelines`/`deals` (+ deal items), `appointments`, `catalog` products, `module_field_settings` (custom fields per module).

### Automation & AI
- `flows`, `flow_runs`, `flow_events` — unified workflow engine.
- `ai_agents` (rebuilt 20260725130000; per-agent prompts, specialist agents, single default), `ai_runs`, knowledge tables, feature-flag/telemetry cache.
- `broadcasts` + per-channel broadcast tables; `templates` (WhatsApp + email with categories); `email_opt_out`.

### Collaboration & support
- `team_chat` tables, `support_tickets` (+ admin mirror), `tenant_audit_events`, `user_dashboards`, quick replies, webhooks (v1 API consumer webhooks), `api_keys` (hashed).

## RLS model

- Default: `USING is_account_member(account_id)` for reads, role-restricted for writes.
- Personal tables (`auth_devices`, `login_attempts`): `user_id = auth.uid()` read-only; writes only via service role.
- Platform tables (`platform_provider_policies`, `platform_admins`): no tenant policies; service-role only through `requireSuperAdmin()` routes.
- SECURITY DEFINER functions: always `REVOKE ... FROM public, anon, authenticated` then `GRANT ... TO service_role`, and remember Supabase runs migrations as `supabase_admin` — the service_role GRANT must be explicit.

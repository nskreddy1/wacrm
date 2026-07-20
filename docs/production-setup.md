# Production Setup Guide

Everything you must configure before (and right after) going live, plus a final go-live checklist at the end.

---

## 1. Environment Variables

Set these in Vercel → Project → Settings → Environment Variables (Production scope).

### Required — Core (app will not run without these)

| Variable | Purpose | How to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (anon) client key | Supabase dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin key (webhooks, admin console, automations) | Supabase dashboard → Project Settings → API. **Never expose to the client.** |
| `NEXT_PUBLIC_SITE_URL` | Canonical production URL, e.g. `https://app.yourdomain.com` | Used for invite links, Twilio callbacks, OAuth redirects. No trailing slash. |
| `ENCRYPTION_KEY` | Encrypts WhatsApp/channel credentials and AI key validation proofs at rest | Generate: `openssl rand -hex 32`. **Losing it makes stored credentials unreadable.** Back it up securely. |

### Required — Channels (WhatsApp via Meta Cloud API)

| Variable | Purpose |
|---|---|
| `META_APP_SECRET` | Verifies `X-Hub-Signature-256` on incoming WhatsApp webhooks. Meta App dashboard → App Settings → Basic. |
| `META_APP_ID` | Needed for template header media uploads. Same page as above. |

### Required — Super Admin Console

| Variable | Purpose |
|---|---|
| `SUPER_ADMIN_EMAILS` | Comma-separated bootstrap allowlist (fallback OR-check with the `profiles.is_super_admin` DB flag). Example: `you@company.com` |
| `CHANNEL_CREDENTIALS_KEY` | Encrypts per-tenant channel credentials saved from `/admin/channels`. Generate: `openssl rand -hex 32` (min 16 chars). Back it up. |

### Required — Automations / Cron

| Variable | Purpose |
|---|---|
| `AUTOMATION_CRON_SECRET` | Shared secret checked by `/api/automations/cron` and `/api/flows/cron`. Generate: `openssl rand -hex 24`. Use it in the cron job's Authorization header. |

### Optional — AI

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Shared fallback Gemini key. Tenants without their own key (set in `/admin/ai-agent`) fall back to this. |
| `AI_ENGINE` | Global AI engine flag override. |
| `OLLAMA_BASE_URL` | Only if using a self-hosted Ollama endpoint. |
| `AI_REQUEST_TIMEOUT_MS` | Override AI request timeout. |
| `AI_CONTEXT_MESSAGE_LIMIT` | Override how many messages of context AI receives. |

### Optional — Misc

| Variable | Purpose |
|---|---|
| `ALLOWED_INVITE_HOSTS` | Extra allowed hostnames for invite links (defense against host-header spoofing). |
| `WHATSAPP_TEMPLATES_DRY_RUN` | Set `true` to test template submission without hitting Meta. **Must be unset/false in production.** |
| `NEXT_PUBLIC_APP_LOCALE` | Default locale (defaults to `en`). |

---

## 2. Supabase (Database & Auth)

1. **Create a dedicated production project** — do not reuse the dev project.
2. **Run all migrations in order** from `supabase/migrations/` (001 → 057 + timestamped ones). Options:
   - `supabase db push` with the CLI linked to the prod project, or
   - `node scripts/push-supabase-schema.mjs` with prod env vars.
3. **Verify RLS is enabled** on every table (all migrations create policies; spot-check `support_tickets`, `channel_configurations`, `account_invites`, `platform_audit_log`).
4. **Auth settings** (Supabase → Authentication):
   - Site URL = your production URL.
   - Redirect URLs: add `https://app.yourdomain.com/**`.
   - Enable email confirmations (recommended).
   - If using Google login: configure the Google provider with production OAuth client ID/secret, and add the production redirect URL in the Google Cloud Console.
5. **Bootstrap the super admin**: after your account signs up in production, either add your email to `SUPER_ADMIN_EMAILS`, or set the DB flag:
   ```sql
   update profiles set is_super_admin = true where email = 'you@company.com';
   ```

---

## 3. WhatsApp / Meta Cloud API

1. Create a Meta Business App with the **WhatsApp product** in **live mode** (not development).
2. Get a **permanent system-user access token** (not the temporary 24h token).
3. Configure the webhook:
   - Callback URL: `https://app.yourdomain.com/api/whatsapp/webhook`
   - Verify token: the one you save in the app's WhatsApp channel settings.
   - Subscribe to fields: `messages`, `message_template_status_update`.
4. Register your production phone number and complete **business verification** (required for messaging beyond test numbers).
5. Enter credentials per workspace in Settings → Channels (they are encrypted with `ENCRYPTION_KEY`), or centrally from `/admin/channels`.

## 4. Twilio (SMS / WhatsApp via Twilio)

See `docs/twilio-setup.md` for details. In short:

1. Buy/verify a production phone number.
2. Set the inbound webhook to `https://app.yourdomain.com/api/channels/webhooks/twilio`.
3. Enter Account SID + Auth Token per workspace (Settings → Channels or `/admin/channels`).
4. `NEXT_PUBLIC_SITE_URL` must be correct — Twilio signature validation uses it to reconstruct the callback URL.

---

## 5. Cron Jobs

Create these in Vercel → Project → Settings → Cron Jobs (or `vercel.json`), sending the secret:

| Path | Suggested schedule | Purpose |
|---|---|---|
| `/api/automations/cron?secret=<AUTOMATION_CRON_SECRET>` | every 5 min | Time-based automations |
| `/api/flows/cron?secret=<AUTOMATION_CRON_SECRET>` | every 5 min | Scheduled flow steps |

---

## 6. AI Agent (per-tenant)

Configured from the super admin console at `/admin/ai-agent`:

1. Pick the workspace, choose provider (Google Gemini / OpenAI-compatible / Ollama), model, and API key.
2. Write the system prompt (persona) for that tenant.
3. Set behaviour: enabled, auto-reply on/off, reply limits, human-handoff assignee.
4. If most tenants share one key, set `GEMINI_API_KEY` as the platform fallback instead of entering keys per tenant.

---

## 7. Security Hardening

- [ ] `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `CHANNEL_CREDENTIALS_KEY`, `META_APP_SECRET`, `AUTOMATION_CRON_SECRET` are **server-side only** (no `NEXT_PUBLIC_` prefix) and stored nowhere else.
- [ ] `ENCRYPTION_KEY` and `CHANNEL_CREDENTIALS_KEY` are backed up in a secure secret manager — rotating/losing them orphans encrypted credentials.
- [ ] `SUPER_ADMIN_EMAILS` contains only real platform operators.
- [ ] `WHATSAPP_TEMPLATES_DRY_RUN` is **not** set in production.
- [ ] Supabase email confirmations enabled; strong password policy.
- [ ] Review `platform_audit_log` access — insert-only, readable by super admins only.

---

## 8. Go-Live Checklist

Do these in order:

1. [ ] Production Supabase project created, all migrations applied, RLS spot-checked.
2. [ ] All **Required** env vars set in Vercel (sections above) for the Production environment.
3. [ ] Custom domain attached in Vercel; `NEXT_PUBLIC_SITE_URL` matches it exactly.
4. [ ] Supabase Auth Site URL + redirect URLs point at the production domain (and Google OAuth if used).
5. [ ] Deploy to production; confirm sign-up + login works.
6. [ ] Bootstrap super admin (env allowlist or `is_super_admin` flag) and confirm `/admin` loads.
7. [ ] Meta WhatsApp webhook configured and verified (green check in Meta dashboard); send a test inbound message and see it in the inbox.
8. [ ] Twilio webhook configured (if using SMS/Twilio WhatsApp); send a test SMS round-trip.
9. [ ] Configure at least one workspace's channels from `/admin/channels`; use "test connection".
10. [ ] Configure the AI agent for the first tenant from `/admin/ai-agent`; validate the API key and send a test reply in the playground.
11. [ ] Cron jobs created with `AUTOMATION_CRON_SECRET`; confirm they return 200 in Vercel cron logs.
12. [ ] Submit one WhatsApp template for approval; confirm status sync works.
13. [ ] Invite a second team member from Settings → Members; confirm the invite link works on the production domain.
14. [ ] Create a support ticket as a tenant and reply from `/admin/tickets`; confirm both directions.
15. [ ] Check `platform_audit_log` has entries for your admin actions.

---

## 9. Post-Launch Operations

- **Monitoring**: watch Vercel logs for `/api/whatsapp/webhook` and `/api/channels/webhooks/twilio` errors; failed signature checks usually mean a wrong `META_APP_SECRET` or site URL.
- **Backups**: enable Supabase PITR / daily backups on the production project.
- **Key rotation**: if you rotate `ENCRYPTION_KEY`/`CHANNEL_CREDENTIALS_KEY`, re-enter all channel credentials afterwards.
- **Meta limits**: monitor WhatsApp quality rating and messaging tier; template pacing applies to new templates.
- **Scaling invites**: invite creation is rate-limited (30/hour/account, max 20 pending) — adjust in `api/account/invitations` if needed.

# Environment variables (upstream snapshot)

> Source: https://wacrm.tech/docs/environment-variables
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

All runtime configuration lives in `.env.local` during development and in your host's environment settings in production. `.env.local.example` is a minimal template; the table below is the full reference.

## Required

| Variable | Where to find it | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Public. Shipped to the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon / public key | Public. Relies on RLS for safety. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key | Secret. Bypasses RLS. Used by webhook + admin routes only. |
| `ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | 64 hex chars (32 bytes). Rotating breaks existing tokens. |
| `META_APP_SECRET` | Meta → App Settings → Basic → App Secret | Verifies the `X-Hub-Signature-256` HMAC on every inbound webhook. Without it the webhook rejects every request — a public deploy cannot receive messages until this is set. |

## Recommended

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical public URL (e.g., `https://crm.example.com`). Used for absolute URLs, sitemap, OG images. |

## Optional

| Variable | Purpose |
| --- | --- |
| `AUTOMATION_CRON_SECRET` | Shared secret that protects `GET /api/automations/cron`. Required if you schedule the automations drain. |
| `META_APP_ID` | Meta → App Settings → Basic → App ID. Required to create/edit message templates with an image header — Meta only accepts a Resumable-Upload media handle (not a URL) as the sample, and that upload is app-scoped. Without it, image-header submission returns a clear error; everything else works. |
| `AI_REQUEST_TIMEOUT_MS` | Per-call timeout for the AI Assistant provider requests, in milliseconds. Default `30000`. |
| `AI_CONTEXT_MESSAGE_LIMIT` | How many recent text messages of a conversation the AI Assistant sends the model as context (drafts + auto-reply). Default `20`. |

The AI Assistant is bring-your-own-key — the provider key (and the optional embeddings key for knowledge-base semantic search) are saved in-app under Settings → AI Assistant and stored encrypted, so there is no API-key env var. These two only tune behaviour. The knowledge base's semantic search needs the `pgvector` extension, which migration `030_ai_knowledge.sql` enables — still no env var required.

## Sample .env.local

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# Meta App Secret — required for webhook signature verification
META_APP_SECRET=abcdef0123456789...

# Meta App ID — required for image-header message templates
META_APP_ID=1234567890

# Encryption — DO NOT change after first deploy
ENCRYPTION_KEY=3f9c0a7e4d8b2f1a6c5e8d4b9f0a2c6e8d4b9f0a2c6e8d4b9f0a2c6e8d4b9f0a

# Public URL
NEXT_PUBLIC_SITE_URL=https://crm.example.com

# Automation cron
AUTOMATION_CRON_SECRET=generate-a-long-random-string
```

## Security checklist

- Never commit `.env.local`. The repo already ignores it.
- On Hostinger Managed Node.js (and any other host), set env vars via the platform's Environment variables panel rather than writing them into a tracked file on disk.
- Rotate `SUPABASE_SERVICE_ROLE_KEY` if it leaks — Supabase lets you regenerate it under Project Settings → API.
- Treat `ENCRYPTION_KEY` like a database master key. Losing it means connected WhatsApp accounts must reconnect; rotating it means the same.

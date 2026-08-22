# Secrets inventory — NAMES AND ROTATION ONLY, NEVER VALUES

| Name | Where it lives | Used by | Rotation |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub Environment `production` | promote / rollback / preview deploy | 90 days or on incident |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Environment `production` | wrangler | n/a (identifier) |
| `SUPABASE_DB_URL` (production) | GitHub Environment `db-production` ONLY | `db-migrate.yml` ONLY (NFR-007) | on incident; never shared |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare Worker secret | server-only modules | on incident |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Worker vars | app | on Supabase key rotation |
| `ENCRYPTION_KEY` | Worker secret | `src/lib/crypto/secrets.ts` | requires re-encryption runbook |
| `CRON_SECRET` | Worker secret | cron trigger auth | 90 days |
| `META_APP_ID` / `META_APP_SECRET` | Worker secret | WhatsApp webhook HMAC | per Meta policy |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Worker secret | Upstash Redis adapter | 90 days |
| `LOKI_URL` / `LOKI_TOKEN` (optional) | Worker secret | observability logger | 90 days |
| `SENTRY_DSN` (optional) | Worker var | error adapter | on incident |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` (optional) | Worker secret | AI tracing decorator | 90 days |

Rules: no secret value is ever committed anywhere in this repo or the app
repo; developer/agent machines never hold production values; the production
DB URL exists in exactly one place.

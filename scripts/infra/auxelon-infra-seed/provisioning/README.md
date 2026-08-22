# Provisioning — idempotent setup scripts

Every script here must be safe to run twice (create-if-missing, never
mutate-if-present without a flag).

| Script | Purpose |
| --- | --- |
| `github-settings.sh` | Branch protection on the default branch, `prod` ruleset (bot-only bypass), `production` + `db-production` Environments — copied from the app repo's `scripts/infra/task9-github-settings.sh` at split time |
| (future) `cloudflare.sh` | Worker, Hyperdrive config (ONE binding, direct — non-pooled — Supabase connection string), cron triggers |

Manual founder steps that cannot be scripted (tokens, approvals) live in the
app plan's Task 11 checklist.

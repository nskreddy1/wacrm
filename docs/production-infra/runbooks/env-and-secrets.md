# Runbook — Cloudflare + GitHub environment and secret setup (Task 11)

Everything the founder must create by hand before the first production
promotion can succeed. Nothing here can be done by an agent: these are
account-level resources and real secret values.

Source of truth for key **names** is `.env.production.example` (validated by
`scripts/check-env-completeness.mjs`). This runbook says _where each name's
value has to be typed_, which the manifest deliberately does not.

Convention below:

- **Required** — promotion fails without it (`check-env-completeness --runtime`).
- **Optional** — the feature no-ops or fails closed when absent; promotion
  still succeeds.

---

## 0. Cloudflare resources to create first (not env vars)

These are objects in the Cloudflare dashboard, and two of them produce values
used further down.

| #   | Resource                                                                      | Why                                       | Produces                |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------- | ----------------------- |
| 1   | Cloudflare account                                                            | everything                                | `CLOUDFLARE_ACCOUNT_ID` |
| 2   | Workers service named **`auxelon-app`**                                       | must match `wrangler.jsonc` `name`        | —                       |
| 3   | **Hyperdrive config** over the **direct** Supabase Postgres connection string | all production SQL routes through it      | Hyperdrive **id**       |
| 4   | API token (§1)                                                                | CI deploys                                | `CLOUDFLARE_API_TOKEN`  |
| 5   | Custom domain / route on the Worker                                           | `NEXT_PUBLIC_SITE_URL` must resolve to it | —                       |

**Hyperdrive, two non-negotiables:**

- Use the **direct** Supabase connection string (`db.<ref>.supabase.co:5432`),
  **never** the Supavisor pooler. Pooling on top of pooling is the documented
  failure mode.
- Paste the resulting id into `wrangler.jsonc`, replacing the placeholder:

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<set-in-task-11>" }]
```

That placeholder is a **hard blocker** — `wrangler deploy` fails while it is
still there. It is committed config, not a secret, so it goes in a normal PR.

`DATABASE_URL` is **not** set in production. Production SQL uses the
`HYPERDRIVE` binding (`src/lib/db/client.ts`); `DATABASE_URL` is dev/CI only.

---

## 1. Cloudflare API token scopes

Create at **My Profile → API Tokens → Create Token**. Start from the
_Edit Cloudflare Workers_ template, which grants what is needed:

| Scope            | Level   | Permission |
| ---------------- | ------- | ---------- |
| Workers Scripts  | Account | Edit       |
| Account Settings | Account | Read       |
| Workers Routes   | Zone    | Edit       |
| Hyperdrive       | Account | Read       |

Scope the token to the **single** account and the **one** zone serving the app.
An account-wide token is a lateral-movement tool if a runner is ever
compromised.

---

## 2. Cloudflare Worker secrets — runtime

These are what the running app reads. Set with `wrangler secret put` (values
are prompted for, never passed as arguments — an argument lands in shell
history):

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put ENCRYPTION_KEY
wrangler secret put CRON_SECRET
wrangler secret put KV_REST_API_TOKEN
```

| Key                         | Req          | Where to get it                                                                                                                                                         |
| --------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | Supabase → Project Settings → API. Bypasses RLS — Worker secret only, never client-side.                                                                                |
| `ENCRYPTION_KEY`            | **Required** | Generate: `openssl rand -hex 32` (64 hex chars = AES-256). Encrypts every stored third-party credential. **Losing this makes all stored tenant secrets unrecoverable.** |
| `CRON_SECRET`               | **Required** | Generate: `openssl rand -hex 32`. Authenticates the `0 0 * * *` trigger against `/api/flows/cron`.                                                                      |
| `KV_REST_API_TOKEN`         | **Required** | Upstash → Redis database → REST API.                                                                                                                                    |
| `META_APP_SECRET`           | Optional     | Meta App Dashboard → Settings → Basic. Absent: WhatsApp webhook signature verification fails **closed**.                                                                |

### Non-secret runtime vars

`NEXT_PUBLIC_*` values are inlined into the bundle at build time by CI (§3),
so they are not secrets. Still declare them in the Worker's plain-text `vars`
so server-side reads resolve identically at runtime:

| Key                              | Req          | Notes                                                                                                    |
| -------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | **Required** | `https://<ref>.supabase.co`                                                                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | **Required** | RLS-protected public key                                                                                 |
| `NEXT_PUBLIC_SITE_URL`           | **Required** | The custom domain from §0.5, no trailing slash. Wrong value breaks auth redirects and webhook callbacks. |
| `KV_REST_API_URL`                | **Required** | Upstash REST endpoint                                                                                    |
| `META_APP_ID`                    | Optional     | pairs with `META_APP_SECRET`                                                                             |
| `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` | Optional     | Cloudflare Web Analytics                                                                                 |

---

## 3. GitHub — repository-level secrets

Needed by **`preview-deploy.yml`**, which runs on PRs with **no**
`environment:` block and therefore cannot see environment-scoped secrets.

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

| Key                     | Req          | Notes                        |
| ----------------------- | ------------ | ---------------------------- |
| `CLOUDFLARE_API_TOKEN`  | **Required** | from §1                      |
| `CLOUDFLARE_ACCOUNT_ID` | **Required** | Cloudflare dashboard sidebar |

`GITHUB_TOKEN` is injected automatically — **do not create it.**

---

## 4. GitHub Environment `production`

Gates `promote-to-prod.yml` and `rollback-production.yml`. Create it with
**required reviewers** (that approval _is_ the release gate) — see
`runbooks/github-settings.md`.

CI reads these to run `check-env-completeness --runtime` and the OpenNext
build, so the names must match §2 exactly. A value present in Cloudflare but
missing here fails promotion even though the app would have run.

**Variables** (`gh variable set --env production`):

```
NEXT_PUBLIC_SUPABASE_URL          Required
NEXT_PUBLIC_SUPABASE_ANON_KEY     Required
NEXT_PUBLIC_SITE_URL              Required
KV_REST_API_URL                   Required
META_APP_ID                       Optional
```

**Secrets** (`gh secret set --env production`):

```
SUPABASE_SERVICE_ROLE_KEY         Required
ENCRYPTION_KEY                    Required   ← same value as the Worker secret
CRON_SECRET                       Required   ← same value as the Worker secret
KV_REST_API_TOKEN                 Required
META_APP_SECRET                   Optional
CLOUDFLARE_API_TOKEN              Required   (also repo-level, for §3)
CLOUDFLARE_ACCOUNT_ID             Required
```

`ENCRYPTION_KEY` and `CRON_SECRET` **must be byte-identical** to the Worker
secrets. Two different values means CI validates one key while the app runs
another — the app boots and then fails to decrypt live tenant data.

---

## 5. GitHub Environment `db-production`

Gates `db-migrate.yml` (manual dispatch, approval required). This environment
is the **sole** holder of the production database URL (NFR-007).

| Key               | Req          | Notes                                      |
| ----------------- | ------------ | ------------------------------------------ |
| `SUPABASE_DB_URL` | **Required** | Direct Supabase Postgres connection string |

Never add this as a repo secret, never to `production`, never to the Worker,
never to a developer machine. Migrations are the only thing that gets it.

---

## 6. Optional — observability and payments

All no-op when absent (NFR-003). Add only when the backing account exists.

**Observability** → Worker secrets: `LOKI_URL`, `LOKI_TOKEN`, `SENTRY_DSN`,
`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.

**Payments (ADR-009)** — partial config is treated as **no** config, by
design: a key id without a webhook secret could take real money while being
structurally unable to verify the webhook that grants access.

Set `PAYMENTS_PROVIDER` and `PAYMENTS_ENVIRONMENT` (`test` | `live` —
configured, never inferred), then **all three** of the matching set:

```
RAZORPAY_LIVE_KEY_ID  RAZORPAY_LIVE_KEY_SECRET  RAZORPAY_LIVE_WEBHOOK_SECRET
RAZORPAY_LIVE_ACCOUNT_ID          ← required at go-live (account-consistency check)
```

`RAZORPAY_*_WEBHOOK_SECRET_PREVIOUS` is set **only** during a secret
rotation, then removed once no retries can still rely on the old secret
(Razorpay's retry window is 24h).

---

## 7. Verification order

Do not skip ahead; each step's failure is only diagnosable in isolation.

```text
1. wrangler whoami                        → token + account resolve
2. Hyperdrive id committed to wrangler.jsonc
3. Open a PR                              → CI + Security + AI Review + Preview all run
                                            (they trigger on the release branch)
4. Preview URL responds, authenticated smoke test passes
5. Merge                                  → promote-to-prod waits for approval
6. Approve                                → check-env-completeness --runtime passes
7. Production URL serves; cron fires at 00:00 UTC
```

If step 3 produces **no** workflow runs, the `on: branches:` triggers and the
release branch name have diverged — see `runbooks/github-settings.md`.

---

## Cost posture

Everything above fits Cloudflare's **free** tier (Workers 100k req/day,
Hyperdrive 100k queries/day). First paid step is Workers Paid ($5/mo, 10M
req/mo) when CPU limits, request quota, or log retention bite.

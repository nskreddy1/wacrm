# Production Infrastructure Implementation Plan (ADR-INFRA-001 + 002 Phase 0 + 003)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the app from "CI on main, no CD, no production" to a gated,
immutable, one-person-operable Cloudflare Workers production pipeline —
implementing ADR-INFRA-001 (deployment), ADR-INFRA-002 Phase 0 (DB/auth
boundary), and ADR-INFRA-003 (repo split + agent protocol), including all
adoptions from the second external review (ADR-003 §8).

**Architecture:** Build-once artifact promoted `main → prod → Cloudflare
Workers` via SHA-pinned, concurrency-serialized workflows that call immutably
pinned reusable workflows in `auxelon-infra`. All vendor SDKs live behind
adapters (`src/lib/db/`, `src/lib/auth-provider/`, `src/lib/observability/`,
`src/lib/cache/`, `src/lib/realtime/`). Architecture rules are CI-enforced
(`check:architecture`), not Markdown-enforced.

**Tech Stack:** Next.js 16 (App Router), `@opennextjs/cloudflare`, Cloudflare
Workers + Hyperdrive, Supabase (Postgres + RLS), postgres-js, pino → Grafana
Loki, Sentry, Langfuse (env-gated), Upstash Redis, GitHub Actions + GitHub
Models.

## Global Constraints

- **Sequencing is part of the decision.** Task order below is final (external
  review §18): the DB/auth boundary baseline (Task 2) lands **before** infra
  scaffolding, because it establishes the boundaries everything else preserves.
- **Task 1 is a hard gate.** Nothing after it starts until the authenticated
  smoke test passes under the OpenNext runtime. Compiling is not passing.
- Migrations are **idempotent**, named `YYYYMMDDHHMMSS_description.sql`, never
  edited after landing. After any schema change: `pnpm db:push` → `pnpm db:doc`
  → `pnpm docs:sync`. Destructive changes follow **expand → migrate → contract**
  (ADR-003 §5.2).
- **Agents never touch the production DB** (ADR-003 §5.3). Every `db:push` in
  this plan targets the development database. The production `SUPABASE_DB_URL`
  is created only inside the `db-production` GitHub Environment in Task 9.
- `src/lib/db/` stays **boring**: `client.ts`, `sql.ts`, `transaction.ts`,
  `errors.ts` and nothing else. No query builder, no ORM ambitions.
- Cache authority: `Redis = shared cache; memory = best-effort optimization;
  database = source of truth`. In-memory values never feed authorization.
- Boundary/architecture checks start in **warn mode with a baseline**; flip to
  error only when the baseline is near zero.
- Run `pnpm check` before declaring any task done.
- **Execution log (required):** every completed task appends an entry to
  `docs/superpowers/plans/2026-08-22-production-infrastructure.log.md`:
  date, task number, what was done, verification output summary, commit SHA,
  deviations from plan (if any). The log is the audit trail of what we actually
  did versus what we planned.

---

## Task 0: Snapshot backup

**Files:** none (git only).

- [ ] **Step 1: Create and push the backup branch**

```bash
git checkout main && git pull
git branch backup/pre-infra-2026-08-22
git push origin backup/pre-infra-2026-08-22
```

- [ ] **Step 2: Start the execution log**

Create `docs/superpowers/plans/2026-08-22-production-infrastructure.log.md`:

```md
# Execution log — production infrastructure plan

| Date | Task | Summary | Verification | Commit | Deviations |
| --- | --- | --- | --- | --- | --- |
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(infra): start execution log for production infra plan"
```

---

## Task 1: `proxy.ts` → `middleware.ts` OpenNext compatibility (HARD GATE)

The OpenNext Cloudflare adapter does not recognize Next 16's `proxy.ts`
filename; deploying as-is silently ships with auth redirects and session
refresh disabled (ADR-001 §3). Re-check adapter release notes first in case
`proxy.ts` support has landed — if it has, record that in the log and skip the
re-export.

**Files:**
- Create: `src/middleware.ts`
- Read (unchanged): `src/proxy.ts`

- [ ] **Step 1: Re-export under the recognized filename**

```ts
// src/middleware.ts
// OpenNext Cloudflare adapter compatibility: the adapter only picks up the
// `middleware.ts` filename, not Next 16's `proxy.ts` (ADR-INFRA-001 §3).
// The implementation stays in proxy.ts; this file only re-exports it.
export { default, config } from "./proxy"
```

Adjust the re-export to match `src/proxy.ts`'s actual exports (named
`proxy`/`middleware` function vs default; `config` matcher) — read the file
first, do not assume.

- [ ] **Step 2: Verify no double-execution locally**

Run: `pnpm dev` — confirm middleware runs once per request (add a temporary
`console.log("[v0] middleware hit")`, then remove it).

- [ ] **Step 3: Authenticated smoke test criteria (executed on the Task 6 preview deploy, defined now)**

All five must pass under the OpenNext runtime before first production
promotion — record results in the execution log:

```text
1. Anonymous request  → public page renders; protected route redirects to login
2. Authenticated request → dashboard renders with session
3. Protected route    → RLS-scoped data appears (correct account only)
4. Session refresh    → expired access token refreshes without logout
5. Logout             → session cleared; protected route redirects again
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm check
git commit -m "feat(infra): middleware.ts re-export for OpenNext compatibility (ADR-001 §3)"
```

---

## Task 2: DB/auth boundary baseline (ADR-002 Phase 0 — moved ahead of infra code)

**Files:**
- Create: `src/lib/db/client.ts`, `src/lib/db/sql.ts`, `src/lib/db/transaction.ts`, `src/lib/db/errors.ts`
- Create: `src/lib/auth-provider/index.ts`
- Create: `supabase/migrations/<timestamp>_current_app_user_id.sql`
- Modify: `scripts/check-boundaries.mjs` (+ baseline file `scripts/boundaries-baseline.json`)
- Modify: `.agents/context/database.md` (repository rules)

- [ ] **Step 1: Install the driver**

```bash
pnpm add postgres
```

- [ ] **Step 2: `src/lib/db/` (boring, four files)**

```ts
// src/lib/db/client.ts
// The ONLY place that knows how to reach Postgres.
// Supavisor transaction pooler today (port 6543) → Hyperdrive later:
// swap DATABASE_URL, nothing else (ADR-001 §7.2, ADR-002 §3.2).
import postgres from "postgres"

let client: ReturnType<typeof postgres> | null = null

export function db() {
  if (!client) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set")
    client = postgres(url, {
      prepare: false, // REQUIRED for transaction-mode pooling (ADR-001 §7.2)
      max: 5,
    })
  }
  return client
}
```

```ts
// src/lib/db/sql.ts
// Parameterized-only tagged-template helper with query timing hooks
// (ADR-001 §7.1). Repositories import this, never postgres directly.
import { db } from "./client"

export async function sql<T = unknown>(
  strings: TemplateStringsArray,
  ...params: unknown[]
): Promise<T[]> {
  const start = performance.now()
  try {
    return (await db()(strings, ...(params as never[]))) as T[]
  } finally {
    const ms = performance.now() - start
    if (ms > 100) {
      // slow-query visibility; logger adapter arrives in Task 5
      console.warn(JSON.stringify({ level: "warn", msg: "slow_query", ms: Math.round(ms) }))
    }
  }
}
```

`transaction.ts`: a `withTransaction(fn)` helper over `db().begin()`.
`errors.ts`: map driver errors to typed app errors (`UniqueViolation`,
`ForeignKeyViolation`, `SerializationFailure`).

- [ ] **Step 3: Auth-provider facade**

```ts
// src/lib/auth-provider/index.ts
// Session facade (ADR-002 §3.2): backed by Supabase Auth today, swappable
// later. New code MUST use this; direct supabase.auth.* is a boundary
// violation outside this module.
import "server-only"

export type SessionUser = { id: string; email: string | null }

export async function getSessionUser(): Promise<SessionUser | null> {
  /* wrap the existing Supabase server client here */
}

export async function requireAccountMember(accountId: string): Promise<SessionUser> {
  /* getSessionUser + is_account_member check; throw typed 401/403 */
}
```

Implement against the repo's existing Supabase server-client helper (find it
with `grep -rn "createServerClient" src/lib/`).

- [ ] **Step 4: `current_app_user_id()` migration + `is_account_member` refactor**

```sql
-- supabase/migrations/<timestamp>_current_app_user_id.sql
-- Portability shim (ADR-002 §3.3): isolates the caller-identity lookup so a
-- future non-Supabase host changes ONE function body, not 88 tables of policies.
-- Zero behavior change today.
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT auth.uid();
$$;

-- Refactor is_account_member to call current_app_user_id() instead of
-- auth.uid() directly (CREATE OR REPLACE with the existing body, substituting
-- the call — read the current definition from db:doc first).
```

Run: `pnpm db:push && pnpm db:doc && pnpm docs:sync` (development DB only).

- [ ] **Step 5: Boundary check in warn mode with baseline**

Extend `scripts/check-boundaries.mjs`: flag `@supabase/*` (and
`@/lib/supabase`) imports outside the allowlist
`src/lib/db/, src/lib/auth-provider/, src/lib/realtime/, src/lib/storage/,
src/lib/supabase*`. Write current violations (~112 files) to
`scripts/boundaries-baseline.json`; **new** violations fail, baselined ones
warn. Print the baseline count so shrinkage is visible in every CI run.

- [ ] **Step 6: Document, verify, commit, log**

Add the repository rules to `.agents/context/database.md` (rules 1–5 from
ADR-002 §3.1, plus the prod-DB prohibition from ADR-003 §5.3).

```bash
pnpm check
git commit -m "feat(db): portability foundations — db adapter, auth facade, uid shim, boundary baseline (ADR-002 Phase 0)"
```

---

## Task 3: Cloudflare / OpenNext scaffolding

**Files:**
- Create: `wrangler.jsonc`, `open-next.config.ts`, `.env.production.example`, `scripts/check-env-completeness.mjs`
- Modify: `package.json` (deps + scripts), delete `vercel.json` cron entry
- Remove usage then packages: `@vercel/analytics`, `@vercel/speed-insights`

- [ ] **Step 1: Dependencies**

```bash
pnpm add -D @opennextjs/cloudflare wrangler
```

- [ ] **Step 2: `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "auxelon-app",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  // Run near the Supabase region — cuts multi-query latency from hundreds of
  // ms to single digits (ADR-001 §7.2). Set to the actual project region.
  "placement": { "mode": "smart" },
  "observability": { "logs": { "enabled": true } },
  // Replaces the vercel.json cron for /api/flows/cron
  "triggers": { "crons": ["*/5 * * * *"] },
  "hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "<set-in-task-9>" },
    { "binding": "HYPERDRIVE_NOCACHE", "id": "<set-in-task-9>" }
  ]
}
```

Copy the cron schedule from the current `vercel.json` — do not invent one.

- [ ] **Step 3: `open-next.config.ts`**

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare"
export default defineCloudflareConfig({})
```

- [ ] **Step 4: Remove Vercel-only packages** (usage first, then packages):
find `<Analytics/>` / `<SpeedInsights/>` usages, remove them, then
`pnpm remove @vercel/analytics @vercel/speed-insights`. Delete the `crons` key
from `vercel.json` (delete the file if that empties it).

- [ ] **Step 5: Env completeness check**

`scripts/check-env-completeness.mjs`: parse `.env.production.example` keys and
fail if any is missing from the environment (used by the promotion gate).
`.env.production.example` lists **names only, no values** — every runtime var
the Worker needs.

- [ ] **Step 6: Verify + commit**

```bash
pnpm check
npx opennextjs-cloudflare build   # must produce .open-next/worker.js
git commit -m "feat(infra): Cloudflare Workers scaffolding — wrangler, open-next, env check (ADR-001 §3)"
```

---

## Task 4: Health endpoints — liveness/readiness split (ADR-003 §8.1)

**Files:**
- Create: `src/app/api/health/route.ts`
- Create: `src/app/api/health/dependencies/route.ts`

- [ ] **Step 1: Liveness — fast, no external calls**

```ts
// src/app/api/health/route.ts
// LIVENESS ONLY. Answers "is the Worker alive?" — never calls Supabase/Redis.
// Uptime monitors point here; dependency degradation must not read as
// "application dead" (ADR-003 §8.1).
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({
    ok: true,
    release: process.env.RELEASE_VERSION ?? "dev",
    git_sha: process.env.GIT_SHA ?? "dev",
  })
}
```

- [ ] **Step 2: Readiness — dependency health**

```ts
// src/app/api/health/dependencies/route.ts
// READINESS. Checks critical dependencies with short timeouts; degraded ≠ dead.
export const dynamic = "force-dynamic"

async function check(name: string, fn: () => Promise<unknown>, timeoutMs = 1500) {
  const start = performance.now()
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ])
    return { name, ok: true, ms: Math.round(performance.now() - start) }
  } catch (e) {
    return { name, ok: false, ms: Math.round(performance.now() - start), error: e instanceof Error ? e.message : "unknown" }
  }
}

export async function GET() {
  const results = await Promise.all([
    check("supabase", async () => {
      const { sql } = await import("@/lib/db/sql")
      await sql`SELECT 1`
    }),
    check("redis", async () => {
      /* PING via the existing Upstash client from src/lib/rate-limit.ts */
    }),
  ])
  const ok = results.every((r) => r.ok)
  return Response.json({ ok, checks: results }, { status: ok ? 200 : 503 })
}
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm check
curl localhost:3000/api/health && curl localhost:3000/api/health/dependencies
git commit -m "feat(infra): liveness + readiness health endpoints (ADR-001 §6, ADR-003 §8.1)"
```

---

## Task 5: Observability + cache adapters

**Files:**
- Create: `src/lib/observability/logger.ts`, `errors.ts`, `correlation.ts`, `langfuse.ts`
- Create: `src/lib/cache/redis-cache.ts`, `src/lib/realtime/index.ts`
- Create: `src/app/api/vitals/route.ts`, `src/components/providers/analytics-provider.tsx`

- [ ] **Step 1: Correlation vocabulary first (ADR-003 §8.2)**

```ts
// src/lib/observability/correlation.ts
// The ONE shared vocabulary propagated HTTP → webhook → queue → AI call → DB.
export type Correlation = {
  request_id: string
  trace_id?: string
  account_id?: string
  user_id?: string
  operation?: string
  route?: string
  release_version?: string
  git_sha?: string
}
```

- [ ] **Step 2: Logger** — `logger.ts`: pino wrapper (already a dependency),
child-logger per request carrying `Correlation`, secret/PII redaction
(`redact` paths for tokens, phone numbers, emails), transport = HTTP push to
Loki gated on `LOKI_URL`/`LOKI_TOKEN` (no-op console JSON otherwise). Wire into
the hot paths: WhatsApp webhook, auto-reply, cron, `/api/v1`.

- [ ] **Step 3: Errors** — `errors.ts`: `captureError(err, correlation)` over
`@sentry/nextjs` (Cloudflare-compatible init), no-op when `SENTRY_DSN` absent.
Feature code imports this module, never `@sentry/*`.

- [ ] **Step 4: Langfuse adapter with explicit PII policy (ADR-003 §8.3)**

`langfuse.ts` — env-gated no-op; header comment is the policy:

```text
SAFE TO LOG:   model id, latency, token counts, cost, operation, account_id
REDACTED:      prompt/completion text (replaced with length + sha256 hash)
HASHED:        contact identifiers (phone numbers) when needed for joins
NEVER STORED:  raw customer messages, auth tokens, webhook signatures
Raw conversation logging requires a per-account opt-in flag; default OFF.
```

- [ ] **Step 5: Cache with authority rule**

`src/lib/cache/redis-cache.ts`: `get/set/del` + TTL over Upstash Redis;
in-memory `Map` fallback when Redis is absent. Module header states:
`Redis = shared cache; memory = best-effort per-isolate optimization; database
= source of truth. NEVER cache permissions, billing, auth, or security state
in memory` — and the API enforces it with an allowlist of cache namespaces
(`ai-provider-config`, `account-settings`, `channel-config`).

- [ ] **Step 6: Realtime adapter** — `src/lib/realtime/index.ts`:
`subscribe(channel, handler): Unsubscribe` over the Supabase Realtime SDK;
migrate the 4 existing `.channel()` call sites to it.

- [ ] **Step 7: Vitals + analytics** — `/api/vitals` accepts `web-vitals`
POSTs (LCP/CLS/INP) → logger; `analytics-provider.tsx` mounts Cloudflare Web
Analytics via env-gated token. Replaces the removed Vercel packages.

- [ ] **Step 8: Verify + commit**

```bash
pnpm check && pnpm test
git commit -m "feat(observability): logger, errors, langfuse, cache, realtime adapters + vitals (ADR-001 §6-8)"
```

---

## Task 6: Workflows (immutable promotion identity)

**Files:**
- Create: `.github/workflows/security.yml`, `ai-review.yml`, `preview-deploy.yml`, `promote-to-prod.yml`, `rollback-production.yml`, `db-migrate.yml`
- Create: `scripts/generate-release-manifest.mjs`

Until `auxelon-infra` exists (Task 7), write these as self-contained; Task 7
extracts the reusable bodies. Production-sensitive `uses:` references are then
pinned to full commit SHAs; others to immutable tags (ADR-003 §6).

- [ ] **Step 1: `security.yml`** — PR + push to `main`: gitleaks,
`pnpm audit --audit-level high`, `osv-scanner` (NOT `dependency-review-action`
— requires GHAS on private repos, ADR-001 §4.4).

- [ ] **Step 2: `ai-review.yml`** — GitHub Models with `models: read`
permission; structured JSON output; the check (not the LLM prose) decides
pass/fail; blocking only on: security vulnerability, leaked secret, RLS
bypass, unsafe SQL, critical dependency issue (ADR-001 §4.3).

- [ ] **Step 3: `preview-deploy.yml`** — PR to `main`: OpenNext build +
`wrangler versions upload` → preview URL as PR comment. The Task 1 smoke test
runs against this.

- [ ] **Step 4: `promote-to-prod.yml`** — the gate. The two non-negotiables:

```yaml
concurrency:
  group: production-promotion
  cancel-in-progress: false

jobs:
  promote:
    environment: production   # manual approval
    steps:
      - uses: actions/checkout@v4
        with:
          # NEVER current main HEAD — the race ships untested code (ADR-001 §4.1)
          ref: ${{ github.event.workflow_run.head_sha }}
```

Then: env completeness → typecheck → tests → OpenNext build → upload artifact
→ `scripts/generate-release-manifest.mjs` (git_sha, artifact_sha256,
migration_version, open_next_version, node/pnpm versions, timestamp, **infra
workflow ref used** — ADR-003 §6) → fast-forward `prod` → tag + GitHub Release
→ deploy the SAME artifact with `wrangler deploy`.

- [ ] **Step 5: `rollback-production.yml`** — manual dispatch; inputs: tag +
typed confirmation string; resets `prod` to the tag and redeploys the exact
stored artifact — **no rebuild**.

- [ ] **Step 6: `db-migrate.yml`** — manual dispatch; environment
`db-production` (approval required); destructive gate: if the migration diff
matches `DROP |ALTER .*TYPE|DELETE FROM|TRUNCATE` or the PR carried
`[destructive-migration]`, require a second typed confirmation input. This
workflow is the ONLY thing that ever holds the production `SUPABASE_DB_URL`
(ADR-003 §5.3).

- [ ] **Step 7: Verify + commit** — `actionlint` on all workflows, `pnpm check`.

```bash
git commit -m "feat(ci): gated promotion pipeline — security, ai-review, preview, promote, rollback, db-migrate (ADR-001 §4)"
```

---

## Task 7: Repo split execution (requires founder approval — creates repos)

**Files:** none in this repo except `AGENTS.md` additions; creates two GitHub repos.

- [ ] **Step 1: Mirror `wacrm` → `auxelon-app`** (history-preserving, ADR-003 §3)

```bash
gh repo create nskreddy1/auxelon-app --private
git clone --mirror https://github.com/nskreddy1/wacrm.git
cd wacrm.git && git push --mirror https://github.com/nskreddy1/auxelon-app.git
```

- [ ] **Step 2: Scaffold `auxelon-infra`** per ADR-003 §1: reusable workflows
extracted from Task 6 bodies, `runbooks/` (rollback, db-migrate, incident,
migration-rehearsal placeholders), `provisioning/` (idempotent setup scripts +
docs), `secrets-inventory.md` (names/rotation only), `architecture/` (ADR
mirrors), `AGENTS.md`. Publish the first immutable tag (`v1.0.0`); record the
"never move/delete a published tag" rule in its `AGENTS.md`.

- [ ] **Step 3: Re-point the app's thin callers** to
`nskreddy1/auxelon-infra/.github/workflows/*@v1.0.0` (normal) and
`@<full-sha>` (promote/rollback/db-migrate).

- [ ] **Step 4: `AGENTS.md` protocol sections in both repos** — verbatim from
ADR-003 §5: context order, DB-change protocol (incl. expand→migrate→contract),
production-DB prohibition, cross-repo protocol, "no future production
development in wacrm".

- [ ] **Step 5: Archive `wacrm`** — final README note pointing to
`auxelon-app`, then `gh repo archive nskreddy1/wacrm`.

- [ ] **Step 6: Log the split** in the execution log with both repo URLs and
the first infra tag SHA.

---

## Task 8: Branch protection, security settings, `check:architecture`

- [ ] **Step 1: Branch protection via `gh`** (founder approval before running)

```bash
# main: PR required, checks green, no force push
gh api -X PUT repos/nskreddy1/auxelon-app/branches/main/protection \
  -f required_status_checks[strict]=true \
  -f enforce_admins=true \
  -f required_pull_request_reviews[required_approving_review_count]=0 \
  -f restrictions=
# prod: bot-push only (restrict push access to the deploy bot/app)
```

- [ ] **Step 2: GitHub Environments** — `production` (manual approval),
`db-production` (manual approval; sole holder of production `SUPABASE_DB_URL`).

- [ ] **Step 3: `check:architecture` (ADR-003 §7)** — new script wired into
`pnpm check` and CI, validating: `@supabase/*` outside adapters (baseline-aware),
`account_id` scoping heuristic in `src/lib/data/`, no prod-secret names in app
code, workflow `uses:` refs pinned to tag/SHA (never a branch), docs mirror
synchronized. Warn mode first; error mode when the baseline is near zero.

- [ ] **Step 4: Verify + commit + log**

```bash
pnpm check   # now includes check:architecture
git commit -m "feat(ci): architecture invariants as executable policy (ADR-003 §7)"
```

---

## Task 9: Founder setup checklist (manual, with founder)

Nothing here is code; record completion in the execution log.

- [ ] Cloudflare: API token + account ID → GitHub secrets; confirm Workers
  plan (first paid step = **Workers $5/mo** when the 10ms free CPU limit or
  log retention bites).
- [ ] Hyperdrive: create two configs — default (cached) + no-cache for
  correctness-sensitive reads — using the **direct** (non-pooled) connection
  string; paste IDs into `wrangler.jsonc`.
- [ ] Grafana Cloud (Loki push URL + token), Sentry DSN, Langfuse keys
  (optional — adapter no-ops without them), Upstash already configured.
- [ ] `SUPABASE_DB_URL` (production) → `db-production` environment ONLY.
- [ ] GitHub Environments approvals verified by dry-running `promote-to-prod`
  up to the approval gate, then cancelling.
- [ ] Run the Task 1 authenticated smoke test (all five criteria) on a preview
  deploy; record results in the log. **First production promotion only after
  this passes.**

Cost table (verified Aug 2026): $0 baseline — Cloudflare free tier, Grafana
Cloud free (50 GB/mo, 14-day), Sentry Developer (5k errors/mo), Langfuse Hobby
(50k units/mo — model real usage before trusting headroom), Upstash free tier.
First paid step: Workers $5/mo.

---

## Self-review checklist (before marking the plan done)

- [ ] Every ADR-001 §13 coverage-matrix row is implemented or explicitly deferred.
- [ ] ADR-002 Phase 0 exit criteria met: `pnpm check` green, boundary check in
  warn mode, zero runtime behavior change.
- [ ] External review mandatory changes verified: immutable promotion (Task 6/7),
  prod-DB prohibition enforced structurally (Tasks 6/8/9), `check:architecture`
  live (Task 8).
- [ ] Execution log has an entry per task with commit SHAs.

## Out of scope

- First real production deploy (needs real tokens/env values — Task 9 hands off).
- ADR-002 Phases 1–3 (hot-path repository conversion, breadth, rehearsal).
- In-app logo replacement / rename (Part A follow-up after founder selection —
  see `docs/brand/assets/concepts/DECISION.md`).

# ADR-INFRA-001: Production deployment infrastructure

- **Status:** Proposed — awaiting founder sign-off. No implementation begins until this is Accepted.
- **Date:** 2026-08-22
- **Deciders:** Founder (solo)
- **Supersedes:** the earlier 3-ADR plan (ADR-009 pipeline / ADR-010 observability / ADR-011 scale) — consolidated here into one infrastructure ADR, kept out of `docs/adr/` which is reserved for product/feature decisions.

---

## 1. Context

wacrm is a solo-founder, pre-revenue, multi-tenant AI sales CRM:

- Single Next.js 16 app (`src/`) talking directly to Supabase (Postgres + Auth + Storage + Realtime; RLS on all 88 public tables).
- WhatsApp via Meta Cloud API (inbound webhooks at `src/app/api/whatsapp/webhook`), email channels, AI auto-reply with deterministic precedence (Flows → Automations → AI).
- CI exists on `main` only (`.github/workflows/ci.yml`: format, lint, typecheck, boundaries, docs, 913 tests, build). **No CD, no security scanning, no branch protection, no production deployment exists yet.**
- `pino` is installed but unused; no logger module exists.
- `@vercel/analytics` + `@vercel/speed-insights` are installed — these only function on Vercel hosting and are dead weight on Cloudflare.
- Upstash Redis is used only for rate limiting (`src/lib/rate-limit.ts`); there is no general cache layer.
- One cron job defined in `vercel.json` (`/api/flows/cron`) — must move to a Cloudflare cron trigger.
- The app is **currently slow** — addressed head-on in §7.

Constraints:

- Pre-revenue: designed to operate within **free/low-cost tiers initially; every vendor is replaceable through an adapter**. (Deliberately not phrased as "all free tiers forever" — vendor pricing changes; the adapter pattern is the durable invariant.)
- Solo founder: everything must be operable by one person; no bespoke systems that need babysitting.
- Multi-tenant with RLS: the pipeline must never allow untested code, silent schema changes, or RLS bypasses to reach production.

This ADR consolidates the original production plan **and** the external review corrections (two independent AI reviews), all re-validated against the live repo and current vendor documentation as of August 2026.

---

## 2. Decision summary

| Area | Decision |
| --- | --- |
| Compute | Cloudflare Workers via `@opennextjs/cloudflare` |
| Pipeline | 2 branches: `main` (trunk) + `prod` (release pointer), gated promotion workflow, build-once artifact |
| Release identity | Plain `release-manifest.json` per release (no GitHub attestation — needs Enterprise Cloud on private repos) |
| Rollback | Two layers: `wrangler rollback` (seconds, emergency) + audited redeploy of a tagged artifact |
| Migrations | Forward-only `supabase db push` from migration files; destructive ops behind a manual confirmation gate |
| Security scanning | gitleaks + `pnpm audit` + `osv-scanner` (NOT `dependency-review-action` — requires GHAS on private repos) |
| AI code review | GitHub Models (free with `GITHUB_TOKEN`), structured JSON output, advisory by default, blocking only on machine-verifiable categories |
| Logs | Grafana Cloud Loki (50 GB/mo free, 14-day retention) behind `src/lib/observability/logger.ts` + Cloudflare Workers Logs (200k events/day free, 3-day retention) |
| Errors | Sentry Developer (5k errors/mo free) behind `src/lib/observability/errors.ts` |
| AI/LLM tracing | Langfuse Hobby (50k **units**/mo — see caveat in §6) behind an env-gated adapter |
| Web analytics | Cloudflare Web Analytics (free, unlimited; Core Web Vitals Chromium-only) replacing the Vercel packages |
| Uptime | Grafana Cloud synthetic monitoring free tier (Uptime Kuma self-host documented as fallback) hitting a new `/api/health` |
| DB connectivity | Cloudflare Hyperdrive (now on the free plan) for raw-SQL paths + Supavisor transaction pooler (port 6543, `prepare: false`) — details in §7 |
| Caching | Upstash Redis general cache layer with strict correctness boundary (§8) |
| Queues | Interface-ready now; build on Cloudflare Queues (free since Feb 2026) only when synchronous webhook handling is measured as a bottleneck |

---

## 3. Compute platform: Cloudflare Workers via OpenNext

### Validated (Aug 2026)

- `@opennextjs/cloudflare` **fully supports Next.js 16** (official support merged January 2026, covers all minors/patches). Next.js 16.2's official Adapter API exists, but native Cloudflare adapters built on it are **not shipped yet** — OpenNext is the current, correct choice, not a stopgap.
- Requires the **Node.js runtime** via `nodejs_compat` compatibility flag. Edge runtime and Node-based middleware are unsupported.

### ⚠ Critical repo-specific finding (new — caught in this validation pass)

This repo uses **`src/proxy.ts`** (Next 16's middleware convention). The OpenNext Cloudflare adapter **does not recognize `proxy.ts`** — it only picks up the `middleware.ts` filename. Deploying as-is would silently ship with **auth redirects and session refresh disabled** — an authentication hole in a multi-tenant CRM.

**Required migration item:** keep the implementation but expose it under the `middleware.ts` filename for the OpenNext build (re-export or rename; verify with an authenticated smoke test on the preview deploy before first production promotion). Re-check adapter release notes at implementation time in case `proxy.ts` support has landed.

### Workers plan facts (verified)

| | Free | Paid ($5/mo minimum) |
| --- | --- | --- |
| Requests | 100k/day | 10M/mo included, then $0.30/M |
| CPU time | 10 ms/invocation | 30M CPU-ms/mo included, then $0.02/M ms |
| Workers Logs | 200k events/day, 3-day retention | 20M events/mo, 7-day retention |

Note on the 10 ms free CPU limit: CPU time excludes I/O wait, so time spent awaiting Supabase or LLM responses does **not** count. Pure-compute work (large JSON serialization, crypto, RSC rendering of heavy pages) does. Heavy dashboard SSR may brush against 10 ms; the $5/mo paid tier removes this concern and is the expected first paid step.

Other repo additions: `wrangler.jsonc` (nodejs_compat, cron trigger replacing `vercel.json`, Workers Logs enabled, Smart Placement — §7), `open-next.config.ts`, removal of `vercel.json` cron and the two Vercel analytics packages.

---

## 4. CI/CD pipeline

### Options considered

1. **Three long-lived environment branches (`main → master → prod`)** — rejected. Known anti-pattern: branches drift, hotfixes get lost, and the artifact you tested is not the artifact you ship. Branch count does not affect scalability; compute/DB/cache design does.
2. **Pure trunk-based (1 branch)** — rejected for now. Best practice generally, but hides the explicit promotion gate the founder wants to see and approve.
3. **2 branches: `main` (trunk) + `prod` (release pointer) with a gated promotion workflow** — **chosen**. Every check the middle branch would have provided survives as a pipeline *stage*. Build once; the gate build and the production deploy are the same artifact.

### Branch model

```text
feature/*  ──PR──▶  main (trunk)  ──promotion pipeline──▶  prod  ──▶ Cloudflare Workers
(preview deploy,    (only branch humans touch;             (protected, bot-push only;
 full CI, security,  branch protection: PR required,        every push = tagged snapshot
 AI review on PR)    all checks green)                      + deploy of the SAME artifact)
```

### Workflows (new/changed)

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` (extend) | PR + push to `main` | Existing checks, unchanged behavior |
| `ai-review.yml` (new) | every PR to `main` | GitHub Models review (free with `GITHUB_TOKEN`, `models: read`). Structured JSON output; advisory by default (§4.3) |
| `security.yml` (new) | PR + push to `main` | gitleaks + `pnpm audit` (fail high/critical) + `osv-scanner` |
| `preview-deploy.yml` (new) | PR to `main` | OpenNext build + `wrangler versions upload` → preview URL posted as PR comment |
| `promote-to-prod.yml` (new) | `workflow_run` after CI + security pass on `main` | The gate: env completeness → typecheck → tests → full OpenNext build → upload artifact → fast-forward `prod` → tag `vX.Y.Z` + GitHub Release → deploy the same artifact |
| `rollback-production.yml` (new) | manual dispatch | Input: tag + typed confirmation → reset `prod` to tag → redeploy that exact stored artifact (no rebuild) |
| `db-migrate.yml` (new) | manual dispatch + confirmation | `pnpm db:push` against production Supabase; destructive-operation gate (§5) |

### 4.1 Critical fix: SHA-pinned promotion (do this first)

`workflow_run`-triggered promotion must **never** check out whatever `main` currently is. Race condition: commit A triggers CI, commit B lands before promotion starts, promotion checks out current HEAD (B) and ships untested code while reporting it promoted A. This has caused real P1 incidents elsewhere.

```yaml
- uses: actions/checkout@v4
  with:
    ref: ${{ github.event.workflow_run.head_sha }}

concurrency:
  group: production-promotion
  cancel-in-progress: false
```

The concurrency group serializes promotions so two cannot race each other.

### 4.2 Release identity

Each release gets a plain `release-manifest.json`: `git_sha`, `artifact_sha256`, `migration_version`, `open_next_version`, `node`/`pnpm` versions, build timestamp. **Do not use `actions/attest-build-provenance`** — it requires GitHub Enterprise Cloud on private repos. The manifest gets ~90% of the traceability at $0; revisit Sigstore attestation only on an Enterprise Cloud plan.

### 4.3 AI review governance

Advisory by default. Merges block **only** on machine-verifiable categories: security vulnerability, leaked secret, RLS bypass, unsafe SQL, critical dependency issue, type/build/test failure. The model returns structured output (`severity`, `category`, `file`, `line`, `confidence`, `blocking`); the GitHub check — not the LLM's prose — decides pass/fail. Rate limits (~10 req/min, ~50/day on high-tier models) are fine for solo PR volume; use a lower-tier model if running on every push.

### 4.4 Tooling corrections (validated)

- `actions/dependency-review-action` **fails outright** on private Free/Pro repos (requires GHAS). Replaced with `pnpm audit` + `osv-scanner` (or Trivy FS scan) — free regardless of visibility.
- Snyk rejected for now: free tier is scan-count-capped (~200 SCA/~100 SAST per month), exhausted quickly at solo iteration pace; largely redundant with gitleaks + audit + osv-scanner + AI review; its distinct products (container/IaC scanning) don't apply to this stack. Revisit if containers appear or an enterprise client requires it.

### 4.5 Rollback — two layers, keep both

1. **Emergency:** `wrangler rollback` to the prior Worker version (seconds; Cloudflare retains prior versions natively).
2. **Audited:** reset `prod` to a tagged release and redeploy the exact stored artifact — no rebuild, so what rolled back is bit-identical to what previously ran.

---

## 5. Database migrations

- Forward-only migrations via `supabase db push` against `supabase/migrations` (migration-file based, not a destructive schema-diff push — existing repo behavior, kept).
- **New gate:** any destructive operation (`DROP COLUMN`, `DROP TABLE`, type changes, data deletion) requires an explicit manual confirmation step in `db-migrate.yml`.
- DB changes never ride silently with app deploys — `db-migrate.yml` is always a deliberate, separate, manually-dispatched action.
- Undo strategy is compensating migrations (documented per migration), never editing an applied migration — consistent with the repo's existing migration rules.
- The `SECURITY DEFINER` invariant enforced by `scripts/push-supabase-schema.mjs` remains in force in CI-driven migrations.

---

## 6. Observability stack

**Loose coupling rule:** every vendor sits behind a thin adapter module in `src/lib/observability/` (and `src/lib/cache/`, `src/lib/realtime/`). Feature code imports the adapter, never the vendor SDK. Any vendor swap is an adapter + env-var change, not a rewrite.

Verified free-tier figures (Aug 2026):

| Service | Free tier | Caveat |
| --- | --- | --- |
| Grafana Cloud (Loki logs) | 50 GB/mo | 14-day retention only |
| Sentry Developer | 5,000 errors/mo | Plus 5 GB logs, 5 GB metrics, 5M spans, 50 replays |
| Langfuse Hobby | 50,000 **units**/mo | A unit = trace + observation + score **combined** — one auto-reply turn with retrieval + eval scoring can burn 4–6 units. Model real usage before assuming headroom. (ClickHouse acquired Langfuse Jan 2026; no pricing/license change, still MIT self-hostable.) |
| Cloudflare Web Analytics | Free, unlimited | Core Web Vitals currently **Chromium-only** |
| Cloudflare Workers Logs | 200k events/day | 3-day retention on free |

Components:

1. **Structured logging** — `src/lib/observability/logger.ts`: pino wrapper (pino is already a dependency) with request-id correlation, `account_id`/route context, secret/PII redaction. Transport = plain HTTP push to Loki, swappable via 2 env vars. Wired into the highest-value paths first: WhatsApp webhook, auto-reply, cron, `/api/v1`.
2. **Error tracking** — `@sentry/nextjs` with Cloudflare support behind `src/lib/observability/errors.ts` (capture, context, user/account tagging). Alert on new/regressed errors.
3. **AI/LLM tracing** — Langfuse via AI SDK telemetry in `src/features/assistant/lib/ai/`, behind an adapter that **no-ops when env vars are absent**. Traces prompt, model, latency, token usage, cost per account.
4. **Web analytics + vitals** — remove `@vercel/analytics` + `@vercel/speed-insights`; add Cloudflare Web Analytics + a `web-vitals` reporter posting LCP/CLS/INP to a new `/api/vitals` → Loki. Behind `src/components/providers/analytics-provider.tsx`.
5. **Uptime** — Grafana Cloud synthetic monitoring (or self-hosted Uptime Kuma, documented) hitting a new lightweight `/api/health`: app up, Supabase reachable, Redis reachable.

---

## 7. Performance plan (the app is slow today)

The slowness must be **measured before it is fixed** — but the architecture-level suspects are known, and the fixes below are all free-tier and low-risk. Order of operations:

### 7.1 Measure first (week 1, before any tuning)

- Enable Workers Logs + the pino logger with per-request timing on the hot paths (webhook, inbox, dashboard, auto-reply).
- Ship the `web-vitals` reporter → identifies whether slowness is server latency (TTFB) or client rendering (LCP/INP).
- Add simple query timing in the data layer (`src/lib/data/`) so slow SQL is visible per route.

### 7.2 Known architectural suspect #1: DB round-trips from the edge

Workers run globally by default, but Supabase Postgres lives in **one region**. A page that makes 5 sequential queries from a Worker isolate far from the DB pays 5 × cross-continent round trips — routinely hundreds of ms. Fixes, in order:

1. **Smart Placement / placement hint in `wrangler.jsonc`** — run the Worker in the datacenter closest to the Supabase project. Since the DB region is known and static, use an explicit placement hint (e.g. `"placement": { "region": "aws:<supabase-region>" }`). For multi-query requests this alone can cut latency from hundreds of ms to single digits. Free, config-only.
2. **Cloudflare Hyperdrive** — now available on the **Workers free plan** (100k queries/day, pooling + query caching included). Eliminates per-request TCP/TLS connection setup and caches read queries at the edge. Validated integration notes:
   - Hyperdrive must be given the **direct** connection string, not the Supavisor-pooled one (Hyperdrive does its own pooling).
   - Use a raw driver (postgres-js / node-postgres) — which matches this repo's raw-SQL data layer. The `supabase-js` client (used for Auth/Storage/Realtime) stays as-is; Hyperdrive applies to the SQL data layer only.
   - Create a **second, cache-disabled Hyperdrive config** for correctness-sensitive reads (auth checks, read-after-write) — cached reads are for hot config-style data only.
3. **If Supavisor is used instead of / alongside Hyperdrive:** transaction-mode pooler (port 6543) is correct for serverless, and the client **must disable prepared statements** (`prepare: false` for postgres-js) — transaction mode doesn't support them; this is a classic source of intermittent under-load connection errors that only appear in production.

### 7.3 Known architectural suspect #2: no cache layer

Every webhook and auto-reply turn re-reads account settings, channel config, and AI provider config from Postgres. Fix: the Redis cache layer (§8) applied to exactly those hot reads first.

### 7.4 Client-side

- Removing the dead Vercel analytics packages trims client JS.
- Web-vitals data will show whether specific dashboard routes need RSC/streaming or component-level work — deferred until measurements exist. No speculative rewrites.

---

## 8. Caching — correctness boundary (non-negotiable)

`src/lib/cache/redis-cache.ts`: get/set/TTL/invalidate on Upstash Redis, with an in-memory fallback when Redis is absent. Existing rate limiting is untouched.

- **In-memory fallback is permitted only for optimization data:** account settings, channel config, AI provider config.
- **Never cache correctness-sensitive data in memory:** permissions, billing state, authentication state, RLS authorization decisions, order/status state.
- Cloudflare Workers are distributed edge isolates — an in-memory fallback is best-effort per-isolate, **not** a shared cache. This is documented in the module and enforced in review.

---

## 9. Supabase coupling assessment (validated)

- **MAU is not the cost driver.** Free tier covers 50,000 MAU; Pro ($25/mo) covers 100,000 MAU pooled org-wide. Real cost drivers at scale: compute tier, DB storage, egress bandwidth, Realtime concurrent channels.
- **pgvector is not a lock-in risk.** Standard open-source Postgres extension; the repo already writes raw SQL, so embeddings are portable via `pg_dump` to any Postgres host. No action needed.
- **Realtime is the actual coupling point.** Self-hostable in principle, but the client subscription pattern is SDK-specific and pricing spikes past a few hundred concurrent channels. **Action:** wrap Realtime subscriptions behind a small adapter interface (`src/lib/realtime/`) now, same pattern as observability, so it can be swapped/self-hosted later without a rewrite.

---

## 10. Scale readiness — decision points, not premature builds

| Stage | Trigger | Action |
| --- | --- | --- |
| Compute | never (automatic) | Workers auto-scale globally; zero config, zero code change |
| DB step 1 | connection errors / latency under load | Hyperdrive + pooler config (§7) — mostly done up front |
| DB step 2 | sustained load | Supabase Pro → compute upgrades → read replicas |
| Webhook ingestion | synchronous handling measured as a bottleneck | Flip to Cloudflare Queues (**free since Feb 4, 2026**: 10k ops/day, 24h retention free vs 14 days paid). Webhook handler is structured now as verify → enqueue-or-process → respond behind one interface, so the flip is config, not a rewrite. Do **not** build the queue before the bottleneck is measured. |
| AI burst control | per-account cost spikes | Per-account reply caps already exist; add Redis-backed concurrency guard + Langfuse per-account cost metering |

Honest note: "billions of concurrent users" is beyond any single-Postgres design. Realistic stages are 10k → 500k → 10M users with documented exit paths (RLS/Auth coupling documented; DB layer is already portable raw SQL).

---

## 11. Consequences

**Positive:** tested-artifact-is-shipped-artifact guarantee; $0 baseline infrastructure cost; one-person operable; every vendor swappable; the two documented emergency paths (wrangler rollback, tagged redeploy) are both rehearsable; app slowness gets a measurement-first plan with two high-confidence config-level fixes (placement + Hyperdrive).

**Negative / accepted risks:**

- `proxy.ts` → `middleware.ts` migration is a hard prerequisite; missing it ships an auth hole (§3).
- Free-tier retention windows are short (3-day Workers Logs, 14-day Loki) — acceptable pre-revenue; revisit at first paying client.
- Langfuse unit economics need real-usage modeling before trusting the 50k/mo headroom.
- GitHub Models rate limits cap AI review throughput — acceptable at solo PR volume.
- Solo-founder bus factor is unchanged by any of this — mitigated only by documentation quality.

**Deferred until revenue / team / scale justifies:** Sigstore attestation, Snyk or any paid security suite, building the actual Queues consumer, Supabase Auth/Realtime decoupling rewrite, custom domain binding, multi-region DB.

---

## 12. Implementation order (once Accepted)

1. Snapshot: backup branch of today's `main`.
2. `proxy.ts` → `middleware.ts` compatibility for OpenNext (§3) — **first**, it gates everything.
3. Repo additions: `wrangler.jsonc` (with placement hint), `open-next.config.ts`, `@opennextjs/cloudflare` dev dep, `scripts/check-env-completeness.mjs`, `.env.production.example`, `/api/health`, Hyperdrive bindings.
4. Observability code: logger module + wiring, error adapter, Langfuse tracing, analytics swap, Redis cache layer, `/api/vitals`.
5. Workflows: `ai-review.yml`, `security.yml`, `preview-deploy.yml`, `promote-to-prod.yml` (SHA-pinned + concurrency group), `rollback-production.yml`, `db-migrate.yml` (destructive gate).
6. Verify locally: `pnpm check` + OpenNext build + env-check pass; authenticated smoke test on a preview deploy (verifies middleware).
7. PR to `main`; then branch protection + repo security settings via `gh` (with founder approval).
8. Setup checklist handoff: Cloudflare token + account ID, Hyperdrive config IDs, Grafana Cloud, Sentry DSN, Langfuse keys, `SUPABASE_DB_URL`.

Not in scope now: the first real production deploy (needs real tokens/env values).

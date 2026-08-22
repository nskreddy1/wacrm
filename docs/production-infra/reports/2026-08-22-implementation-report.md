# Production infrastructure — implementation report

**Date:** 2026-08-22
**Scope:** End-to-end execution of the production infrastructure plan
(`docs/superpowers/plans/2026-08-22-production-infrastructure.md`), implementing
ADR-INFRA-001 (deployment), ADR-INFRA-002 Phase 0 (DB/auth boundary), and
ADR-INFRA-003 (repo split + agent protocol).
**Authoritative task-by-task record:** the execution log at
`docs/superpowers/plans/2026-08-22-production-infrastructure.log.md`
(one row per task: date, summary, verification, commit SHA, deviations).

---

## 1. Executive summary

The app moved from "CI on main, no CD, no production" to a gated, immutable,
one-person-operable Cloudflare Workers production pipeline. All 12 plan tasks
(0–11) are closed:

| Task | Status | Commit / PR |
| --- | --- | --- |
| 0 — Snapshot backup + execution log | ✅ Done | branch `pre-infra-backup-2026-08-22` |
| 1 — Single request-interception file (version-verified) | ✅ Done | task-1 commit (`src/middleware.ts`) |
| 2 — DB/auth boundary baseline (ADR-002 Phase 0) | ✅ Done | d33ca00 |
| 3 — Reliability ports (idempotency, bulkhead, AIProvider) | ✅ Done | 0d53942 + 4277441 (PR #325) |
| 4 — Cloudflare/OpenNext scaffolding | ✅ Done | 5d6b685 (PR #326) |
| 5 — Health endpoints (liveness/readiness) | ✅ Done | d0b3537 (PR #327) |
| 6 — Observability + cache adapters | ✅ Done | 6889354 (PR #328) |
| 7 — CI/CD workflows (7, SHA-pinned, state-machine) | ✅ Done | a20d87e (PR #329) + 15ffc80 (PR #330) |
| 8 — Repo split | ⏸ **Prepared** (founder-gated) | 00c8b3b (PR #331) |
| 9 — Branch protection / prod ruleset / Environments | ⏸ **Prepared** (founder-gated) | 00c8b3b (PR #331) |
| 10 — `check:architecture` executable governance | ✅ Done | 2213226 (PR #332) |
| 11 — Founder setup checklist | 🤝 **Handed off** (needs real credentials) | this commit |

Tasks 8, 9, and 11 are exactly the three the plan itself forbids an agent from
executing autonomously: they create repositories, change GitHub settings, and
hold real production secrets. Everything an agent can safely do for them has
been done — DRY_RUN-default, confirmation-gated scripts plus runbooks
(`scripts/infra/task8-repo-split.sh`, `scripts/infra/task9-github-settings.sh`,
`docs/production-infra/runbooks/`). The founder runs each in minutes.

Verification gate: `pnpm check` (typecheck + lint + boundaries +
architecture + docs-sync + env-manifest + 121 test files / 1182 tests) is
green at HEAD; `actionlint` is clean on all 7 workflows.

---

## 2. Tool choices and justification (cost-optimized by design)

Rule applied throughout: **every vendor sits behind an adapter** (`src/lib/db`,
`src/lib/auth-provider`, `src/lib/observability`, `src/lib/cache`,
`src/lib/realtime`, `src/lib/ports/*`), so any of these can be replaced without
touching feature code. Nothing below is a lock-in decision.

| Tool | Role | Why chosen | Free tier (the only tier this plan uses) |
| --- | --- | --- | --- |
| Cloudflare Workers (+ OpenNext) | Compute | Stateless isolates auto-scale with zero warmup (NFR-009); no idle-server cost; global edge | **Free plan: 100k req/day**, resets 00:00 UTC. Workers Paid is NOT required by this architecture — it exists only as an escape hatch if the free request/CPU limits are ever measurably exceeded |
| Cloudflare Hyperdrive | DB connection pooling | Workers create many short-lived connections; Hyperdrive pools against Supabase's direct string (NFR-010) — production path from day one, not "later" | **Free — included on the Workers Free plan: 100k queries/day**, resets 00:00 UTC (verified against current Cloudflare pricing docs; no $5 plan needed) |
| Cloudflare Workers AI (optional) | Platform-side free AI fallback | Same Cloudflare account, no extra vendor; can serve as a $0 shared AI fallback alongside the existing BYO-key model (per-account OpenAI/Anthropic/Gemini keys) | **Free allocation: 10k neurons/day** on Free and Paid plans alike; some large models are Paid-plan-gated — stick to free-plan models |
| Supabase (Postgres + Auth + RLS) | Data + auth source of truth | Already in place; 88+ tables RLS-scoped; `current_app_user_id()` shim makes auth portable (ADR-002) | Existing plan; compute upgrade only at ~10k+ users |
| postgres-js | SQL driver | Minimal, no ORM ambitions; parameterized-only via the `sql` tagged template; prepared-statement mode resolved per connection source | Free (OSS) |
| Upstash Redis | Cache + bulkhead + rate limits | Per-request pricing fits spiky serverless load — no idle cost; already configured | Free tier; pay-per-request after |
| pino → Grafana Loki | Logs | Env-gated fire-and-forget push (NFR-003); console JSON when unset — $0 until you opt in | Grafana Cloud free: 50 GB, 14-day retention |
| Sentry | Error tracking | No-ops without `SENTRY_DSN`; facade means swappable | Developer free: 5k errors/mo |
| Langfuse | AI tracing | Env-gated decorator with strict PII policy (prompt text never stored raw) | Hobby free: 50k units/mo |
| GitHub Actions + GitHub Models | CI/CD + AI review | Included with the repo; no external CI vendor; AI review uses `models: read` (no API key spend) | Free for the expected volume |
| Cloudflare Web Analytics | Browser analytics | Free, cookieless; independent of our `/api/vitals` telemetry | Free |

**Cost statement (free-tier-only policy):** **The platform runs at $0/month.
Every service in the table above is used strictly within its free tier — no
paid plan is required anywhere, including Hyperdrive** (which is included on
the Cloudflare Workers Free plan at 100k queries/day; the earlier "$5 first
paid step" note referred to the optional Workers Paid escape hatch, not to
Hyperdrive, and is now explicitly out of scope). Production domain:
**https://auxelon.in/** (Cloudflare-managed DNS on the same free account).

### Free-tier budget at the target scale

- **Hundreds of users + hundreds of customers using AI:** fits entirely in
  free tiers. AI spend is bring-your-own-key per account (customers' own
  OpenAI/Anthropic/Gemini keys), metered, with per-conversation reply caps and
  the bulkhead (`ConcurrencyGuard`) so one tenant cannot burn shared capacity.
  Optionally, Cloudflare **Workers AI's 10k free neurons/day** can serve as a
  platform-side $0 fallback for accounts without their own key — the platform
  itself stays at $0 either way.
- **Daily free budgets to watch** (all reset 00:00 UTC): Workers 100k
  req/day; Hyperdrive 100k queries/day; Workers AI 10k neurons/day; Upstash
  Redis free-tier command quota; Supabase free-project limits; Grafana Cloud
  50 GB logs; Sentry 5k errors/mo; Langfuse 50k units/mo. The rule when a
  limit is approached: reduce usage (caching, sampling, caps) first — a paid
  plan is a deliberate founder decision, never an automatic step.

---

## 3. What was built (by layer)

- **Boundary architecture (hexagonal-lite):** domain/feature code can no longer
  import vendor SDKs directly — enforced by `check:boundaries` (153-importer
  shrink-only baseline) and `check:architecture` (ARCH-001…010), both in
  `pnpm check` and CI. Governance is executable, not Markdown.
- **DB adapter:** `src/lib/db/{client,sql,transaction,errors}.ts` —
  Hyperdrive-aware connection resolution, parameterized-only SQL, Unit of Work,
  typed errors, zero observability side effects (instrumentation wraps it).
- **Auth facade:** `src/lib/auth-provider/` + `current_app_user_id()` SQL shim —
  a future auth-provider swap changes one function body, not 249 RLS policies.
- **Reliability (the scale-critical webhook path):** signature verify →
  `webhook_events` idempotent claim (`ON CONFLICT DO NOTHING`; duplicate = fast
  200) → `MessageIngress` port (synchronous today; Cloudflare Queues later is a
  config-level swap) → Flows → Automations → AI precedence unchanged →
  AI path wrapped in the Upstash-backed bulkhead (fail-open).
- **Observability:** correlation vocabulary, pino logger with PII redaction,
  env-gated Loki/Sentry/Langfuse (all no-op when unset), functional decorators,
  slow-query warning, `/api/health` (no-I/O liveness) + `/api/health/dependencies`
  (sanitized readiness), `/api/vitals` + Cloudflare Web Analytics as two
  independent systems.
- **CI/CD (deployment as a state machine, plan §G):** 7 workflows —
  build-once artifact, sha256 attestation + re-verification before deploy,
  `workflow_run` eligibility gate, manual `production` Environment approval,
  release manifest, post-deploy health poll with auto-rollback, separate
  founder-gated `db-migrate` (the ONLY holder of production `SUPABASE_DB_URL` —
  NFR-007), rollback-from-manifest with no rebuild. All actions SHA-pinned.

Every NFR (001–010) maps to shipped code or a workflow; every ARCH rule
(001–010) is checked by a script that runs in CI.

---

## 4. What remains — founder actions (in order)

1. **Task 8 — repo split:** `DRY_RUN=0 ./scripts/infra/task8-repo-split.sh`
   (creates `auxelon-app` + `auxelon-infra`, tags `v1.0.0`, archives `wacrm`);
   then re-point production-sensitive workflow `uses:` refs per
   `docs/production-infra/runbooks/repo-split.md`.
2. **Task 9 — GitHub settings:** `DRY_RUN=0 BRANCH=<default> DEPLOY_APP_ID=…
   REVIEWER_ID=… ./scripts/infra/task9-github-settings.sh` (branch protection,
   `prod` ruleset with bot-only bypass, `production`/`db-production`
   Environments). Runbook: `docs/production-infra/runbooks/github-settings.md`.
3. **Task 11 — credentials + first deploy:** Cloudflare token/account ID →
   GitHub secrets; create ONE Hyperdrive config from the **direct** Supabase
   string and paste the id into `wrangler.jsonc`; optional Loki/Sentry/Langfuse
   keys; production `SUPABASE_DB_URL` into `db-production` ONLY; run the
   5-point authenticated smoke test on a preview deploy; **only then** promote
   to production for the first time.

## 5. Notable deviations (full detail in the execution log)

- Backup branch renamed (`backup/*` refs conflicted with an existing `backup`
  branch); repo has no `main`, so the base branch was snapshotted instead.
- `proxy.ts` → `middleware.ts`: OpenNext support for Next 16 `proxy.ts` is
  experimental only at the installed versions — the plan's NOT-supported branch
  was applied, reason recorded in the file header.
- Migration `032` needed the checker's own `allow-security-downgrade`
  annotation (its DEFINER→INVOKER change was the deliberate security fix).
- Realtime facade exposes `getChannel`/`removeChannel` instead of one
  `subscribe()` — the 4 call sites use 3 different Supabase primitives; the
  actual requirement (vendor import confined to one file) holds.
- Task 7 verification caught and fixed a half-migrated realtime call site in
  `use-team-chat.ts`.

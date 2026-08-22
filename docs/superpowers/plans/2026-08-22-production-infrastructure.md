# Production Infrastructure Implementation Plan — v2 (ADR-INFRA-001 + 002 Phase 0 + 003)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision:** v2 — incorporates the third external review round (20 findings,
2026-08-22) and the system-design/patterns review. All 5 mandatory review
edits are applied: (1) version-verified single request-interception file,
(2) Hyperdrive as the production DB path *now*, (3) single Hyperdrive binding,
(4) explicit branch-protection check contexts + real prod actor restriction,
(5) promotion integrity (workflow_run eligibility + artifact SHA verification).

---

## ⚠️ PHASE BOUNDARY — read this first

```text
AUTHORING PHASE (this document)
  No commands are executed. No repos are created. No branches are pushed.
  This file is a plan, not an instruction to act.

EXECUTION PHASE (begins only on explicit founder approval)
  Task 0 (backup) is the first executed step.
  Tasks 8–10 additionally require per-task founder approval
  because they create repos / change GitHub settings / need real secrets.
```

An agent reading this plan MUST NOT run any command in it until the founder
has explicitly moved the plan to the execution phase.

---

**Goal:** Take the app from "CI on main, no CD, no production" to a gated,
immutable, one-person-operable Cloudflare Workers production pipeline —
implementing ADR-INFRA-001 (deployment), ADR-INFRA-002 Phase 0 (DB/auth
boundary), and ADR-INFRA-003 (repo split + agent protocol) — **designed so the
same architecture scales from 1 tenant to millions of concurrent users without
a rewrite** (see "Scale ladder" below).

**Architecture:** Build-once artifact promoted `main → prod → Cloudflare
Workers` via SHA-pinned, concurrency-serialized workflows that call immutably
pinned reusable workflows in `auxelon-infra`. All vendor SDKs live behind
adapters (`src/lib/db/`, `src/lib/auth-provider/`, `src/lib/observability/`,
`src/lib/cache/`, `src/lib/realtime/`). Architecture rules are CI-enforced
(`check:architecture`), not Markdown-enforced.

**Tech Stack:** Next.js 16 (App Router), `@opennextjs/cloudflare`, Cloudflare
Workers + **Hyperdrive (production DB path from day one)**, Supabase
(Postgres + RLS), postgres-js, pino → Grafana Loki, Sentry, Langfuse
(env-gated), Upstash Redis, GitHub Actions + GitHub Models.

---

## System design addendum (adopted from the patterns review)

These principles are binding on every task below and on all future feature
work. They exist so ten different agents produce *one* architecture.

### A. Layering + Dependency Rule (Hexagonal-lite)

```text
Presentation   Next.js routes / Server Actions / webhooks / UI
     ↓
Application    use-cases: commands/ + queries/ (CQRS-lite, no event sourcing)
     ↓
Domain         entities, business rules, policies — plain TypeScript
     ↓
Ports          interfaces: repositories, AuthProvider, AIProvider, Cache,
               MessageIngress, ConcurrencyGuard
     ↓ (implemented by)
Infrastructure adapters in src/lib/* — Supabase, postgres-js/Hyperdrive,
               Redis, Sentry, Loki, Langfuse, WhatsApp/Meta
```

**Dependency Rule (non-negotiable):** Domain and application code MUST NOT
import Next.js, `@supabase/*`, Redis, Sentry, Langfuse, Loki, or any
Cloudflare/Vercel SDK. Infrastructure implements ports; nothing above ports
knows a vendor name.

**Repository boundary:** SQL belongs in `src/features/<domain>/repositories/`
(interface + Postgres implementation). Connection management belongs in
`src/lib/db/`. `src/lib/db/` is the adapter, **not** the repository layer —
no business queries there, ever.

### B. Pattern budget (allowed only at explicit boundaries)

| Pattern | Where | Status |
| --- | --- | --- |
| Ports & Adapters | db, auth, observability, cache, realtime | this plan |
| Repository | `src/features/*/repositories/` | rules now; conversion = ADR-002 Phase 1 |
| Unit of Work | `src/lib/db/transaction.ts` | this plan |
| Facade | auth-provider, observability | this plan |
| Strategy + Factory | AI providers (`AIProvider` port + per-account factory) | rules now; existing `lib/ai/providers/` conforms incrementally |
| Decorator | correlation/logging/tracing as functional wrappers (`withCorrelation(withLogging(withTracing(fn)))`) | Task 6 |
| Idempotency | WhatsApp webhook (event_id dedupe), cron, migrations, deploys | Task 3 (webhook), Task 7 (deploys) |
| Bulkhead | per-account + global + per-provider AI concurrency/rate guards | Task 3 interface; Redis impl behind `ConcurrencyGuard` |
| Circuit Breaker | AI providers + external messaging APIs ONLY (not Postgres); fallback decided by explicit config policy, never provider-chain roulette | interface now; enable per provider when measured |
| Anti-Corruption Layer | Supabase SDK boundary (the existing boundary check) | this plan |
| Outbox / Saga / queues | NOT NOW — interface-ready via `MessageIngress` | future |

**Rule:** patterns are allowed only at these boundaries. Business logic stays
plain and boring. No Gang-of-Four cosplay.

### C. Webhook ingress design (the scale-critical path)

```text
Meta/WhatsApp → Webhook Controller → verify X-Hub-Signature-256
             → Idempotency check (event_id; already processed → 200 fast)
             → MessageIngress.accept(event)
                 today:  SynchronousMessageIngress (process inline)
                 future: QueuedMessageIngress (Cloudflare Queues) — same port,
                         zero call-site changes
             → Message application service
                 → Flows → Automations → AI auto-reply (precedence preserved)
                 → AI path: ConcurrencyGuard (bulkhead) → CircuitBreaker
                   → TracingDecorator (Langfuse) → provider adapter
```

```ts
interface MessageIngress {
  accept(event: InboundMessage): Promise<Ack>
}
```

This single interface is what makes "millions of concurrent users" a config
change (swap ingress implementation + add queue) instead of a rewrite.

### D. Non-functional requirements (measurable, CI/runbook-checkable)

```text
NFR-001  Webhook acknowledgement            < 1 s (p99)
NFR-002  /api/health                        < 100 ms excl. network; no I/O
NFR-003  No request path depends on synchronous observability delivery
NFR-004  AI provider failure never crashes webhook ingestion
NFR-005  One tenant cannot exhaust shared AI/Redis/DB capacity (bulkheads)
NFR-006  Every production release traceable: commit SHA + artifact SHA + tag
NFR-007  No production DB mutation from developer/agent credentials
NFR-008  Every externally retryable operation is idempotent
NFR-009  Compute is stateless — no in-memory state feeds authorization or
         correctness (Workers isolates scale horizontally without warmup)
NFR-010  DB access always goes through pooled connections (Hyperdrive in
         production) — never one raw connection per request
```

### E. Architecture fitness rules (`check:architecture`, Task 10)

```text
ARCH-001  Domain/application code cannot import infrastructure SDKs
ARCH-002  Feature code cannot import @supabase/* (adapter allowlist only)
ARCH-003  Feature code cannot import the Redis SDK directly
ARCH-004  Feature code cannot import Sentry/Langfuse/Loki SDKs directly
ARCH-005  SQL exists only in repositories / the data layer
ARCH-006  Account-scoped queries require account_id context (heuristic)
ARCH-007  Webhook handlers enforce idempotency (event_id dedupe present)
ARCH-008  External provider calls go through adapters
ARCH-009  Workflow `uses:` refs never point at mutable branches
ARCH-010  Production DB secret names never appear in app code
```

### F. Scale ladder (how this plan reaches millions of concurrent users)

| Stage | What changes | What does NOT change |
| --- | --- | --- |
| Launch → ~10k users | This plan as written: Workers (auto-scaling isolates), Hyperdrive pooling, Redis cache, bulkhead limits | — |
| ~10k → ~100k | Workers Paid; tune Hyperdrive pool; widen Redis cache namespaces; enable circuit breakers on AI providers; Supabase compute upgrade | code, ports, workflows |
| ~100k → 1M+ | Swap `SynchronousMessageIngress` → `QueuedMessageIngress` (Cloudflare Queues); read replicas behind the db adapter; per-region smart placement; consider ADR-002 Phase 2+ (DB portability exit if Supabase economics break) | ports, repositories, feature code, promotion pipeline |

The reason each step is cheap: stateless compute (NFR-009), all vendor access
behind ports (Dependency Rule), and async-ready ingestion (§C).

### G. Deployment as a state machine (Task 7 implements this)

```text
BUILD → VALIDATE → ARTIFACT_CREATED → ATTESTED (sha256)
      → PROMOTION_APPROVED → PROD_POINTER_UPDATED → DEPLOYED → VERIFIED

Failure states: FAILED_BUILD / FAILED_VALIDATION / FAILED_DEPLOY / FAILED_HEALTHCHECK
Rollback: RUNNING(vN) → FAIL → ROLLBACK_REQUEST → VERSION(vN-1) → VERIFY → RUNNING(vN-1)
```

Every workflow job maps to exactly one transition; no job does two.

---

## Global Constraints

- **Sequencing is part of the decision.** Task order below is final: the
  DB/auth boundary baseline (Task 2) lands **before** infra scaffolding,
  because it establishes the boundaries everything else preserves.
- **Task 1 is a hard gate.** Nothing after it starts until the authenticated
  smoke test passes under the OpenNext runtime. Compiling is not passing.
- **Migration invariants (corrected wording):** every migration is
  **forward-only, deterministic, safe to run exactly once, never edited after
  application**. Production migration history is immutable. (Development DB
  *setup scripts* may be idempotent; migrations are ordered state transitions
  — do not blanket-apply `IF NOT EXISTS` as a substitute for ordering.)
  Naming: `YYYYMMDDHHMMSS_description.sql`. After any schema change:
  `pnpm db:push` → `pnpm db:doc` → `pnpm docs:sync`. Destructive changes
  follow **expand → migrate → contract** (ADR-003 §5.2).
- **Agents never touch the production DB** (ADR-003 §5.3). Every `db:push` in
  this plan targets the development database. The production `SUPABASE_DB_URL`
  is created only inside the `db-production` GitHub Environment in Task 11.
- `src/lib/db/` stays **boring**: `client.ts`, `sql.ts`, `transaction.ts`,
  `errors.ts` and nothing else. No query builder, no ORM ambitions, and — per
  review §4 — **no observability side effects** inside the adapter itself
  (instrumentation wraps it in Task 6).
- Cache authority: `Redis = shared cache; memory = best-effort optimization;
  database = source of truth`. In-memory values never feed authorization.
- Boundary/architecture checks start in **warn mode with a baseline**; flip to
  error only when the baseline is near zero.
- Run `pnpm check` before declaring any task done.
- **Execution log (required, EXECUTION PHASE only):** every completed task
  appends an entry to
  `docs/superpowers/plans/2026-08-22-production-infrastructure.log.md`:
  date, task number, what was done, verification output summary, commit SHA,
  deviations from plan (if any).

---

## Task 0: Snapshot backup (first EXECUTION-PHASE step)

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

## Task 1: Request-interception file — version-verified decision (HARD GATE)

**Corrected per review §1.** Do NOT assume the re-export. Next.js 16 renamed
`middleware.ts` → `proxy.ts`; OpenNext Cloudflare support for `proxy.ts` has
historically lagged (opennextjs-cloudflare issue #1279). The decision is made
against the **exact installed versions**, and the result is **exactly one
active file** — never both.

**Files:**
- Read: `package.json` (installed `next` + `@opennextjs/cloudflare` versions), `src/proxy.ts`
- Create OR rename: exactly one of `src/proxy.ts` / `src/middleware.ts`

- [ ] **Step 1: Verify adapter support (the decision gate, not an aside)**

Check the installed `@opennextjs/cloudflare` version's release notes/changelog
for Next 16 `proxy.ts` (Node middleware) support. Record the finding — version
numbers and source link — in the execution log.

- [ ] **Step 2: Apply the single-file decision**

```text
If proxy.ts IS supported by the installed adapter:
    keep src/proxy.ts as the sole interception file. Done.

If proxy.ts is NOT supported:
    git mv src/proxy.ts src/middleware.ts   (preserve contents + config export)
    and note in the file header why the Next-16 name is not used yet,
    with the adapter version that forces it.

NEVER keep both files simultaneously — double discovery / ambiguous
framework behavior is worse than either single choice.
```

- [ ] **Step 3: Verify single execution locally**

Run: `pnpm dev` — confirm the interception runs once per request (temporary
`console.log("[v0] middleware hit")`, then remove it). Confirm auth redirect
to `/login` and session refresh still work.

- [ ] **Step 4: Authenticated smoke test criteria (executed on the Task 7 preview deploy, defined now)**

All five must pass under the OpenNext runtime before first production
promotion — record results in the execution log:

```text
1. Anonymous request  → public page renders; protected route redirects to login
2. Authenticated request → dashboard renders with session
3. Protected route    → RLS-scoped data appears (correct account only)
4. Session refresh    → expired access token refreshes without logout
5. Logout             → session cleared; protected route redirects again
```

- [ ] **Step 5: Verify + commit**

```bash
pnpm check
git commit -m "feat(infra): single request-interception file, version-verified for OpenNext (ADR-001 §3)"
```

---

## Task 2: DB/auth boundary baseline (ADR-002 Phase 0)

**Corrected per review §2/§4/§5:** Hyperdrive is the **production connection
mechanism now**, not "later". The adapter resolves the connection per
environment; environment-specific semantics never leak upward. No logging
side effects inside the adapter.

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

- [ ] **Step 2: `src/lib/db/client.ts` — one resolution function, two environments**

```ts
// src/lib/db/client.ts
// The ONLY place that knows how to reach Postgres (ADR-001 §7.2, ADR-002 §3.2).
//
// Connection resolution:
//   Cloudflare production → HYPERDRIVE.connectionString (Hyperdrive pools;
//     it is given Supabase's DIRECT connection string — set up in Task 11).
//     Postgres.js against Hyperdrive supports prepared statements; leave
//     `prepare` at its supported setting per current Cloudflare docs.
//   Local dev / CI → DATABASE_URL. If that URL is the Supavisor transaction
//     pooler (port 6543), prepared statements MUST be disabled
//     (`prepare: false`) — transaction-mode pooling does not support them.
//
// `prepare` is therefore a per-connection-source compatibility decision,
// NOT a blanket requirement.
import postgres from "postgres"

let client: ReturnType<typeof postgres> | null = null

function resolveConnection(): { url: string; prepare: boolean } {
  const hd = (globalThis as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE
    ?? (process.env as { HYPERDRIVE?: never }, undefined)
  // In the Workers runtime the binding arrives via the request context /
  // getCloudflareContext() — wire the actual access per @opennextjs/cloudflare
  // docs for the installed version; the shape above is illustrative.
  if (hd?.connectionString) return { url: hd.connectionString, prepare: true }

  const url = process.env.DATABASE_URL
  if (!url) throw new Error("No database connection configured")
  const isTransactionPooler = url.includes(":6543")
  return { url, prepare: !isTransactionPooler }
}

export function db() {
  if (!client) {
    const { url, prepare } = resolveConnection()
    client = postgres(url, { prepare, max: 5 })
  }
  return client
}
```

- [ ] **Step 3: `sql.ts` — parameterized-only, NO side effects**

```ts
// src/lib/db/sql.ts
// Parameterized-only tagged-template execution. Repositories import this,
// never postgres directly. NO logging/timing here — observability wraps the
// adapter in Task 6 (Decorator), keeping this layer's job singular.
import { db } from "./client"

export async function sql<T = unknown>(
  strings: TemplateStringsArray,
  ...params: unknown[]
): Promise<T[]> {
  return (await db()(strings, ...(params as never[]))) as T[]
}
```

`transaction.ts`: a `withTransaction(fn)` helper over `db().begin()` — the
explicit Unit-of-Work boundary.
`errors.ts`: map driver errors to typed app errors (`UniqueViolation`,
`ForeignKeyViolation`, `SerializationFailure`).

- [ ] **Step 4: Auth-provider facade**

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

- [ ] **Step 5: `current_app_user_id()` migration + `is_account_member` refactor**

```sql
-- supabase/migrations/<timestamp>_current_app_user_id.sql
-- Portability shim (ADR-002 §3.3): isolates the caller-identity lookup so a
-- future non-Supabase host changes ONE function body, not 88 tables of policies.
-- Zero behavior change today. search_path='' is safe ONLY because every
-- referenced object is schema-qualified (auth.uid()).
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT auth.uid();
$$;
```

**HARD RULE (review §5):** for the `is_account_member` refactor —
*do not write the replacement function from memory.* Extract the current
production-equivalent definition from `.agents/context/database-schema.md`
(`pnpm db:doc` output), modify **only** `auth.uid()` → `current_app_user_id()`,
keep `SECURITY DEFINER` and all other qualifiers byte-identical (remember:
`CREATE OR REPLACE` does not inherit `SECURITY DEFINER` — restate it).

Run: `pnpm db:push && pnpm db:doc && pnpm docs:sync` (development DB only).

- [ ] **Step 6: Boundary check in warn mode with baseline**

Extend `scripts/check-boundaries.mjs`: flag `@supabase/*` (and
`@/lib/supabase`) imports outside the allowlist
`src/lib/db/, src/lib/auth-provider/, src/lib/realtime/, src/lib/storage/,
src/lib/supabase*`. Write current violations (~112 files) to
`scripts/boundaries-baseline.json`; **new** violations fail, baselined ones
warn. Print the baseline count so shrinkage is visible in every CI run.

- [ ] **Step 7: Document, verify, commit, log**

Add the repository rules to `.agents/context/database.md` (rules 1–5 from
ADR-002 §3.1, the prod-DB prohibition from ADR-003 §5.3, and the Dependency
Rule + repository boundary from this plan's System design addendum §A).

```bash
pnpm check
git commit -m "feat(db): portability foundations — db adapter (Hyperdrive-first), auth facade, uid shim, boundary baseline (ADR-002 Phase 0)"
```

---

## Task 3: Reliability ports — idempotency, bulkhead, AI provider strategy

**New task (patterns review §6–§11).** These are the application-relevant
scale controls for THIS product: a WhatsApp CRM whose hot path is
webhook → Flows/Automations/AI → reply. Interfaces land now; heavyweight
implementations stay out until measured.

**Files:**
- Create: `src/lib/ports/message-ingress.ts`, `src/lib/ports/concurrency-guard.ts`, `src/lib/ports/ai-provider.ts`
- Create: `supabase/migrations/<timestamp>_webhook_event_dedupe.sql`
- Modify: `src/app/api/whatsapp/webhook/route.ts` (idempotency + ingress port)
- Modify: `.agents/context/hld.md` (record §A–§G of this plan's addendum)

- [ ] **Step 1: Webhook idempotency (NFR-008 — mandatory, not optional)**

Migration: `webhook_events(event_id text primary key, account_id uuid not null,
processed_at timestamptz not null default now())` with a TTL-cleanup index.
Webhook flow becomes: verify signature → `INSERT ... ON CONFLICT DO NOTHING`
on `event_id` → conflict means already processed → return 200 immediately;
otherwise process. Meta redelivers events; today that risks duplicate
messages/replies.

- [ ] **Step 2: `MessageIngress` port + synchronous implementation**

```ts
export interface MessageIngress {
  accept(event: InboundMessage): Promise<Ack>
}
// SynchronousMessageIngress wraps the existing processing pipeline verbatim.
// Flows → Automations → AI precedence is inside the pipeline and MUST NOT move.
```

Route the webhook handler through it. Zero behavior change; the seam is the
deliverable (scale ladder stage 3 swaps this for a queued implementation).

- [ ] **Step 3: `ConcurrencyGuard` port (Bulkhead) over the existing Upstash client**

```ts
export interface ConcurrencyGuard {
  acquire(key: string, limits: { global: number; perAccount: number }): Promise<boolean>
  release(key: string): Promise<void>
}
```

Wire it around the AI auto-reply call path only (the existing per-account
reply caps remain; this adds concurrency isolation so one noisy tenant cannot
exhaust AI capacity — NFR-005). Business code calls the guard, never Redis
`INCRBY` directly.

- [ ] **Step 4: `AIProvider` port (Strategy) — rules, not a rewrite**

```ts
export interface AIProvider {
  generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult>
}
```

The existing `src/features/assistant/lib/ai/providers/` largely conforms;
record the rule (no `if (provider === "openai")` branching outside the
factory; Langfuse becomes a `TracingAIProvider` decorator in Task 6; circuit
breaker wraps here when enabled). Migrate only what violates the rule —
do not refactor working provider code for aesthetics.

- [ ] **Step 5: Verify + commit**

```bash
pnpm check && pnpm test
git commit -m "feat(reliability): webhook idempotency, MessageIngress seam, bulkhead + AIProvider ports (NFR-004/005/008)"
```

---

## Task 4: Cloudflare / OpenNext scaffolding

**Corrected per review §3/§7:** single `HYPERDRIVE` binding (no
`HYPERDRIVE_NOCACHE` until a measured caching requirement justifies it —
application caching is Redis's job), and the env checker gets two explicit
modes.

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
  // ONE binding. All SQL goes through it. Application caching = Redis.
  // A second no-cache config is added only with a measured requirement.
  "hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "<set-in-task-11>" }
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

- [ ] **Step 5: Env completeness check — two explicit modes (review §7)**

`scripts/check-env-completeness.mjs`:

```text
--manifest  parse .env.production.example (names only, no values) and fail if
            any name is missing from the manifest of required keys.
            Runs on every PR — needs no secrets.

--runtime   fail if any manifest key is absent from the CURRENT environment.
            Runs ONLY inside the promotion job, which executes in the
            `production` GitHub Environment and therefore sees the real vars.
```

PR = manifest mode; promotion = runtime mode. Never run runtime mode where
production values don't exist — it can only fail there.

- [ ] **Step 6: Verify + commit**

```bash
pnpm check
npx opennextjs-cloudflare build   # must produce .open-next/worker.js
git commit -m "feat(infra): Cloudflare Workers scaffolding — wrangler, open-next, dual-mode env check (ADR-001 §3)"
```

---

## Task 5: Health endpoints — liveness/readiness split

**Corrected per review §12:** readiness never returns raw dependency error
messages (implementation-detail leak); errors go to the logger only.

**Files:**
- Create: `src/app/api/health/route.ts`
- Create: `src/app/api/health/dependencies/route.ts`

- [ ] **Step 1: Liveness — fast, no external calls (NFR-002)**

```ts
// src/app/api/health/route.ts
// LIVENESS ONLY. Answers "is the Worker alive?" — never calls Supabase/Redis.
// Uptime monitors point here; dependency degradation must not read as
// "application dead".
export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({
    ok: true,
    release: process.env.RELEASE_VERSION ?? "dev",
    git_sha: process.env.GIT_SHA ?? "dev",
  })
}
```

- [ ] **Step 2: Readiness — dependency health, sanitized output**

```ts
// src/app/api/health/dependencies/route.ts
// READINESS. Checks critical dependencies with short timeouts; degraded ≠ dead.
// Public payload: name + ok + ms ONLY. Raw errors go to the logger (Task 6),
// never over the wire.
export const dynamic = "force-dynamic"

async function check(name: string, fn: () => Promise<unknown>, timeoutMs = 1500) {
  const start = performance.now()
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ])
    return { name, ok: true, ms: Math.round(performance.now() - start) }
  } catch {
    // log the underlying error via the observability adapter once Task 6 lands
    return { name, ok: false, ms: Math.round(performance.now() - start) }
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
git commit -m "feat(infra): liveness + readiness health endpoints, sanitized readiness output (ADR-001 §6)"
```

---

## Task 6: Observability + cache adapters (Decorators live here)

**Corrected per review §15:** Cloudflare Web Analytics (browser analytics) and
`/api/vitals` (our custom Web Vitals telemetry) are **two separate systems**
and are documented as such.

**Files:**
- Create: `src/lib/observability/logger.ts`, `errors.ts`, `correlation.ts`, `langfuse.ts`, `instrument.ts`
- Create: `src/lib/cache/redis-cache.ts`, `src/lib/realtime/index.ts`
- Create: `src/app/api/vitals/route.ts`, `src/components/providers/analytics-provider.tsx`

- [ ] **Step 1: Correlation vocabulary first**

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
Loki gated on `LOKI_URL`/`LOKI_TOKEN` (no-op console JSON otherwise;
fire-and-forget — NFR-003). Wire into the hot paths: WhatsApp webhook,
auto-reply, cron, `/api/v1`.

- [ ] **Step 3: Errors** — `errors.ts`: `captureError(err, correlation)` over
`@sentry/nextjs` (Cloudflare-compatible init), no-op when `SENTRY_DSN` absent.
Feature code imports this module, never `@sentry/*`.

- [ ] **Step 4: Functional decorators + DB instrumentation (moved here from Task 2)**

`instrument.ts`: `withCorrelation`, `withLogging`, `withTracing` functional
wrappers (addendum §B). This is also where **slow-query timing** wraps the
`sql` adapter (>100 ms → warn with correlation) — the adapter itself stays
side-effect-free.

- [ ] **Step 5: Langfuse adapter with explicit PII policy**

`langfuse.ts` — env-gated no-op, applied as a `TracingAIProvider` decorator
around the `AIProvider` port (Task 3); header comment is the policy:

```text
SAFE TO LOG:   model id, latency, token counts, cost, operation, account_id
REDACTED:      prompt/completion text (replaced with length + sha256 hash)
HASHED:        contact identifiers (phone numbers) when needed for joins
NEVER STORED:  raw customer messages, auth tokens, webhook signatures
Raw conversation logging requires a per-account opt-in flag; default OFF.
```

- [ ] **Step 6: Cache with authority rule**

`src/lib/cache/redis-cache.ts`: `get/set/del` + TTL over Upstash Redis;
in-memory `Map` fallback when Redis is absent. Module header states:
`Redis = shared cache; memory = best-effort per-isolate optimization; database
= source of truth. NEVER cache permissions, billing, auth, or security state
in memory` — and the API enforces it with an allowlist of cache namespaces
(`ai-provider-config`, `account-settings`, `channel-config`).

- [ ] **Step 7: Realtime adapter** — `src/lib/realtime/index.ts`:
`subscribe(channel, handler): Unsubscribe` over the Supabase Realtime SDK;
migrate the 4 existing `.channel()` call sites to it.

- [ ] **Step 8: Vitals + analytics — two systems, named as such**

```text
Cloudflare Web Analytics  = third-party browser analytics
                            (analytics-provider.tsx, env-gated token)
/api/vitals               = OUR custom Web Vitals telemetry
                            (web-vitals POSTs: LCP/CLS/INP → logger → Loki)
```

They replace the removed Vercel packages but are independent; either can be
disabled without touching the other.

- [ ] **Step 9: Verify + commit**

```bash
pnpm check && pnpm test
git commit -m "feat(observability): logger, errors, decorators, langfuse, cache, realtime + vitals (ADR-001 §6-8)"
```

---

## Task 7: Workflows (immutable promotion identity + integrity)

**Corrected per review §8/§11:** adds the `workflow_run` eligibility gate and
artifact SHA verification immediately before deploy. Implements the deployment
state machine (addendum §G).

**Files:**
- Create: `.github/workflows/security.yml`, `ai-review.yml`, `preview-deploy.yml`, `promote-to-prod.yml`, `rollback-production.yml`, `db-migrate.yml`
- Create: `scripts/generate-release-manifest.mjs`

Until `auxelon-infra` exists (Task 8), write these as self-contained; Task 8
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

- [ ] **Step 4: `promote-to-prod.yml`** — the gate. Non-negotiables:

```yaml
on:
  workflow_run:
    workflows: ["CI"]          # the exact upstream workflow name
    types: [completed]

concurrency:
  group: production-promotion
  cancel-in-progress: false

jobs:
  promote:
    # ELIGIBILITY GATE (review §11): a successful run from any other
    # branch/workflow must never become promotion input.
    if: >
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.head_branch == 'main'
    environment: production   # manual approval
    steps:
      - uses: actions/checkout@v4
        with:
          # NEVER current main HEAD — the race ships untested code (ADR-001 §4.1)
          ref: ${{ github.event.workflow_run.head_sha }}
```

Then, in state-machine order (addendum §G):

```text
BUILD        env completeness (--runtime) → typecheck → tests → OpenNext build
ATTESTED     sha256 over the artifact → upload artifact
VERIFY       download the artifact back → recompute sha256 → MUST equal the
             recorded value (review §8 — never assume upload == download)
MANIFEST     scripts/generate-release-manifest.mjs: git_sha, artifact_sha256,
             migration_version, open_next_version, node/pnpm versions,
             timestamp, infra workflow ref used (ADR-003 §6)
PROMOTE      fast-forward `prod` → tag + GitHub Release (manifest attached)
DEPLOY       `wrangler deploy` the SAME verified artifact — no rebuild
VERIFIED     post-deploy /api/health poll; failure → FAILED_HEALTHCHECK state
```

- [ ] **Step 5: `rollback-production.yml`** — manual dispatch; inputs: tag +
typed confirmation string; resets `prod` to the tag, downloads the stored
artifact, **re-verifies its sha256 against the release manifest**, and
redeploys it — no rebuild.

- [ ] **Step 6: `db-migrate.yml`** — manual dispatch; environment
`db-production` (approval required); destructive gate: if the migration diff
matches `DROP |ALTER .*TYPE|DELETE FROM|TRUNCATE` or the PR carried
`[destructive-migration]`, require a second typed confirmation input. This
workflow is the ONLY thing that ever holds the production `SUPABASE_DB_URL`
(ADR-003 §5.3, NFR-007).

- [ ] **Step 7: Verify + commit** — `actionlint` on all workflows, `pnpm check`.

```bash
git commit -m "feat(ci): gated promotion pipeline with eligibility + artifact verification (ADR-001 §4)"
```

---

## Task 8: Repo split execution

> **⛔ NOT EXECUTABLE during plan authoring (review §17).** This task creates
> GitHub repositories. It runs only in the EXECUTION PHASE **and** only after
> explicit, separate founder approval for this specific task. An agent that
> reaches this task without that approval stops and asks.

**Files:** none in this repo except `AGENTS.md` additions; creates two GitHub repos.

- [ ] **Step 1: Mirror `wacrm` → `auxelon-app`** (history-preserving, ADR-003 §3)

```bash
gh repo create nskreddy1/auxelon-app --private
git clone --mirror https://github.com/nskreddy1/wacrm.git
cd wacrm.git && git push --mirror https://github.com/nskreddy1/auxelon-app.git
```

- [ ] **Step 2: Scaffold `auxelon-infra`** per ADR-003 §1: reusable workflows
extracted from Task 7 bodies, `runbooks/` (rollback, db-migrate, incident,
migration-rehearsal placeholders), `provisioning/` (idempotent setup scripts +
docs), `secrets-inventory.md` (names/rotation only), `architecture/` (ADR
mirrors), `AGENTS.md`. Publish the first immutable tag (`v1.0.0`); record the
"never move/delete a published tag" rule in its `AGENTS.md`.

- [ ] **Step 3: Re-point the app's thin callers** to
`nskreddy1/auxelon-infra/.github/workflows/*@v1.0.0` (normal) and
`@<full-sha>` (promote/rollback/db-migrate) — ARCH-009.

- [ ] **Step 4: `AGENTS.md` protocol sections in both repos** — verbatim from
ADR-003 §5: context order, DB-change protocol (incl. expand→migrate→contract),
production-DB prohibition, cross-repo protocol, "no future production
development in wacrm". Add the Dependency Rule + pattern budget (addendum
§A/§B) so every future agent inherits them.

- [ ] **Step 5: Archive `wacrm`** — final README note pointing to
`auxelon-app`, then `gh repo archive nskreddy1/wacrm`.

- [ ] **Step 6: Log the split** in the execution log with both repo URLs and
the first infra tag SHA.

---

## Task 9: Branch protection, security settings

**Corrected per review §9/§10:** explicit required check contexts, honest
approval wording, and an actual mechanism for prod actor restriction.

> Requires founder approval before running (changes repo settings).

- [ ] **Step 1: `main` protection — with the exact check contexts**

The required status check contexts MUST match the check-run names the
workflows actually produce (verify in the Checks tab of a real PR first;
adjust names below to the observed values):

```bash
gh api -X PUT repos/nskreddy1/auxelon-app/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "CI / check",
      "Security / security",
      "AI Review / review",
      "Architecture / architecture"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

**Honest wording (review §9):** this is *"PR required; approval count 0; all
required checks must pass."* No human approval is required on `main` — that
is intentional for a solo founder and must never be described as "approval
required". The human approval gate lives in the `production` Environment.

- [ ] **Step 2: `prod` — actual bot-only push mechanism (review §10)**

"Bot-push only" is a requirement; this is the implementation. Use a
**repository ruleset** targeting `refs/heads/prod`:

```text
1. Create a ruleset (Settings → Rules → Rulesets, or `gh api repos/.../rulesets`):
   - target: prod
   - block force pushes, block deletions, restrict updates
   - bypass list: ONLY the GitHub App / deploy identity used by
     promote-to-prod (and rollback). No human actors in the bypass list.
2. The promote workflow authenticates as that App (or a fine-grained deploy
   token stored in the `production` environment) — that identity is the only
   thing that can move `prod`.
3. Verify: a human push to prod is rejected; a workflow-driven fast-forward
   succeeds. Record both results in the execution log.
```

- [ ] **Step 3: GitHub Environments** — `production` (manual approval —
this is the human gate), `db-production` (manual approval; sole holder of
production `SUPABASE_DB_URL`).

- [ ] **Step 4: Verify + commit + log**

---

## Task 10: `check:architecture` — executable governance

- [ ] **Step 1: Implement the script** — new `scripts/check-architecture.mjs`
wired into `pnpm check` and CI, validating ARCH-001 … ARCH-010 (addendum §E):
vendor-SDK import boundaries (baseline-aware, reusing the Task 2 baseline
mechanism), `account_id` scoping heuristic in data layers, no prod-secret
names in app code, webhook idempotency present, workflow `uses:` refs pinned
to tag/SHA (never a branch), docs mirror synchronized.

- [ ] **Step 2: Warn mode first; error mode when the baseline is near zero.**

- [ ] **Step 3: Verify + commit + log**

```bash
pnpm check   # now includes check:architecture
git commit -m "feat(ci): architecture invariants as executable policy (ADR-003 §7, ARCH-001..010)"
```

---

## Task 11: Founder setup checklist (manual, with founder)

Nothing here is code; record completion in the execution log.

- [ ] Cloudflare: API token + account ID → GitHub secrets; confirm Workers
  plan (first paid step = **Workers Paid $5/mo** when the free CPU limit,
  100k req/day, or log retention bites).
- [ ] Hyperdrive: create **one** config using the **direct** (non-pooled)
  Supabase connection string — Hyperdrive does the pooling itself; never give
  it the Supavisor-pooled string. Paste the ID into `wrangler.jsonc`.
  (A second no-cache config is added only if a measured caching requirement
  appears — review §3.)
- [ ] Grafana Cloud (Loki push URL + token), Sentry DSN, Langfuse keys
  (optional — adapter no-ops without them), Upstash already configured.
- [ ] `SUPABASE_DB_URL` (production) → `db-production` environment ONLY.
- [ ] GitHub Environments approvals verified by dry-running `promote-to-prod`
  up to the approval gate, then cancelling.
- [ ] Ruleset verification from Task 9 Step 2 (human push rejected; bot
  fast-forward succeeds).
- [ ] Run the Task 1 authenticated smoke test (all five criteria) on a preview
  deploy; record results in the log. **First production promotion only after
  this passes.**

**Cost statement (corrected wording, review §16):** **$0 platform baseline
assuming free-tier quotas are sufficient; third-party usage beyond free
allocations may incur charges.** Cloudflare free tier (100k req/day; Hyperdrive
100k queries/day free), Grafana Cloud free (50 GB logs/traces/profiles,
14-day retention), Sentry Developer (5k errors/mo), Langfuse Hobby (50k
units/mo — model real usage before trusting headroom), Upstash free tier.
First paid step: Workers Paid $5/mo (10M req/mo included).

---

## Self-review checklist (before marking the plan done)

- [ ] Every ADR-001 §13 coverage-matrix row is implemented or explicitly deferred.
- [ ] ADR-002 Phase 0 exit criteria met: `pnpm check` green, boundary check in
  warn mode, zero runtime behavior change.
- [ ] External review round-3 mandatory edits verified in the diff:
  single interception file (Task 1), Hyperdrive-now (Task 2/4/11), single
  Hyperdrive binding (Task 4), explicit check contexts + prod ruleset (Task 9),
  workflow_run eligibility + artifact SHA verification (Task 7).
- [ ] **Cross-reference audit (review §20):** every `ADR-001 §…` /
  `ADR-002 §…` / `ADR-003 §…` citation in this plan resolves to the section it
  claims in the current repository documents — checked one by one, not
  "coverage matrix says so". Task numbering in this v2 plan (0–11) supersedes
  the v1 numbering (0–9); the execution log records the mapping if any v1
  reference survives elsewhere.
- [ ] NFR-001 … NFR-010 each map to at least one task or runbook item.
- [ ] Execution log has an entry per task with commit SHAs.

## Out of scope

- First real production deploy (needs real tokens/env values — Task 11 hands off).
- ADR-002 Phases 1–3 (hot-path repository conversion, breadth, rehearsal).
- Cloudflare Queues / `QueuedMessageIngress` (scale ladder stage 3 — the seam
  ships in Task 3, the queue does not).
- Circuit-breaker activation (interfaces only; enable per provider when
  failure data justifies it).
- In-app logo replacement / rename (Part A follow-up after founder selection —
  see `docs/brand/assets/concepts/DECISION.md`).

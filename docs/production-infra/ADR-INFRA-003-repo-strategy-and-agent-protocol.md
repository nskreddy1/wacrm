# ADR-INFRA-003: Repository strategy and AI-agent coordination protocol

- **Status:** Proposed — awaiting founder sign-off. No repo creation or migration begins until Accepted.
- **Date:** 2026-08-22
- **Deciders:** Founder (delegated the repo-split design; this ADR records the decision for approval)
- **Related:** ADR-INFRA-001 (deployment infrastructure), ADR-INFRA-002 (database portability), `docs/brand/brand-strategy.md` §8 (repo naming)
- **Incorporates:** the second external review round (2026-08-22) — its three mandatory changes are decided here in §6 (immutable promotion), §5.3 (production-DB prohibition), §7 (`check:architecture`).

---

## 1. Decision — two repositories, migrations stay with the app

```text
auxelon-app   (private GitHub repo — the product)
├── src/  supabase/migrations/  scripts/  mcp-server/
├── .github/workflows/           # ci, security, ai-review, preview-deploy,
│                                # promote-to-prod, rollback, db-migrate
│                                # (thin callers → reusable workflows in auxelon-infra)
├── wrangler.jsonc, open-next.config.ts
└── AGENTS.md                    # agent contract incl. DB-change protocol (§5)

auxelon-infra (private GitHub repo — ops brain)
├── .github/workflows/           # REUSABLE workflows (workflow_call) the app calls
├── runbooks/                    # rollback, db-migrate, incident, migration-rehearsal
├── provisioning/                # Cloudflare/Grafana/Sentry/Langfuse/Upstash setup
│                                # scripts + docs (idempotent, re-runnable)
├── secrets-inventory.md         # every secret: where it lives, who rotates, NO values
├── architecture/                # mirrors of the infra ADRs + system diagrams
└── AGENTS.md                    # ops agent contract
```

One-line ownership model:

```text
auxelon-app   = WHAT the product is   (product truth)
auxelon-infra = HOW it is operated    (ops truth)
```

### Rationale

- **Migrations live with the app.** Schema and the code consuming it must change
  atomically: migration + repository + service + API in the same PR. Splitting
  schema into a second repo is the classic cross-repo drift failure
  ("Repo A expects schema v17, Repo B deploys v18, app runs v16"). The
  RLS/`SECURITY DEFINER` invariants stay enforced by the app repo's existing
  `scripts/push-supabase-schema.mjs` + CI.
- **GitHub Actions constraint (technical fact):** workflows triggered by app
  pushes must live in the app repo. `auxelon-infra` therefore holds the
  *reusable* (`workflow_call`) implementations so ops logic is centrally owned
  and versioned; the app repo contains thin callers.
- **Hosting: GitHub.** Free private repos, free Actions minutes sufficient at
  solo volume, GitHub Models AI review free with `GITHUB_TOKEN` (already an
  ADR-INFRA-001 dependency). No reason to go elsewhere.

## 2. Ownership boundary (explicit, so nobody has to ask in six months)

| Concern | Owner |
| --- | --- |
| Workflow invocation, application-specific deploy conditions | `auxelon-app` |
| Application build, application artifact, release manifest content | `auxelon-app` |
| Schema, migrations, seeds, schema docs (`db:doc`) | `auxelon-app` |
| Reusable deployment mechanics (`workflow_call` internals) | `auxelon-infra` |
| Cloud provisioning (Cloudflare, Grafana, Sentry, Langfuse, Upstash) | `auxelon-infra` |
| Operational runbooks, incident procedures, secret inventory | `auxelon-infra` |
| Generic release mechanics (tagging, artifact storage conventions) | `auxelon-infra` |

Rule of thumb recorded for future questions ("should this Cloudflare deployment
condition live in app or infra?"): **if it needs product context to be correct,
it belongs in `auxelon-app`; if any app could reuse it unchanged, it belongs in
`auxelon-infra`.**

## 3. Migration of the existing repo — mirror, don't copy

- `git push --mirror` from `wacrm` → `auxelon-app`: preserves history, branches,
  tags, commit identity, and blame. For an AI-heavy codebase, historical context
  has real value.
- `wacrm` is then archived (GitHub "Archive repository" — read-only).
  **No future production development occurs in `wacrm`.** This sentence is the
  guard against the archive becoming a zombie repo; it is repeated in both
  `AGENTS.md` files and in `wacrm`'s final README commit.
- `auxelon-infra` starts as a fresh scaffold (no history to preserve).

## 4. Security posture

- Branch protection on `main` + `prod` in `auxelon-app` (PR required, checks
  green, `prod` bot-push only) and on `main` in `auxelon-infra`.
- Secrets exist only in GitHub Environments and Cloudflare — never in either
  repo. `auxelon-infra/secrets-inventory.md` documents names, locations, and
  rotation owners only; **no values, ever**.
- GitHub Environments: `production` requires manual approval; `db-production`
  (used only by `db-migrate.yml`) requires manual approval **plus** the
  destructive-operation confirmation from ADR-INFRA-001 §5.

## 5. AI-agent coordination protocol (written into both `AGENTS.md` files)

Every AI agent (and human) working in either repo follows this. It is the
"every AI must handle this" requirement, made machine-checkable where possible (§7).

### 5.1 Context order (authoritative sources, in order)

```text
AGENTS.md
  → .agents/context/README.md
    → live schema doc (pnpm db:doc output)
      → the code itself
```

**Live schema wins.** An agent never trusts a table it saw in old docs; it
regenerates/reads the current `db:doc` output before touching data code.

### 5.2 DB-change protocol (app repo)

1. New timestamped **idempotent** migration only (`YYYYMMDDHHMMSS_description.sql`).
2. Never edit an applied migration; undo = **compensating migration**.
3. After schema change: `pnpm db:push` → `pnpm db:doc` → `pnpm docs:sync`.
4. Schema + consuming code in the **same PR**.
5. Destructive ops flagged in the PR title (`[destructive-migration]`) so the
   `db-migrate.yml` manual gate is expected, not a surprise.
6. **Expand → migrate → contract** for any destructive change on live data:
   add new column/table → deploy code using both → backfill → switch
   reads/writes → remove the old column in a later, separately-gated migration.
   Never collapse these phases into one deploy.
7. Per ADR-INFRA-002: new SQL goes through `src/lib/db/` + repositories,
   explicit `account_id` scoping, no `@supabase/*` imports outside adapters.

### 5.3 Production database prohibition (mandatory — external review change #2)

```text
Agents MUST NOT invoke production database mutation commands.
pnpm db:push (and any direct SQL execution) is permitted ONLY against the
development database. Production migrations are executed only by
db-migrate.yml using the db-production GitHub Environment and its
required manual approval.
```

Enforcement is layered, not merely procedural: the production `SUPABASE_DB_URL`
exists **only** as a `db-production` Environment secret — it is never present in
developer/agent environments, so an agent cannot reach production even by
mistake. `dev DB → agents; prod DB → gated automation only.`

### 5.4 Cross-repo protocol

- An agent working in `auxelon-app` **never edits reusable workflow internals**;
  it opens an issue/PR in `auxelon-infra` instead.
- An agent working in `auxelon-infra` **never assumes schema**; it links to the
  app repo's schema doc.
- Every PR in either repo must pass `pnpm check` (app) / the infra lint suite,
  security scan, and the AI review gate before merge — blocking only on
  machine-verifiable categories (ADR-INFRA-001 §4.3).

## 6. Immutable promotion identity (mandatory — external review change #1)

An artifact being immutable is not enough if the *deployment procedure* can
change under the same reference. Production promotion therefore pins all three:

```text
exact commit SHA          (SHA-pinned workflow_run checkout — ADR-001 §4.1)
+ exact artifact SHA256   (release-manifest.json — ADR-001 §4.2)
+ exact deployment workflow version
```

Reusable workflow references from `auxelon-app`:

- Normal workflows: pinned to an **immutable release tag**
  (`uses: nskreddy1/auxelon-infra/.github/workflows/deploy.yml@v1.2.0`).
  `auxelon-infra` publishes tags as immutable releases and **never moves or
  deletes a published tag** (recorded in its `AGENTS.md`; a floating `@v1`
  alias is not used for anything that deploys).
- Production-sensitive workflows (`promote-to-prod`, `rollback`, `db-migrate`
  internals): pinned to a **full commit SHA**
  (`uses: nskreddy1/auxelon-infra/.github/workflows/promote.yml@<40-char-sha>`).
- The `release-manifest.json` additionally records the infra workflow ref used,
  so every release states its deployment-logic identity alongside its artifact
  identity.

## 7. Architecture as executable policy (mandatory — external review change #3)

Architecture rules must not live only in Markdown. `auxelon-app` gains a
`check:architecture` CI step (extending the existing `check-boundaries.mjs`
pattern) that fails on:

| Invariant | Check |
| --- | --- |
| No `@supabase/*` imports outside adapter allowlist | boundary check (ADR-002 §3.1; warn-mode baseline first, then fail) |
| Explicit `account_id` scoping in repositories | lint rule / grep heuristic over `src/lib/data/` |
| No direct DB access from feature code | boundary check |
| No production env usage outside gated workflows | grep for prod-only secret names in app/scripts code |
| Reusable workflow references are pinned (tag or SHA, never a branch) | workflow-file lint |
| ADR/doc mirror synchronized | existing `pnpm docs:sync` check |

Rollout: **warn mode with a committed baseline → measure violations → fix
consumers → error mode.** Never flip to hard failure while the baseline is
large — that turns the migration into a fight with the checker.

## 8. Amendments to ADR-INFRA-001/002 adopted from the same review

Recorded here (both earlier ADRs are still Proposed; these are folded into the
implementation plan rather than rewriting them):

1. **Health endpoint split.** `/api/health` = liveness only (Worker alive; fast,
   no external calls). `/api/health/dependencies` = readiness (Supabase, Redis,
   critical dependencies). Uptime monitors and any future load-balancer checks
   use liveness; dependency degradation must not read as "application dead".
2. **Standard correlation vocabulary** for all observability adapters:
   `request_id, trace_id, account_id, user_id, operation, route,
   release_version, git_sha` — propagated through HTTP → webhook → queue →
   AI call → DB.
3. **Langfuse logging policy.** WhatsApp CRM prompts contain PII (phone numbers,
   names, customer messages). The tracing adapter defines: what is safe to log,
   what is redacted, what is hashed, what is never stored. Raw customer
   conversations are **not** sent to the external tracing platform by default.
4. **Cache authority rule** (sharpened): `Redis = shared cache; memory =
   best-effort optimization; database = source of truth.` An in-memory value may
   never feed an authorization decision. Fine for AI provider config, account
   settings, channel config; never for permissions, billing, authentication, or
   security state.
5. **`src/lib/db/` stays boring.** Four files (`client.ts`, `sql.ts`,
   `transaction.ts`, `errors.ts`) — a connection + tagged-template helper, not a
   home-grown ORM. Features → repositories → `src/lib/db/`.
6. **Implementation resequencing:** the ADR-002 Phase 0 DB/auth boundary
   baseline moves **ahead of** most infra code, because it establishes the
   boundaries the rest of the system must preserve. The plan doc encodes the
   final order.

## 9. Consequences

**Positive:** clean ownership boundary without cross-repo schema drift; ops
logic centrally owned, versioned, and immutably pinned; agents structurally
prevented (not just instructed) from mutating production data; architecture
rules enforced by CI rather than memory; full history preserved for AI context.

**Negative / accepted:** two repos means occasional two-PR changes (workflow
interface changes touch both); immutable pinning means the app repo must bump
refs to pick up infra fixes (deliberate — that bump *is* the review gate);
solo-founder bus factor unchanged, mitigated only by runbook quality.

## 10. Execution

The step-by-step execution (including exact `gh` commands, workflow file
contents, and the founder setup checklist) lives in
[`docs/superpowers/plans/2026-08-22-production-infrastructure.md`](../superpowers/plans/2026-08-22-production-infrastructure.md)
— Tasks 7–9. Nothing in this ADR is executed until it is Accepted.

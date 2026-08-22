# ADR-INFRA-002: Database portability — loosely coupled data layer

- **Status:** Proposed — awaiting founder sign-off. No implementation begins until this is Accepted.
- **Date:** 2026-08-22
- **Deciders:** Founder (solo)
- **Related:** ADR-INFRA-001 §9 (Supabase coupling assessment) — this ADR turns that assessment into a full implementation plan.

---

## 1. Context and goal

wacrm currently runs on Supabase (Postgres + Auth + Storage + Realtime, RLS on all 88 public tables) and uses RAG (pgvector embeddings) in the assistant feature.

**Founder decision (recorded):** we are **not migrating now**. But at 100K+ users, staying on Supabase may not be the right cost/control position, so the data layer must be **prepared for migration** — loosely coupled, so leaving Supabase is a planned project, not a rewrite.

**Chosen portability target: Postgres-portable.** The app must be able to run on **any Postgres host** (Supabase, Neon, AWS RDS/Aurora, Oracle Cloud's Postgres service, self-hosted) with an adapter/config change per subsystem — while keeping RLS, pgvector, and Postgres SQL features.

**Explicitly rejected: engine-agnostic (Oracle Database / MySQL) portability.** Honest engineering assessment:

- RLS (the security backbone of this multi-tenant app, on all 88 tables) has no portable equivalent — Oracle VPD and MySQL's lack of RLS would each force a full authorization rewrite in the application layer.
- pgvector-based RAG would need a different vector store per engine.
- 131 migrations, 25 `SECURITY DEFINER` RPC paths, triggers, and Postgres-specific SQL would all need per-engine variants, tested forever.
- The cost is a multi-month rewrite plus permanent dual-engine test burden, purchased pre-revenue for a scenario (leaving Postgres itself) that has no plausible trigger. Postgres is open-source, runs on every cloud including Oracle Cloud and on-prem, and is not a vendor.

**The durable invariant is therefore:** *coupled to Postgres (a standard, un-ownable technology) — never coupled to Supabase (a vendor).*

---

## 2. Coupling inventory (measured against the live repo, Aug 2026)

| Subsystem | Coupling today | Measured footprint | Portability risk |
| --- | --- | --- | --- |
| SQL queries via `supabase-js` query builder (`.from()`) | PostgREST-specific API, not SQL | **724 call sites**, 112 files importing `@/lib/supabase` | **HIGH — the main body of work** |
| RPC calls (`.rpc()`) | PostgREST RPC over SQL functions | 25 call sites | LOW — functions are plain Postgres; only the transport changes |
| Auth (`.auth.*`, GoTrue) | Supabase Auth sessions, cookies, `auth.uid()` inside RLS policies | 38 files | **HIGH — second-largest coupling** |
| Realtime (`.channel()`) | Supabase Realtime SDK subscription model | 4 files | MEDIUM, small surface |
| Storage (`.storage`) | Supabase Storage buckets | 2 files | LOW, tiny surface |
| RLS policies + `SECURITY DEFINER` helpers | Pure Postgres **except** `auth.uid()` (Supabase-injected) | all 88 tables | LOW once auth claim source is abstracted |
| Migrations (`supabase/migrations/`, `pnpm db:push`) | Plain SQL files; the *runner* is Supabase-flavored | 131 migrations | LOW — SQL is portable; runner needs a generic mode |
| pgvector / RAG | Standard OSS Postgres extension, raw SQL | assistant feature | **NONE** — portable via `pg_dump` (per ADR-INFRA-001 §9) |
| Raw-SQL data layer (`src/lib/data/`) | Already close to portable | 13 files | NONE — this is the pattern to expand |

Key insight: **pgvector and the SQL itself are not the problem. The `supabase-js` query builder (724 sites) and Auth (38 files) are the two real couplings.** Realtime and Storage are small and already flagged in ADR-INFRA-001.

---

## 3. Decision — target architecture

### 3.1 Rules (enforceable, reviewable)

1. **Feature code never imports a vendor SDK.** `@supabase/*` imports are permitted only inside `src/lib/db/`, `src/lib/auth-provider/`, `src/lib/realtime/`, `src/lib/storage/` adapter modules. Enforced by extending `scripts/check-boundaries.mjs` (already part of `pnpm check`).
2. **All domain reads/writes go through repositories** in `src/lib/data/` (server) — the pattern that already exists for 13 files becomes the only pattern. Repositories speak SQL (or the thin DB adapter), never PostgREST.
3. **Every repository query is `account_id`-scoped in SQL**, not only via RLS. Today RLS is the enforcement layer *and* implicit filter; after this ADR, repositories filter explicitly and RLS remains as defense-in-depth. This is also the prerequisite for any future host whose pooling path bypasses RLS claims.
4. **SQL stays ANSI-leaning Postgres.** Postgres features are allowed (RLS, jsonb, pgvector, CTEs); Supabase-only schemas (`auth.*`, `storage.*`) may be referenced only inside adapters and a documented shim (§3.3).
5. **New code follows the rules from day one.** Existing code migrates by the phased plan (§4) — no big-bang rewrite.

### 3.2 Module layout

```text
src/lib/db/               # NEW — the only place that knows how to reach Postgres
  client.ts               #   postgres-js (or pg) connection via DATABASE_URL
                          #   (works with Supavisor today, Hyperdrive/Neon/RDS later — ADR-INFRA-001 §7)
  sql.ts                  #   tagged-template helper, parameterized only, query timing hooks (ADR-INFRA-001 §7.1)
  transaction.ts          #   transaction helper
src/lib/data/             # EXISTING pattern, expanded — one repository module per domain
  contacts/ conversations/ messages/ pipelines/ flows/ ...
src/lib/auth-provider/    # NEW — session facade: getSession(), getUser(), requireAccountMember()
                          #   backed by Supabase Auth today; swappable to Better Auth/self-hosted GoTrue
src/lib/realtime/         # per ADR-INFRA-001 §9 — subscribe/unsubscribe interface over Supabase Realtime
src/lib/storage/          # EXISTS — verify both call sites go through it
```

The `supabase-js` client remains — as the internal engine of the auth/realtime/storage adapters, not as the app's query interface.

### 3.3 The `auth.uid()` shim (the one subtle piece)

RLS policies call `is_account_member(account_id, roles[])`, which resolves the caller from Supabase's `auth.uid()`. On a non-Supabase host there is no `auth` schema. Portability shim, prepared now, needed only at migration time:

- All policy helpers already funnel through `is_account_member` — **keep it that way** (audit for stragglers in Phase 1).
- Inside it, isolate the caller-identity lookup into one function, e.g. `current_app_user_id()`, which today returns `auth.uid()`.
- On any other Postgres host, the same function reads `current_setting('app.user_id', true)`, set per-connection/per-transaction by `src/lib/db/client.ts` from the verified session.
- Result: the migration-day RLS change is **one function body**, not 88 tables × N policies.

### 3.4 What each subsystem swap costs after this ADR is implemented

| Subsystem | Swap cost after implementation |
| --- | --- |
| Postgres host (Supabase → Neon/RDS/self-hosted) | `pg_dump`/logical replication + change `DATABASE_URL` + apply the `current_app_user_id()` variant |
| Auth (Supabase Auth → Better Auth / self-hosted GoTrue) | Reimplement `src/lib/auth-provider/` facade (38 files untouched) |
| Realtime (Supabase → self-hosted Realtime / Pusher / SSE) | Reimplement `src/lib/realtime/` adapter (4 files untouched) |
| Storage (Supabase → S3/R2) | Reimplement `src/lib/storage/` adapter (2 call sites) |
| Vector store | None — pgvector travels with the database |

---

## 4. Implementation plan — phased, no big bang

Migration pressure is not uniform: hot paths and new code matter; cold admin screens can keep the query builder for years without harm.

### Phase 0 — Foundations (do with ADR-INFRA-001 implementation; same PR series)

1. Add `src/lib/db/` (client + sql + transaction) using the Supavisor transaction-pooler settings already decided (port 6543, `prepare: false`) and Hyperdrive-ready.
2. Add `src/lib/auth-provider/` facade with the current Supabase implementation; new code must use it.
3. Extend `scripts/check-boundaries.mjs`: fail on `@supabase/*` imports outside the adapter allowlist. Start in **warn mode** with a baseline file (like a lint baseline) so the 112 existing files don't block CI; new violations fail.
4. Add the `current_app_user_id()` SQL function (returning `auth.uid()` for now) via a normal timestamped migration; refactor `is_account_member` to call it. Zero behavior change; `pnpm db:push`, `pnpm db:doc`, `pnpm docs:sync`.
5. Document the repository rules in `.agents/context/database.md`.

**Exit criteria:** `pnpm check` green; boundary check active in warn mode; no runtime behavior change.

### Phase 1 — Hot paths to repositories (highest value, aligns with ADR-INFRA-001 §7 performance work)

Convert, in order: WhatsApp webhook ingest → auto-reply pipeline (Flows → Automations → AI reads) → inbox conversation/message queries → `/api/v1` public routes (stability contract — behavior must be bit-identical; contract tests first).

Each conversion: write the repository with explicit `account_id` scoping + query timing, port call sites, delete the builder calls, add/keep tests. These are also the paths that gain from Hyperdrive + caching, so this phase pays for itself in performance, not just portability.

**Exit criteria:** zero `.from()` calls in webhook, assistant, inbox, and `/api/v1` server code.

### Phase 2 — Breadth (background, opportunistic)

- Rule: **any file you touch for feature work gets its queries converted** (boy-scout rule), tracked by the boundary-check baseline shrinking.
- Batch-convert per feature module when convenient: contacts, pipelines, broadcasts, dashboards, settings…
- Realtime: confirm all 4 `.channel()` files go through `src/lib/realtime/`; Storage: confirm both `.storage` call sites go through `src/lib/storage/`.
- Client components that query Supabase directly move to API routes/server actions backed by repositories (this also shrinks the client bundle and centralizes authorization).

**Exit criteria (long-running):** baseline file trending to zero; boundary check flipped from warn to **fail**.

### Phase 3 — Migration rehearsal (before ~100K users, or at first serious pricing/compliance trigger)

Prove portability *before* it's needed:

1. Stand up a scratch Postgres (Neon free tier or local Docker) — **not** Supabase.
2. Restore schema + data: run all migrations with a generic runner mode of `scripts/push-supabase-schema.mjs` (plain `psql`-driven), then `pg_dump | pg_restore` a staging snapshot, pgvector included.
3. Apply the `current_app_user_id()` session-variable variant; run the RLS test suite against it.
4. Point a staging build's `DATABASE_URL` at it; run smoke tests for the Phase-1 hot paths.
5. Write `docs/production-infra/runbooks/db-migration-rehearsal.md` with findings, timings, and the real cutover plan (logical replication → dual-write window → cutover), including what still depends on Supabase (Auth, Realtime, Storage — each with its adapter swap cost from §3.4).

**Exit criteria:** rehearsal doc exists; the app demonstrably boots and serves hot paths against non-Supabase Postgres.

---

## 5. Decision triggers (when to actually migrate — mirrors ADR-INFRA-001 §10)

| Trigger | Action |
| --- | --- |
| Supabase Pro + compute upgrades still cost-effective | **Stay.** Portability is insurance, not a goal. |
| Sustained load approaching 100K+ users, compute/egress pricing dominating | Run Phase 3 rehearsal against the candidate host; compare TCO; decide. |
| Enterprise client requires specific cloud/region/on-prem | Same rehearsal, targeted at the required host. |
| Supabase pricing/policy change materially adverse | Rehearsal already done → execute the cutover runbook. |

---

## 6. Consequences

**Positive:** exit path from Supabase becomes a measured, rehearsed operation; explicit `account_id` scoping adds defense-in-depth beyond RLS; hot-path conversion doubles as the ADR-INFRA-001 performance work; SQL-first repositories make query timing/optimization tractable; RAG/pgvector confirmed portable at zero cost.

**Negative / accepted:**

- 724 call sites will take months to fully convert — accepted via phasing; the baseline mechanism makes progress visible without blocking work.
- Repositories are more code than inline query-builder calls — accepted; it is the same pattern `src/lib/data/` already uses.
- Auth remains the hardest coupling; the facade contains it but a real auth migration is still a project (session invalidation, password-hash export). Documented, not eliminated.
- Engine-agnostic (Oracle/MySQL) portability is consciously **not** provided; revisit only if a paying enterprise contract demands a specific non-Postgres engine — at which point that contract funds the work.

---

## 7. Review checklist for every data-layer PR

- [ ] No `@supabase/*` import outside adapter modules (CI-enforced)
- [ ] Query goes through a repository; parameterized; explicit `account_id` filter
- [ ] No Supabase-only schema reference (`auth.*`, `storage.*`) outside adapters/shim
- [ ] RPC bodies remain plain Postgres (`SECURITY DEFINER` invariant per repo rules)
- [ ] `/api/v1` behavior unchanged (contract tests) when touched

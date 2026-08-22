# Runbook — Task 8: repo split (PREPARED, awaiting founder execution)

Status: **scripts prepared, not executed** (founder chose "prepare scripts
only" on 2026-08-22). Nothing below has run; no repos exist yet.

## What is prepared

| Artifact | Purpose |
| --- | --- |
| `scripts/infra/task8-repo-split.sh` | Executes the split: mirror `wacrm` → `auxelon-app`, scaffold `auxelon-infra` + tag `v1.0.0`, archive `wacrm`. Dry-run by default (`DRY_RUN=1`). |
| `scripts/infra/auxelon-infra-seed/` | The initial content pushed to `auxelon-infra`: README, AGENTS.md (agent protocol + immutable-tag rule), runbooks (rollback / db-migrate / incident / migration-rehearsal), provisioning docs, secrets-inventory. |

## How to execute (founder, local machine)

```bash
# Prerequisites: gh auth login (as nskreddy1), git
DRY_RUN=1 ./scripts/infra/task8-repo-split.sh   # review the plan
DRY_RUN=0 ./scripts/infra/task8-repo-split.sh   # execute, confirming each step
```

## Post-split manual steps (Step 3 of the plan — a normal PR in auxelon-app)

1. Extract the reusable bodies of `promote-to-prod.yml`,
   `rollback-production.yml`, `db-migrate.yml` into
   `auxelon-infra/.github/workflows/` as `workflow_call` workflows; tag a new
   release.
2. Re-point the app's thin callers:
   - normal workflows → `nskreddy1/auxelon-infra/.github/workflows/<x>.yml@vX.Y.Z`
   - promote / rollback / db-migrate → `@<full-40-char-commit-sha>` (ARCH-009)
3. Add the ADR-003 §5 protocol sections to `auxelon-app/AGENTS.md` (context
   order, DB-change protocol, production-DB prohibition, cross-repo protocol,
   "no future production development in wacrm", Dependency Rule + pattern
   budget).
4. Run `pnpm check` (includes `check:architecture` — ARCH-009 fails on any
   branch-pinned `uses:`).

## Notes / deviations recorded in advance

- The current repo has **no `main` branch**; the mirror preserves all
  branches as-is. After the split, pick/rename the default branch in
  `auxelon-app` (Settings → Branches) before applying Task 9 protection.
- Archiving `wacrm` is last and only after `auxelon-app` CI is green.

After execution, append the entry (repo URLs + v1.0.0 tag SHA) to
`docs/superpowers/plans/2026-08-22-production-infrastructure.log.md`.

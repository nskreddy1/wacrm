# Runbook — Task 9: branch protection, prod ruleset, Environments (PREPARED)

Status: **script prepared, not executed** (founder chose "prepare scripts" on
2026-08-22). Run only after Task 8's repo split — the settings target
`auxelon-app`.

## What is prepared

`scripts/infra/task9-github-settings.sh` — dry-run by default. Three gated
steps:

1. **Default-branch protection** — PR required, **approval count 0** (honest
   wording: no human approval on the default branch; that is intentional for
   a solo founder — the human gate lives in the `production` Environment),
   strict status checks with the four exact contexts the current workflows
   produce:
   - `CI / check`
   - `Security / security`
   - `AI Review / review`
   - `Architecture / architecture`

   Before running: open a real PR and verify these names in the Checks tab —
   adjust the script if any differ.

2. **`prod` ruleset (bot-only)** — blocks deletion, force pushes, and updates
   on `refs/heads/prod`; the ONLY bypass actor is the deploy identity
   (GitHub App id via `DEPLOY_APP_ID`). No human actors in the bypass list.

3. **Environments** — `production` and `db-production`, each with the founder
   as required reviewer. `db-production` is the sole holder of the production
   `SUPABASE_DB_URL` (Task 11 puts the value there; NFR-007).

## How to execute (founder, local machine)

```bash
gh auth login                       # as nskreddy1
gh api user --jq .id                # → REVIEWER_ID
DRY_RUN=1 ./scripts/infra/task9-github-settings.sh
DRY_RUN=0 BRANCH=production-infrastructure-architecture \
  DEPLOY_APP_ID=<app-id> REVIEWER_ID=<id> \
  ./scripts/infra/task9-github-settings.sh
```

## Mandatory verification (record both in the execution log)

```text
1. Human push to prod        → git push origin HEAD:prod  → REJECTED
2. Workflow fast-forward     → promote-to-prod (through the approval gate)
                               moves prod → SUCCEEDS
```

## Notes

- `wacrm` has no `main` branch. The release branch is
  `production-infrastructure-architecture`, which is also the GitHub default
  branch and the branch every workflow now triggers on. Set `BRANCH` to that
  value (or to the new default if `auxelon-app` renames it after the split —
  in which case update the `on:` triggers and the promotion eligibility gate
  in the same commit, or CI stops firing entirely).
- Secrets and variables to populate: see `runbooks/env-and-secrets.md`.
- If the promote workflow uses the built-in `GITHUB_TOKEN` rather than a
  GitHub App, prefer creating a dedicated App anyway — a bypass list with a
  human PAT would violate the "no human actors" rule.

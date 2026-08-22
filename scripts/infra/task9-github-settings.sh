#!/usr/bin/env bash
# Task 9 — Branch protection, prod ruleset, GitHub Environments (ADR-INFRA-001 §4).
#
# ⛔ PREPARED, NOT EXECUTED. Founder chose "prepare scripts only" (2026-08-22).
# Run manually with `gh` authenticated as the founder, AFTER Task 8's split
# (the target repo defaults to auxelon-app).
#
# What it does, each step gated by a confirmation prompt:
#   1. Protect the default branch: PR required, approval count 0 (honest
#      wording — the human gate is the `production` Environment), all four
#      required check contexts must pass, enforce_admins, no force push.
#   2. Create a repository ruleset for `prod`: block force pushes, block
#      deletions, restrict updates; bypass list = ONLY the deploy identity
#      (GitHub App id passed via DEPLOY_APP_ID). No human actors.
#   3. Create the `production` and `db-production` Environments, both with a
#      required reviewer (the founder) — the actual human approval gates.
#
# Usage:
#   DRY_RUN=1 ./scripts/infra/task9-github-settings.sh   # default: print only
#   DRY_RUN=0 BRANCH=main DEPLOY_APP_ID=<app-id> REVIEWER_ID=<user-id> \
#     ./scripts/infra/task9-github-settings.sh
#
# Find ids:
#   REVIEWER_ID:   gh api user --jq .id
#   DEPLOY_APP_ID: gh api /repos/$OWNER/$REPO/installation --jq .app_id  (or the App's settings page)
set -euo pipefail

OWNER="${OWNER:-nskreddy1}"
REPO="${REPO:-auxelon-app}"
BRANCH="${BRANCH:-main}"          # NOTE: wacrm currently has NO main branch —
                                  # set the real default branch after the split.
DRY_RUN="${DRY_RUN:-1}"
DEPLOY_APP_ID="${DEPLOY_APP_ID:-}" # GitHub App id used by promote/rollback
REVIEWER_ID="${REVIEWER_ID:-}"     # founder's numeric user id

run_api() {
  echo "+ gh api $*"
  if [ "$DRY_RUN" = "0" ]; then gh api "$@"; fi
}

confirm() {
  echo
  echo "### $1"
  if [ "$DRY_RUN" = "0" ]; then
    read -r -p "Type 'yes' to proceed: " reply
    [ "$reply" = "yes" ] || { echo "Aborted."; exit 1; }
  else
    echo "(dry run — would prompt for confirmation)"
  fi
}

command -v gh >/dev/null || { echo "gh CLI required"; exit 1; }
echo "Target: $OWNER/$REPO (branch: $BRANCH) — DRY_RUN=$DRY_RUN"

# ── Step 1: default-branch protection with exact check contexts ─────────────
# The contexts MUST match the check-run names GitHub shows on a real PR
# ("<workflow name> / <job name>"). Verify in the Checks tab first; the
# current workflows produce exactly these:
confirm "Step 1: Protect '$BRANCH' (PR required; approval count 0; 4 required checks)"
run_api -X PUT "repos/$OWNER/$REPO/branches/$BRANCH/protection" --input - <<'JSON'
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

# ── Step 2: prod ruleset — bot-only push mechanism ───────────────────────────
confirm "Step 2: Ruleset on refs/heads/prod (bypass = deploy App only, no humans)"
if [ -z "$DEPLOY_APP_ID" ] && [ "$DRY_RUN" = "0" ]; then
  echo "DEPLOY_APP_ID is required for the bypass list (the identity promote-to-prod uses)."
  echo "If using GITHUB_TOKEN-based fast-forward instead of an App, create the"
  echo "ruleset WITHOUT a bypass and grant the workflow's token permission via"
  echo "the ruleset's 'restrict updates' + Actions exception — see runbook."
  exit 1
fi
run_api -X POST "repos/$OWNER/$REPO/rulesets" --input - <<JSON
{
  "name": "prod-bot-only",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/prod"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "update" }
  ],
  "bypass_actors": [
    { "actor_id": ${DEPLOY_APP_ID:-0}, "actor_type": "Integration", "bypass_mode": "always" }
  ]
}
JSON

# ── Step 3: Environments (the human approval gates) ─────────────────────────
confirm "Step 3: Create Environments 'production' and 'db-production' (required reviewer = founder)"
if [ -z "$REVIEWER_ID" ] && [ "$DRY_RUN" = "0" ]; then
  echo "REVIEWER_ID required (gh api user --jq .id)"; exit 1
fi
for ENV_NAME in production db-production; do
  run_api -X PUT "repos/$OWNER/$REPO/environments/$ENV_NAME" --input - <<JSON
{
  "reviewers": [ { "type": "User", "id": ${REVIEWER_ID:-0} } ],
  "deployment_branch_policy": null
}
JSON
done

cat <<'EOF'

Verification (record BOTH results in the execution log):
  1. Human push rejected:   git push origin HEAD:prod   → must be REJECTED.
  2. Bot fast-forward OK:   run promote-to-prod through the approval gate on a
     no-op change → the workflow's fast-forward of `prod` must SUCCEED.
  3. Secrets: put production SUPABASE_DB_URL ONLY in db-production
     (Task 11 — never anywhere else).
EOF

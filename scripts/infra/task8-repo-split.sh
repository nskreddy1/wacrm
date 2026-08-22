#!/usr/bin/env bash
# Task 8 — Repo split execution (ADR-INFRA-003 §1–§3).
#
# ⛔ PREPARED, NOT EXECUTED. This script was authored during the execution
# phase of docs/superpowers/plans/2026-08-22-production-infrastructure.md,
# but Task 8 requires explicit, separate founder approval before running.
# Run it manually, from a machine with `gh` authenticated as the founder.
#
# What it does (in order, each step gated by a confirmation prompt):
#   1. Mirror wacrm → auxelon-app (history-preserving).
#   2. Create auxelon-infra and push the seed scaffold from
#      scripts/infra/auxelon-infra-seed/ ; publish immutable tag v1.0.0.
#   3. (MANUAL, post-split) Re-point the app's production-sensitive workflow
#      `uses:` refs to nskreddy1/auxelon-infra@<full-sha> — see the runbook.
#   4. Archive wacrm with a final README pointer.
#
# Usage:
#   DRY_RUN=1 ./scripts/infra/task8-repo-split.sh   # print commands only (default)
#   DRY_RUN=0 ./scripts/infra/task8-repo-split.sh   # actually execute
set -euo pipefail

OWNER="${OWNER:-nskreddy1}"
SOURCE_REPO="${SOURCE_REPO:-wacrm}"
APP_REPO="${APP_REPO:-auxelon-app}"
INFRA_REPO="${INFRA_REPO:-auxelon-infra}"
DRY_RUN="${DRY_RUN:-1}"
SEED_DIR="$(cd "$(dirname "$0")" && pwd)/auxelon-infra-seed"
WORKDIR="$(mktemp -d)"

run() {
  echo "+ $*"
  if [ "$DRY_RUN" = "0" ]; then "$@"; fi
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

echo "Repo split: $OWNER/$SOURCE_REPO → $OWNER/$APP_REPO + $OWNER/$INFRA_REPO"
echo "DRY_RUN=$DRY_RUN (set DRY_RUN=0 to execute)"
command -v gh >/dev/null || { echo "gh CLI required"; exit 1; }

# ── Step 1: mirror wacrm → auxelon-app ──────────────────────────────────────
confirm "Step 1: Create $OWNER/$APP_REPO (private) and mirror-push full history"
run gh repo create "$OWNER/$APP_REPO" --private
run git clone --mirror "https://github.com/$OWNER/$SOURCE_REPO.git" "$WORKDIR/$SOURCE_REPO.git"
run git -C "$WORKDIR/$SOURCE_REPO.git" push --mirror "https://github.com/$OWNER/$APP_REPO.git"

# ── Step 2: scaffold auxelon-infra from the seed directory ──────────────────
confirm "Step 2: Create $OWNER/$INFRA_REPO and push seed scaffold + tag v1.0.0"
[ -d "$SEED_DIR" ] || { echo "Seed directory missing: $SEED_DIR"; exit 1; }
run gh repo create "$OWNER/$INFRA_REPO" --private
run git init "$WORKDIR/$INFRA_REPO"
run cp -R "$SEED_DIR/." "$WORKDIR/$INFRA_REPO/"
run git -C "$WORKDIR/$INFRA_REPO" add -A
run git -C "$WORKDIR/$INFRA_REPO" commit -m "chore(infra): initial scaffold — reusable workflows, runbooks, provisioning, agent protocol (ADR-003)" --trailer "Co-authored-by: v0 <it+v0agent@vercel.com>"
run git -C "$WORKDIR/$INFRA_REPO" branch -M main
run git -C "$WORKDIR/$INFRA_REPO" remote add origin "https://github.com/$OWNER/$INFRA_REPO.git"
run git -C "$WORKDIR/$INFRA_REPO" push -u origin main
# Immutable tag rule: a published tag is NEVER moved or deleted (ADR-003 §6).
run git -C "$WORKDIR/$INFRA_REPO" tag -a v1.0.0 -m "auxelon-infra v1.0.0 — first immutable release"
run git -C "$WORKDIR/$INFRA_REPO" push origin v1.0.0

if [ "$DRY_RUN" = "0" ]; then
  TAG_SHA=$(git -C "$WORKDIR/$INFRA_REPO" rev-parse v1.0.0^{commit})
  echo "v1.0.0 commit SHA (use for SHA-pinned uses: refs): $TAG_SHA"
fi

# ── Step 3: manual follow-up reminder ───────────────────────────────────────
cat <<'EOF'

Step 3 is MANUAL (in auxelon-app, a normal PR):
  - Extract the reusable bodies of promote-to-prod / rollback-production /
    db-migrate into auxelon-infra .github/workflows/ (workflow_call), tag a
    new release, then re-point the app's thin callers:
      normal workflows      → nskreddy1/auxelon-infra/.github/workflows/<x>.yml@v1.x.x
      promote/rollback/db   → @<full-40-char-sha>   (ARCH-009)
  - Verify: pnpm check:architecture passes (ARCH-009 forbids branch refs).
EOF

# ── Step 4: archive wacrm ───────────────────────────────────────────────────
confirm "Step 4: Add final README pointer to $SOURCE_REPO and ARCHIVE it (irreversible via CLI)"
run git clone --depth 1 "https://github.com/$OWNER/$SOURCE_REPO.git" "$WORKDIR/$SOURCE_REPO-archive"
if [ "$DRY_RUN" = "0" ]; then
  printf '\n> **ARCHIVED.** Development continues in [%s](https://github.com/%s/%s). No future production development happens in this repository (ADR-INFRA-003).\n' \
    "$OWNER/$APP_REPO" "$OWNER" "$APP_REPO" >> "$WORKDIR/$SOURCE_REPO-archive/README.md"
fi
run git -C "$WORKDIR/$SOURCE_REPO-archive" add README.md
run git -C "$WORKDIR/$SOURCE_REPO-archive" commit -m "docs: archive pointer to $APP_REPO" --trailer "Co-authored-by: v0 <it+v0agent@vercel.com>"
run git -C "$WORKDIR/$SOURCE_REPO-archive" push
run gh repo archive "$OWNER/$SOURCE_REPO" --yes

echo
echo "Done. Record both repo URLs + the v1.0.0 tag SHA in the execution log:"
echo "  docs/superpowers/plans/2026-08-22-production-infrastructure.log.md"

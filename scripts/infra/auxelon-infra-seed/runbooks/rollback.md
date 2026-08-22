# Runbook — production rollback

State machine: `RUNNING(vN) → FAIL → ROLLBACK_REQUEST → VERSION(vN-1) → VERIFY → RUNNING(vN-1)`

1. Identify the last-good release tag from GitHub Releases (each release has
   its manifest attached: git_sha, artifact_sha256, migration_version).
2. Trigger `Rollback Production` (manual dispatch) with the tag + the typed
   confirmation string.
3. The workflow resets `prod` to the tag, downloads the stored artifact,
   **re-verifies its sha256 against the release manifest**, and redeploys it —
   no rebuild ever.
4. Verify `/api/health` returns the rolled-back `release`/`git_sha`, then
   `/api/health/dependencies` is 200.
5. If the failure involved a migration, DO NOT roll the schema back blindly —
   follow expand → migrate → contract; contract steps are the only ones that
   may need a compensating migration.
6. Record the incident + both SHAs in the execution log.

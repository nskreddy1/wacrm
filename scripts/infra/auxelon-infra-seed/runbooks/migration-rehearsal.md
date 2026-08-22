# Runbook — migration rehearsal (placeholder)

Purpose: rehearse risky schema changes against a production-like copy before
`db-migrate.yml` touches production (ADR-002 Phase 3 groundwork).

1. Create a Supabase branch/copy from the latest production backup.
2. Apply the pending migration(s) with the standard runner; measure lock
   times on the largest tables.
3. Run the app's test suite + the authenticated smoke test against the copy.
4. Record timings and any required batching strategy in the migration PR.

TODO: automate as a reusable workflow once the first destructive migration
needs it.

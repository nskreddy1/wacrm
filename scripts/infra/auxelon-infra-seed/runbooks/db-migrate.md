# Runbook — production DB migration

Only `db-migrate.yml` ever holds the production `SUPABASE_DB_URL`
(`db-production` GitHub Environment; NFR-007). No human or agent runs SQL
against production directly.

1. Migration merged to `main` has already been applied to the development DB
   (`pnpm db:push`) and validated by CI.
2. Trigger `DB Migrate` (manual dispatch). Approve the `db-production`
   environment gate.
3. Destructive gate: if the diff matches `DROP |ALTER .*TYPE|DELETE FROM|TRUNCATE`
   or the PR carried `[destructive-migration]`, the workflow requires a second
   typed confirmation. Destructive changes MUST follow expand → migrate →
   contract across separate releases (ADR-003 §5.2).
4. After success: confirm `pnpm db:doc` output in the repo matches production
   (migration_version in the next release manifest).
5. Record in the execution log: migration filename(s), run URL, approver.

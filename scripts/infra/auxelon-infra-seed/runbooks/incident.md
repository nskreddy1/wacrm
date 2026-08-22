# Runbook — incident response (placeholder)

1. Assess: `/api/health` (liveness) vs `/api/health/dependencies` (readiness).
   Degraded dependency ≠ dead application — do not roll back for a Supabase
   or Redis blip.
2. Check Cloudflare Workers logs + Sentry for the correlated `request_id`.
3. If the fault correlates with the latest release → `runbooks/rollback.md`.
4. If the fault is a dependency outage → status pages (Supabase, Upstash,
   Cloudflare); rely on adapters' no-op/fallback behavior (NFR-003/004).
5. Post-incident: write the timeline in the execution log; add a regression
   check where feasible.

TODO: fill in alert routing + paging once Grafana Cloud alerting is set up.

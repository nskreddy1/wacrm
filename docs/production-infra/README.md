# Production infrastructure — docs index

This folder holds production deployment and infrastructure decisions for wacrm.
It is separate from `docs/adr/`, which records **product/feature** decisions
(onboarding, invites, membership, etc.). Infrastructure decisions live here and
are numbered `ADR-INFRA-NNN`.

| Doc | Status | What it covers |
| --- | --- | --- |
| [ADR-INFRA-001](./ADR-INFRA-001-production-deployment-infrastructure.md) | **Proposed — awaiting founder sign-off** | The full production deployment infrastructure: Cloudflare Workers via OpenNext, 2-branch gated CI/CD, observability stack, performance plan (app slowness), database/pooling strategy, scale decision points |
| [ADR-INFRA-002](./ADR-INFRA-002-database-portability.md) | **Proposed — awaiting founder sign-off** | Database portability: Postgres-portable (not engine-agnostic) loosely coupled data layer — coupling inventory, repository pattern, auth/realtime/storage adapters, `auth.uid()` shim, phased implementation plan, migration rehearsal before ~100K users |

## Reports

| Report | Date | What it covers |
| --- | --- | --- |
| [Implementation report](./reports/2026-08-22-implementation-report.md) | 2026-08-22 | End-to-end record of the production infrastructure implementation (plan tasks 0–11): what shipped, tool justifications, cost posture at hundreds → 10k users, deviations, and the remaining founder-gated steps (Tasks 8/9/11). |

The task-by-task execution log (dates, verification output, commit SHAs) lives
at `docs/superpowers/plans/2026-08-22-production-infrastructure.log.md`.

## Conventions

- One ADR per major infrastructure decision area; superseding ADRs link back.
- Every vendor choice must be wrapped behind an adapter module so it is
  swappable (see ADR-INFRA-001 §"Loose coupling rule").
- Cost posture: **designed to operate within free/low-cost tiers initially;
  every vendor is replaceable through an adapter.** Do not write "all free
  tiers" as a permanent invariant — pricing changes.
- Implementation only begins after the relevant ADR status moves from
  `Proposed` to `Accepted`.

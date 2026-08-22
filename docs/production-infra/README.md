# Production infrastructure — docs index

This folder holds production deployment and infrastructure decisions for wacrm.
It is separate from `docs/adr/`, which records **product/feature** decisions
(onboarding, invites, membership, etc.). Infrastructure decisions live here and
are numbered `ADR-INFRA-NNN`.

| Doc | Status | What it covers |
| --- | --- | --- |
| [ADR-INFRA-001](./ADR-INFRA-001-production-deployment-infrastructure.md) | **Proposed — awaiting founder sign-off** | The full production deployment infrastructure: Cloudflare Workers via OpenNext, 2-branch gated CI/CD, observability stack, performance plan (app slowness), database/pooling strategy, scale decision points |
| [ADR-INFRA-002](./ADR-INFRA-002-database-portability.md) | **Proposed — awaiting founder sign-off** | Database portability: Postgres-portable (not engine-agnostic) loosely coupled data layer — coupling inventory, repository pattern, auth/realtime/storage adapters, `auth.uid()` shim, phased implementation plan, migration rehearsal before ~100K users |

## Conventions

- One ADR per major infrastructure decision area; superseding ADRs link back.
- Every vendor choice must be wrapped behind an adapter module so it is
  swappable (see ADR-INFRA-001 §"Loose coupling rule").
- Cost posture: **designed to operate within free/low-cost tiers initially;
  every vendor is replaceable through an adapter.** Do not write "all free
  tiers" as a permanent invariant — pricing changes.
- Implementation only begins after the relevant ADR status moves from
  `Proposed` to `Accepted`.

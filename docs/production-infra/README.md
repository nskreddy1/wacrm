# Production infrastructure — docs index

This folder holds production deployment and infrastructure decisions for wacrm.
It is separate from `docs/adr/`, which records **product/feature** decisions
(onboarding, invites, membership, etc.). Infrastructure decisions live here and
are numbered `ADR-INFRA-NNN`.

| Doc                                                                      | Status                                   | What it covers                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-INFRA-001](./ADR-INFRA-001-production-deployment-infrastructure.md) | **Proposed — awaiting founder sign-off** | The full production deployment infrastructure: Cloudflare Workers via OpenNext, 2-branch gated CI/CD, observability stack, performance plan (app slowness), database/pooling strategy, scale decision points                                             |
| [ADR-INFRA-002](./ADR-INFRA-002-database-portability.md)                 | **Proposed — awaiting founder sign-off** | Database portability: Postgres-portable (not engine-agnostic) loosely coupled data layer — coupling inventory, repository pattern, auth/realtime/storage adapters, `auth.uid()` shim, phased implementation plan, migration rehearsal before ~100K users |

## Reports

| Report                                                                 | Date       | What it covers                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Implementation report](./reports/2026-08-22-implementation-report.md) | 2026-08-22 | End-to-end record of the production infrastructure implementation (plan tasks 0–11): what shipped, tool justifications, cost posture at hundreds → 10k users, deviations, and the remaining founder-gated steps (Tasks 8/9/11). |

The task-by-task execution log (dates, verification output, commit SHAs) lives
at `docs/superpowers/plans/2026-08-22-production-infrastructure.log.md`.

## Runbooks

Founder-gated manual steps. These cannot be done by an agent — they need
account access and real secret values.

| Runbook                                          | What it covers                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [env-and-secrets](./runbooks/env-and-secrets.md) | Every environment variable and secret: Cloudflare resources to create (Workers service, Hyperdrive config, API token scopes), Worker runtime secrets, GitHub repo secrets, and the `production` / `db-production` Environments — with required vs optional marked and a verification order. |
| [github-settings](./runbooks/github-settings.md) | Branch protection, the `prod` ruleset, and creating the two GitHub Environments with required reviewers.                                                                                                                                                                                    |
| [repo-split](./runbooks/repo-split.md)           | Extracting `auxelon-infra` from this repo (ADR-INFRA-003).                                                                                                                                                                                                                                  |

## Conventions

- **Release branch:** `production-infrastructure-architecture` — the GitHub
  default branch, the branch every workflow triggers on, and the only branch
  whose green CI run is eligible for production promotion. If it is ever
  renamed, update the `on: branches:` triggers in all five triggered workflows
  **and** the eligibility gate in `promote-to-prod.yml` in the same commit;
  a mismatch silently stops CI from running at all.

- One ADR per major infrastructure decision area; superseding ADRs link back.
- Every vendor choice must be wrapped behind an adapter module so it is
  swappable (see ADR-INFRA-001 §"Loose coupling rule").
- Cost posture: **designed to operate within free/low-cost tiers initially;
  every vendor is replaceable through an adapter.** Do not write "all free
  tiers" as a permanent invariant — pricing changes.
- Implementation only begins after the relevant ADR status moves from
  `Proposed` to `Accepted`.

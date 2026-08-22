# auxelon-infra

Reusable CI/CD workflows, runbooks, and provisioning for the Auxelon platform
(ADR-INFRA-003). The application lives in `auxelon-app`; this repository owns
the promotion machinery it calls.

## Layout

| Path | Purpose |
| --- | --- |
| `.github/workflows/` | Reusable (`workflow_call`) workflows extracted from the app's self-contained Task 7 bodies |
| `runbooks/` | Operational procedures: rollback, db-migrate, incident, migration rehearsal |
| `provisioning/` | Idempotent setup scripts + docs (Cloudflare, Hyperdrive, GitHub settings) |
| `secrets-inventory.md` | Secret NAMES and rotation policy only — never values |
| `architecture/` | Mirrors of the ADR-INFRA documents |

## Versioning contract (binding)

- Every release is an annotated tag `vX.Y.Z`.
- **A published tag is never moved or deleted.** Fixes ship as a new tag.
- Consumers pin: normal workflows to `@vX.Y.Z`; production-sensitive
  workflows (promote / rollback / db-migrate) to a full 40-char commit SHA
  (ARCH-009).

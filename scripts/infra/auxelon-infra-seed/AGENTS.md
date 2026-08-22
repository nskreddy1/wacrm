# AI agent protocol — auxelon-infra

Binding rules for any agent working in this repository (ADR-INFRA-003 §5,
mirrored from the plan's System design addendum §A/§B).

## Context order

1. This file.
2. `README.md` + `architecture/` (ADR mirrors).
3. The consuming repo's `AGENTS.md` (`auxelon-app`) for cross-repo changes.

## Non-negotiable rules

- **Immutable tags:** a published `vX.Y.Z` tag is NEVER moved or deleted.
  Breaking a consumer's SHA/tag pin is a production incident, not a refactor.
- **Production DB prohibition:** agents never hold or use the production
  `SUPABASE_DB_URL`. It exists only inside the `db-production` GitHub
  Environment of `auxelon-app`; only `db-migrate.yml` may read it (NFR-007).
- **DB-change protocol:** migrations are forward-only, deterministic, run
  exactly once, never edited after application. Destructive changes follow
  expand → migrate → contract (ADR-003 §5.2).
- **Workflow refs:** `uses:` references in anything production-sensitive are
  pinned to full commit SHAs, never branches (ARCH-009).
- **Cross-repo protocol:** a change that alters a reusable workflow's inputs,
  secrets, or outputs ships here first (new tag), then the app re-pins in a
  separate PR. Never assume the app updates atomically.
- **No future production development in `wacrm`** — it is archived; the app
  is `auxelon-app`.

## Dependency Rule + pattern budget (inherited by all app work)

Domain/application code never imports vendor SDKs (Supabase, Redis, Sentry,
Langfuse, Loki, Cloudflare/Vercel). Vendor access goes through ports/adapters
in `src/lib/*`. Patterns are allowed only at explicit boundaries (Ports &
Adapters, Repository, Unit of Work, Facade, Strategy+Factory, Decorator,
Idempotency, Bulkhead, Circuit Breaker, ACL). Business logic stays plain.

# WACRM Implementation Roadmap

This folder is the single source of truth for the phased build-out of workspace
defaults, AI auto-reply upgrades, and enterprise readiness. Each phase is small,
independently shippable, and additive — nothing in an earlier phase gets undone
by a later one.

| Phase | Scope | Status | Details |
|---|---|---|---|
| 1 | Workspace defaults provisioning (template catalog + auto-seed on signup + backfill script) | **DONE** | [phase-1-provisioning.md](./phase-1-provisioning.md) |
| 2 | Sidebar real data + grouped navigation | **DONE** | [phase-2-sidebar.md](./phase-2-sidebar.md) |
| 3 | AI: per-account context window + rolling conversation summarization | TODO | [phase-3-ai-context.md](./phase-3-ai-context.md) |
| 4 | AI: skill-based smart handoff routing (`ai_handoff_routes`) | TODO | [phase-4-ai-handoff.md](./phase-4-ai-handoff.md) |
| 5 | Enterprise scale items (account-scoped tags, custom roles, queued provisioning, partitioning, sub-orgs, billing) | FUTURE | [phase-5-enterprise-scale.md](./phase-5-enterprise-scale.md) |

## Architecture verdict (assessed 2026-07)

The current architecture (account-scoped multi-tenancy + RLS via
`is_account_member()`, roles, invitations, API keys, webhooks) **holds from
demo scale to large organizations without a rewrite**. An "organization" IS an
account. All large-scale needs are isolated, additive changes documented in
phase 5.

## Conventions

- One migration per phase, numbered sequentially in `supabase/migrations/`.
- All provisioning/seeding logic lives in SQL `SECURITY DEFINER` functions so
  the caller can later move from trigger → queue without changing the logic.
- Template/default content is DATA (JSONB in `workspace_templates`), never
  hardcoded — adding a template is an `INSERT`, not a deploy.
- Every backfill script is idempotent and supports `--dry-run`.

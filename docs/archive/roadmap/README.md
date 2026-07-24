# WACRM Implementation Roadmap

This folder is the single source of truth for the phased build-out of workspace
defaults, AI auto-reply upgrades, and enterprise readiness. Each phase is small,
independently shippable, and additive — nothing in an earlier phase gets undone
by a later one.

| Phase | Scope | Status | Details |
|---|---|---|---|
| 1 | Workspace defaults provisioning (template catalog + auto-seed on signup + backfill script) | **DONE — APPROVED** | [phase-1-provisioning.md](./phase-1-provisioning.md) |
| 2 | Sidebar real data + grouped navigation | **DONE — APPROVED** | [phase-2-sidebar.md](./phase-2-sidebar.md) |
| 2.5 | UI shell consistency (shared page container, sidebar scroll fix, single scroll owner, Flows nav removal) | **DONE — APPROVED** | See "Phase 2.5" section below |
| 3 | AI: per-account context window + rolling conversation summarization | TODO | [phase-3-ai-context.md](./phase-3-ai-context.md) |
| 4 | AI: skill-based smart handoff routing (`ai_handoff_routes`) | TODO | [phase-4-ai-handoff.md](./phase-4-ai-handoff.md) |
| 5 | Enterprise scale items (account-scoped tags, custom roles, queued provisioning, partitioning, sub-orgs, billing) | FUTURE | [phase-5-enterprise-scale.md](./phase-5-enterprise-scale.md) |

## Completion sign-off (2026-07-14)

> **Approved & completed.** Phases 1, 2, and 2.5 are verified complete in code
> (migration `042_workspace_provisioning.sql`, `scripts/provision-default-workspaces.mjs`,
> grouped `src/lib/navigation/config.ts`, real-data sidebar, shared page
> container). The implementation is enterprise-level: account-scoped
> multi-tenancy with RLS, idempotent SECURITY DEFINER provisioning, data-driven
> templates, and a consistent UI shell. Phases 3–5 remain open — they are
> **not** implemented yet (verified: no `ai_handoff_routes` table, no
> conversation-summarization schema as of migration 042).

## Phase 2.5 — UI shell consistency (DONE)

Problem: every page defined its own outer padding/width (or none — e.g. the
AI Agents page was flush against the viewport), the sidebar showed a permanent
scrollbar, and the app could show two vertical scrollbars.

What shipped:

- **`src/components/layout/page-container.tsx`** — single source of truth for
  page gutters and max width (`mx-auto w-full max-w-[1500px] p-4 sm:p-6 lg:p-8`).
  Exported both as a `<PageContainer>` component (used by route layouts for
  agents, settings, notifications) and as `pageContainerClassName` for pages
  that merge it into their own root element (automations, flows, broadcasts,
  automation logs). Full-bleed surfaces (inbox, pipeline board, flow/automation
  builders) intentionally opt out.
- **Single scroll owner** — the dashboard shell (`dashboard-shell.tsx`) uses
  `h-dvh overflow-hidden overscroll-none`; only `<main>` scrolls. This kills
  the double-scrollbar issue.
- **Sidebar** — `h-full` (fills the shell instead of racing it with its own
  `h-screen`), nav items compacted to `h-12` so the default nav fits without
  scrolling, and the sidebar scrollbar is auto-hide (only visible while
  hovering/scrolling).
- **Flows removed from nav** — Automations is the single automation entry
  point. The `/flows` routes and engine remain intact; the nav item in
  `src/lib/navigation/config.ts` is commented for easy restoration.

## Enterprise validation checklist (apply to EVERY implementation)

Each phase/feature must pass all of these before its status becomes DONE:

1. **Tenancy & security** — all tables account-scoped with RLS via
   `is_account_member()`; no cross-tenant leakage; secrets encrypted at rest.
2. **Scale posture** — no per-request N+1 against Supabase; hot paths indexed;
   provisioning/seeding is idempotent and queue-movable (SECURITY DEFINER).
3. **Data-driven, not hardcoded** — configuration is rows (JSONB templates,
   nav config), so changes are INSERTs, not deploys.
4. **UI consistency** — pages use the shared page container (or explicitly
   document why they are full-bleed); one scroll owner; header/sidebar/main
   spacing identical across routes; responsive from mobile up.
5. **Reversibility** — migrations additive; feature removal is a nav/flag
   change, not a code deletion (see Flows).
6. **Verification** — feature exercised in the browser (not just compiled)
   and unit tests updated where logic changed (`src/lib/ai/*.test.ts` pattern).

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

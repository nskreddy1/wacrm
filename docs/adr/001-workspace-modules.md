# ADR-001: Per-workspace module enablement

**Status:** Proposed — revision 2 (self-critique applied), awaiting sign-off
**Date:** 2026-07-27
**Deciders:** Product owner (nskreddy1)

## Context

Every workspace currently sees every module. Invoices and Payments are coming,
so the list will grow. Modules must become configurable per workspace, with
onboarding picking a preset per business type (e.g. freelancing) and an
advanced editor for changing it later.

### What already exists (do not rebuild)

| Piece | Location | State |
|---|---|---|
| Nav registry | `src/lib/navigation/config.ts` — `NAV_GROUPS` | Serializable, 11 items, 4 groups |
| Nav filtering | `navigationForAccess(access)` | Already filters each item by `permission` slug |
| Permission model | `workspace_profiles` + slugs, `hasPermission` | Mature Zoho-style model, ~30 call sites |
| Single-round-trip context | `get_account_context()` RPC + React `cache()` | `getCurrentAccount()` runs at most once per request |
| Cookie-auth chokepoints | `requirePermission(slug)`, `requireRole(min)` | Every dashboard page/action funnels here |
| API-key chokepoint | `requireApiKey(request, scope)` | **11 of the 25** `/api/v1` routes funnel here — see correction below |
| Per-tenant platform override | `account_limit_overrides`, `/api/admin/workspaces/[id]/limits` | Proven: service-role write + `logPlatformAudit` |

This is **one new orthogonal axis** on an existing system, not a new nav system.
`plans.features` is only marketing copy ("500 contacts"), not entitlements.

---

## Self-critique of revision 1

Revision 1 was rewritten after five findings. Recording them because each one
changes the design, not just the wording.

### C1 — Product: I collapsed two different concerns into one question

Revision 1 asked "where should this live?", got "platform admin", and built a
single axis. But the original request contained **both** concerns:

> "he can **allow the people to go there** to the pipeline" → tenant-side
> "they can **ask us**" → platform-side
> "or they will have the **customization in the advanced mode**" → tenant-side

Entitlement and preference are genuinely different:

| | Entitlement | Preference |
|---|---|---|
| Question | What is this tenant *allowed* to have? | What does this tenant *want to show*? |
| Owner | Platform admin (us) | Workspace admin (them) |
| Driver | Plan, contract, provisioning | Team size, rollout pace, clutter |
| Tenant can change? | No — must ask us | Yes, self-service |

A platform-only build means a tenant entitled to Invoices cannot hide it until
they are ready — which was the original ask. A tenant-only build means we cannot
gate by plan. **Both are needed**, and cheaply (see Option A).

### C2 — Architecture: revision 1 was fail-open by omission (highest severity)

Action item 10 said "apply `requireModule` across all 11 module pages and their
actions". That is opt-in enforcement: every forgotten call site is a silent
hole, and the real surface is far larger than revision 1 assumed —

- 11 module pages + their server actions
- **11 `/api/v1` routes** under API-key auth — not mentioned in revision 1
- **13 further `/api/v1` routes** under *session* auth (`workspace/*`,
  `dashboard`, `notifications`, `session`, `security/devices`,
  `security/login-activity`). These share the `/api/v1` prefix but not its auth,
  and they call neither `requirePermission` nor `requireApiKey` — so no
  chokepoint below reaches them (see the correction under "Enforcement layers")
- **`/api/mcp/[transport]`** — AI agent access, not mentioned
- **`/api/v1/workspace/navigation`** — an external nav consumer, not mentioned
- **`/api/flows/cron`** — background execution, not mentioned

Verified: the cron uses a service-role client and scans every tenant's active
runs (`.eq('status','active')`) with no account filter, so a "disabled" Flows
module **keeps executing automations** — a correctness and billing bug, and the
worst kind because it is invisible.

**Fix — enforce inside the chokepoints that already exist.** Permission slugs
are already namespaced by module (`broadcasts:send`, `catalog:manage`), and API
scopes likewise. So map slug-prefix → module and check enablement *inside*
`requirePermission` / `requireApiKey`. Every existing call site is then covered
with no per-file edits, and a new module is enforced the moment its slug is
registered. This converts the boundary from opt-in to **fail-closed by
construction** and deletes the most dangerous action item in revision 1.

### C3 — Performance: revision 1 invented a second round trip

Revision 1 proposed `moduleSettingsFor(accountId)` with its own cache. But
`get_account_context()` already returns the whole context in one RPC wrapped in
React `cache()`. Adding a separate reader means **one extra query on every page
load and every nav render**. Extending the existing RPC to return module state
costs nothing.

### C4 — Integrity: `disabled TEXT[]` silently accepts typos

`{'pipeline'}` (missing `s`) is a valid array and a silent no-op — the module
stays on and nobody notices. An entitlement store needs validation against the
registry at write time, plus a DB-level guard.

### C5 — Missing: module dependencies are unmodelled

- `inbox-sms` is a child of `inbox` — disabling the parent orphans the child
- `broadcasts` needs `contacts` and `templates` to be useful
- `pipelines` deals reference contacts

Disabling a dependency silently breaks its dependents. Needs an explicit
`requires` edge and a warning at write time.

---

## Scenario walkthrough

Testing revision 1 against concrete situations is what surfaced most of the
above.

| # | Scenario | Revision 1 behaviour | Verdict |
|---|---|---|---|
| 1 | Freelancer provisioned without Broadcasts | Nav hides it; page redirects | Works |
| 2 | Tenant has Invoices but wants it hidden until trained | **Impossible** — only we can toggle | **C1** |
| 3 | Flows disabled mid-flight; automations scheduled | **Keeps firing** via cron | **C2** |
| 4 | Integrator's API key POSTs to `/api/v1/broadcasts` with Broadcasts off | **Succeeds** | **C2** |
| 5 | AI agent calls a disabled module over MCP | **Succeeds** | **C2** |
| 6 | User bookmarked `/catalog`, gets disabled | Silent redirect, no reason given | **C-P2** |
| 7 | Module disabled 6 months, then re-enabled | Data intact (never deleted) | Works — but must be stated |
| 8 | Admin disables `inbox` but not `inbox-sms` | Orphaned child in nav | **C5** |
| 9 | Platform admin disables Dashboard | Redirect loop | Caught in rev 1 |
| 10 | Typo `'pipeline'` written to the array | Silent no-op | **C4** |
| 11 | Tenant hides a module the platform later revokes | Two axes must not fight | Needs precedence rule |

Scenario 11 gives the precedence rule: **entitlement wins**. If the platform
revokes a module, the tenant's preference for it is irrelevant. Re-granting it
must restore the tenant's prior preference rather than silently forcing it on.

---

## Decision

Three-layer resolution, evaluated in order:

```
visible/allowed =
      entitled(account, module)      -- platform admin; commercial boundary
  AND tenantEnabled(account, module)  -- workspace admin; presentation choice
  AND hasPermission(user, slug)       -- existing per-member gate (unchanged)
```

One row per account holding both axes, so a single read serves both and the
precedence rule is local:

```sql
account_module_settings (
  account_id       UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  platform_disabled TEXT[] NOT NULL DEFAULT '{}',  -- written by super admin only
  tenant_disabled   TEXT[] NOT NULL DEFAULT '{}',  -- written by workspace admin
  reason            TEXT,                          -- platform note, shown to tenant
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        UUID
)
```

Storing **disabled** keys (not enabled) keeps a newly shipped module on by
default for every existing tenant with no backfill. Keeping the axes in separate
columns means re-granting entitlement restores the tenant's prior choice
automatically (scenario 11).

### Why not one column

Collapsing both into a single `disabled` array loses *who* turned it off, so
re-granting cannot restore tenant intent and the tenant could clear a platform
restriction. Rejected on both counts.

---

## Enforcement (revised — fail-closed)

| Layer | Mechanism | Covers |
|---|---|---|
| 1. Data | Extend `get_account_context()` to return both arrays | Zero extra round trips (C3) |
| 2. Nav | `navigationForAccess()` also filters on module state | Cosmetic only |
| 3. Cookie auth | Module check **inside** `requirePermission` / `requireRole` | All pages + server actions, automatically (C2) |
| 4. API key | Module check **inside** `requireApiKey` via scope→module | The 11 API-key `/api/v1` routes + MCP, automatically (C2) |
| 5. Background | `flows/cron` filters runs by entitled accounts | Stops invisible execution (C2) |
| 6. Write-time | Validate keys against registry; warn on dependency breaks | C4, C5 |

Layers 3 and 4 are the design's core: enforcement lives at the chokepoint, so
no future module can forget it.

> **Correction (verified against the tree, ADR-003 Task 9).** Layer 4 does
> **not** cover all 25 `/api/v1` routes, and this ADR previously claimed twice
> that it did. The prefix carries three auth regimes:
>
> - **11 routes** authenticate with `requireApiKey` → covered by layer 4.
> - **13 routes** (`workspace/*`, `dashboard`, `notifications`, `session`,
>   `security/devices`, `security/login-activity`) authenticate with
>   `getCurrentAccount()` → covered by **neither layer 3 nor layer 4**, because
>   none of them call `requirePermission` / `requireRole`.
> - **1 route** (`security/login`) is pre-auth by design.
>
> `getCurrentAccount()` authenticates the user and resolves account + role,
> failing closed when the profile has no account — so **account scoping and
> tenant isolation hold on these 13 routes today.** What is missing is the
> permission-slug and module check. Implementing this ADR by putting the module
> gate only inside `requirePermission` and `requireApiKey` would therefore leave
> the entire session-authenticated BFF surface ungated — a disabled module would
> still be fully reachable through `/api/v1/workspace/*`, which is exactly the
> "future module forgets it" failure the chokepoint design exists to prevent.
>
> Layer 3 must therefore be stated as *the `requirePermission`/`requireRole`
> chokepoint*, and the 13 session routes need an explicit decision: route them
> through that chokepoint, or add a third chokepoint for session-authenticated
> route handlers. See `docs/public-api.md` → "What is and isn't public" for the
> per-route breakdown.

### Tenant-facing denial UX (C-P2)

A bare redirect produces support tickets. Three distinct states, three
messages:

- **Not entitled** → "Not included in your plan" + contact/upgrade path, with
  the platform `reason` if set
- **Tenant-disabled** → "Turned off for this workspace" + link for admins
- **No permission** → existing behaviour, unchanged

## Consequences

**Easier:** new modules register in one place and are enforced everywhere by
construction; per-tenant provisioning with no deploy; onboarding presets become
a list of keys; tenants self-serve presentation without a support request.

**Harder:** `get_account_context()` gains a small amount of surface; two write
paths need separate authorization (super admin vs workspace admin).

**Guarantees:** disabling a module never deletes data; re-enabling restores the
prior state (scenario 7).

**To revisit:** role-level overrides (add `profile_module_settings`, ANDed
identically); mapping entitlement onto billing plans; onboarding presets.

## Scope (confirmed)

- Toggleable (11): `pipelines`, `inbox`, `inbox-sms`, `contacts`,
  `appointments`, `catalog`, `broadcasts`, `templates`, `flows`, `agents`,
  `dashboard`
- Core / never disableable: `settings`
- Enforcement: nav + page + server action + public API + MCP + cron
- Out of scope: Invoices/Payments features — this only makes room for them

## Action items

**Phase 1 — foundation (no behaviour change)**
1. [ ] `src/lib/navigation/modules.ts` — `MODULES` registry, `CORE_MODULES`,
       `requires` edges, slug-prefix→module and scope→module maps
2. [ ] Add a `module` key to each `NAV_GROUPS` item
3. [ ] Migration: `account_module_settings` + RLS (read-own; service-role and
       workspace-admin writes separated) + CHECK validating keys
4. [ ] Extend `get_account_context()` RPC to return both arrays (C3)

**Phase 2 — enforcement (fail-closed)**
5. [ ] Module check inside `requirePermission` / `requireRole`
6. [ ] Module check inside `requireApiKey` (covers the 11 API-key v1 routes + MCP)
   6a. [ ] **Gate the 13 session-authenticated `/api/v1` routes.** Steps 5 and 6
   do not reach them — they authenticate with `getCurrentAccount()` and call
   neither helper, so a disabled module stays reachable through
   `/api/v1/workspace/*`. Either route them through `requirePermission` or add a
   third chokepoint for session route handlers.
7. [ ] Filter `flows/cron` by entitled accounts
8. [ ] `firstAllowedModule()`; replace the 6 hardcoded `/dashboard` redirects
9. [ ] `module-unavailable` page with the three states

**Phase 3 — control surfaces**
10. [ ] `GET`/`PATCH /api/admin/workspaces/[id]/modules` + `logPlatformAudit`
11. [ ] Platform admin panel (mirrors `workspace-limits-panel.tsx`)
12. [ ] Tenant-side toggles (workspace admin, `tenant_disabled` only)

**Phase 4 — later**
13. [ ] Onboarding presets; Invoices/Payments registration

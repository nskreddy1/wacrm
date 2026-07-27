# ADR-001: Per-workspace module enablement

**Status:** Proposed — awaiting sign-off
**Date:** 2026-07-27
**Deciders:** Product owner (nskreddy1)

## Context

Every workspace currently sees every module. Invoices and Payments are coming,
so the list will grow. A platform admin needs to decide which modules a given
workspace gets, with onboarding picking a preset per business type (e.g.
freelancing) and an advanced editor for changing it later.

### What already exists (do not rebuild)

Research found most of the machinery already present:

| Piece | Location | State |
|---|---|---|
| Nav registry | `src/lib/navigation/config.ts` — `NAV_GROUPS` | Serializable, 11 items, 4 groups |
| Nav filtering | `navigationForAccess(access)` | Already filters each item by `permission` slug |
| Permission model | `workspace_profiles` + slugs, `hasPermission`, `requirePermission` | Mature Zoho-style model, ~30 call sites |
| Per-tenant override by platform admin | `account_limit_overrides`, `/api/admin/workspaces/[id]/limits` | Proven: service-role write + `logPlatformAudit` |
| Platform admin console | `src/app/(dashboard)/admin/**`, `requireSuperAdmin()` | Sidebar, layouts, audit logging |

This is therefore **one new orthogonal axis** on an existing system, not a new
navigation system.

`plans.features` is only an array of marketing strings ("500 contacts") consumed
by pricing UI — not an entitlement mechanism. This ADR introduces the first one.

## Decision

Add a per-account **module enablement** axis, written by platform admins, ANDed
with the existing permission checks:

```
allowed = moduleEnabled(account, module) AND hasPermission(user, slug)
```

Storage mirrors `account_limit_overrides`: one row per account, service-role
writes only, tenant-readable via RLS.

```sql
account_module_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  disabled   TEXT[] NOT NULL DEFAULT '{}',   -- module keys that are OFF
  reason     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

Storing **disabled** keys (not enabled ones) means a newly shipped module is on
by default for every existing tenant, with no backfill.

## Options considered

### Option A: per-account disabled list (chosen)

| Dimension | Assessment |
|---|---|
| Complexity | Low — one table, one helper, mirrors an existing pattern |
| New module rollout | On by default, no backfill |
| Scalability | Single indexed PK lookup, cacheable per request |
| Team familiarity | High — same shape as `account_limit_overrides` |

**Pros:** additive; no tenant migration; new modules safe by default.
**Cons:** "off" is implicit absence, so UI must render from the registry.

### Option B: reuse `plans.features` as entitlements

**Pros:** ties modules to billing tiers for free.
**Cons:** `features` is display copy; overloading it couples billing text to
access control. Per-tenant exceptions still need an override table, so Option A
is required anyway.

### Option C: boolean columns on `accounts`

**Pros:** simplest read.
**Cons:** a migration and deploy per new module — defeats the stated goal of
adding modules without a deploy. Rejected.

## Trade-off analysis

**The two axes must AND, never OR.** Module enablement must not *be* the
permission check. If it were, enabling a module would grant access to members
lacking the slug — privilege escalation. Each nav item keeps its `permission`
and gains a `module` key.

**Default-on when config is missing or unreadable.** Per the insecure-defaults
review this resembles fail-open, so stating it explicitly: it is not a security
regression, because permissions still gate every surface, so the effective
access set is identical to today's. Default-deny would black out every module
for every tenant on one failed read — an outage for no security gain. The
entitlement boundary is commercial; the trust boundary remains the permission
slug.

**`settings` is never disableable.** Otherwise a workspace can be stripped of
the UI needed to fix itself.

**Dashboard needs a redirect fallback (blocking issue).** `/dashboard` is the
hardcoded post-login destination in `proxy.ts:48`, `auth/callback/route.ts`,
`app/page.tsx`, `join/[token]`, `reset-password`, and both admin layouts. Since
Dashboard is toggleable, disabling it without a fallback strands users in a
redirect loop: the proxy sends them to `/dashboard`, the module guard bounces
them off it. Mitigation: a `firstAllowedModule(access)` resolver that every
post-login redirect uses instead of a literal `/dashboard`.

## Enforcement layers

Nav hiding is cosmetic; a hidden item whose action stays callable is the footgun
to avoid. Three layers:

1. **Nav** — `navigationForAccess()` also filters on module state. Cosmetic.
2. **Page** — each module's server component calls `requireModule(key)`, which
   redirects when disabled. Blocks direct URL entry.
3. **Server actions / route handlers** — `requireModule(key)` beside the
   existing `requirePermission(slug)`. Blocks crafted POSTs.

Layer 3 is what makes this an entitlement boundary rather than a UI preference.

## Consequences

**Easier:** new modules register in one place; per-tenant provisioning with no
deploy; onboarding presets become a list of keys.

**Harder:** each new module must remember `requireModule` in all three layers —
mitigated by a single `MODULES` registry as the source of truth.

**Note:** placing this in the platform admin console makes modules a
provisioning/entitlement decision, not tenant self-service. The onboarding idea
("freelancing → these features") therefore becomes a platform-side preset
applied at signup rather than something the tenant picks.

**To revisit:** role-level overrides (schema is compatible — add
`profile_module_settings` later, ANDed identically); onboarding writing presets;
whether modules should map onto billing plans.

## Scope (confirmed)

- Toggleable (11): `pipelines`, `inbox`, `inbox-sms`, `contacts`,
  `appointments`, `catalog`, `broadcasts`, `templates`, `flows`, `agents`,
  `dashboard`
- Core / never disableable: `settings`
- Placement: platform admin console
- Enforcement: nav + page + server action
- Out of scope: Invoices/Payments features — this only makes room for them

## Action items

1. [ ] Migration `account_module_settings` — RLS read-own, service-role writes
2. [ ] `src/lib/navigation/modules.ts` — `MODULES` registry + `CORE_MODULES`
3. [ ] Add a `module` key to each `NAV_GROUPS` item
4. [ ] `moduleSettingsFor(accountId)` reader with request-level cache
5. [ ] Extend `NavAccess` with disabled modules; filter in `navigationForAccess`
6. [ ] `requireModule(key)` guard for pages and actions
7. [ ] `firstAllowedModule(access)`; replace hardcoded `/dashboard` redirects
8. [ ] `GET`/`PATCH /api/admin/workspaces/[id]/modules` + `logPlatformAudit`
9. [ ] Platform admin panel UI (mirrors `workspace-limits-panel.tsx`)
10. [ ] Apply `requireModule` across all 11 module pages and their actions
11. [ ] Future: onboarding presets; Invoices/Payments registration

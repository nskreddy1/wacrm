# ADR-001: Workspace-configurable modules and navigation

**Status:** Proposed
**Date:** 2026-07-27
**Deciders:** Product owner (account admin persona)

## Context

An admin needs to control which modules a workspace uses — hide Pipelines for a
freelancer, add Invoices/Payments when those ship. Onboarding should pick a
starting set from the business type; an advanced editor changes it later.

Research into the existing codebase found that **most of this already exists**:

| Concern | Current state |
|---|---|
| Nav definition | Already config-driven: `NAV_GROUPS` in `src/lib/navigation/config.ts`, serializable, icons by name |
| Nav filtering | `navigationForAccess(access)` already filters per-item by `permission` slug |
| Permissions | Mature Zoho-style model: `workspace_profiles` + permission slugs, `hasPermission(perms, slug, isOwner)`, `requirePermission()` used across ~30 files |
| Workspace config | Stored as columns on `accounts` (precedent: `default_currency`) |
| Route entry | `src/proxy.ts` middleware; server components per route |
| Onboarding | `onboarding-wizard.tsx` + `/api/account/onboarding` — a natural preset hook |

So this is **not** a new nav system. It is one new orthogonal axis —
*is this module enabled for this workspace?* — layered onto the existing
per-user permission axis.

## Decision

Introduce a **module registry** keyed by module id. Visibility of any surface
becomes the conjunction of two independent axes:

```
visible(user, module) = enabled(workspace, module) AND hasPermission(user, module.permission)
```

Enablement is stored per-workspace now, with the resolver shaped so role
overrides can layer in later without a rewrite (answering "per-workspace, with
role overrides later").

## Options Considered

### Option A: Nav-only visibility (cosmetic)
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Security | **None** — direct URL still works |
| Effort | Small |

**Pros:** Trivial; no server changes.
**Cons:** Rejected. The user asked for enterprise-grade. Hiding a nav item
while leaving the route and its server actions callable is a textbook
footgun — it *looks* like access control but is not.

### Option B: Module registry + server-side enforcement (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Security | Enforced at page + server action |
| Effort | Medium |

**Pros:** Honest boundary; single registry drives nav, guards, and admin UI.
**Cons:** Every new module must register and add a guard — mitigated by making
the registry the only place to add a module.

### Option C: Full per-role module matrix now
| Dimension | Assessment |
|---|---|
| Complexity | High |
| Security | Same as B |
| Effort | Large |

**Cons:** Deferred per the decision to ship per-workspace first.

## Security review

Applied the fail-open/fail-secure lens from the insecure-defaults skill.

**1. Module enablement is NOT a security boundary — permissions are.**
The two axes must AND, never OR. If enablement were the only gate, enabling a
module would grant access to members who lack the permission slug — a
privilege-escalation fail-open. The registry therefore *keeps* each module's
existing `permission` slug and adds enablement on top; it never replaces it.

**2. Default-on for unknown/unreadable config is deliberate and safe.**
If the stored config is missing (every existing workspace, or a read failure),
modules resolve to **enabled**. This looks like a fail-open default but is not a
security regression: permissions still gate every surface, so the effective
access set is identical to today's. The alternative — default-deny — would lock
every existing workspace out of the entire app on a single bad read, trading a
non-existent security gain for a total availability outage.

**3. Core modules cannot be disabled.**
`settings` and `dashboard` are marked non-disableable. Without this, an admin
can disable Settings and permanently lock the workspace out of its own
configuration — an unrecoverable state reachable through the happy path.

**4. Nav hiding is presentation only; enforcement is server-side.**
Hiding must never be the enforcement. Guards run in the server component
(blocking direct URLs) and in server actions (blocking crafted POSTs). A
client-only check would leave the mutation path fully open.

**5. Only permitted admins may change the config.**
The write path requires the existing settings-management permission, so module
config is not editable by any authenticated member.

## Consequences

**Easier:** New modules (Invoices, Payments) register in one place and get nav,
gating, and admin UI for free. Onboarding presets become a list of module ids.

**Harder:** Two axes to reason about when a surface unexpectedly hides. Mitigated
by keeping resolution in one pure, unit-testable function.

**To revisit:** Role-level overrides; whether disabled modules should hide their
data from global search and automations.

## Action items

1. [ ] Migration: module config on `accounts` (default-on semantics), admin-only write
2. [ ] `src/lib/modules/registry.ts` — module ids, labels, `permission`, `core` flag
3. [ ] Pure resolver: `isModuleEnabled(config, id)` + `visibleModules(config, access)`
4. [ ] Extend `navigationForAccess` with the enablement axis
5. [ ] Server guard `requireModule(id)`, applied to module pages and their actions
6. [ ] Admin page + sidebar entry to toggle modules
7. [ ] Register an Invoices placeholder module (disabled by default) to prove the path
8. [ ] Follow-up: onboarding presets map business type → module id set

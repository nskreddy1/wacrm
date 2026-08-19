# ADR-007: Vertical packs and module enablement — showing a workspace only what it needs

**Status:** Proposed
**Date:** 2026-08-20
**Deciders:** Owner/product (pack contents + default-off policy), backend (RPC + resolver), AI (Mira tool registry)
**Relates to:** `.agents/context/vertical-architecture.md` (§2 pack layers, §3 flags-not-apps, §5 data model, §7 build order, §8 gates — **this ADR implements §5 and defers the rest**), ADR-004 (invites and membership), ADR-005 (AI agent configuration flow), ADR-006 (outbound send window), ADR-008 (the onboarding surface built on this mechanism)

---

## Context

**The goal is not packaging. It is that the user is never shown a feature they
do not need.** A freelancer needs contacts, a pipeline, and a way to reply. A
support desk needs an inbox, tickets, and templates. A real-estate agent needs
property fields and a site-visit stage. A sales team needs deals and forecasting.
These are *different products* to their users, and the value of this one is that
it can be all of them without any of them seeing the others' surface area.
"Advanced features for everyone" is the anti-goal.

`.agents/context/vertical-architecture.md` already settled the shape of the
answer: **one horizontal core (~80%) plus Vertical Packs (~20%, pure config).**
§3 states feature scope is "enabled-module sets, one binary — same codebase
renders the right surface", and §5 prescribes exactly three additions to the
workspace: `vertical`, `compliance_profile`, `enabled_modules`. **None of the
three exist yet** — `accounts` today is `id, name, owner_user_id, created_at,
updated_at, default_currency, plan_id, onboarding_completed_at,
record_visibility_mode`. This ADR is the decision record for building that
missing axis; it is not a new direction.

The gap in the running code:

The product is an enterprise-shaped CRM with 27 feature modules. Every tenant
currently gets all of it, all at once:

- **Navigation** (`src/lib/navigation/config.ts`) gates items on a single
  `permission` slug and nothing else. A tenant who will never book an
  appointment still sees `/appointments`; a tenant with no product catalog still
  sees `/catalog`. There is no notion of "this workspace does not use that".
- **Onboarding** (`src/features/onboarding/components/onboarding-wizard.tsx`) is
  three steps — workspace name, a *read-only* pointer at Settings → Channels,
  invite teammates — and then drops the user into the full application. It
  configures no modules, so complexity is deferred to discovery rather than
  disclosed on demand.
- **Mira** (`src/features/assistant/lib/tool-catalog.ts`) registers all 28 tools
  for every tenant unconditionally. `list_upcoming_appointments`,
  `list_catalog_items`, `create_catalog_item`, `create_workflow`,
  `list_support_tickets` are live even when the workspace has never enabled
  those surfaces. The catalog's own header comment says access class is "a
  security boundary, not a label" — but that boundary is currently
  *read vs. write*, with no concept of *in scope vs. out of scope*.
- **Commercial limits already exist and are a different axis.** `plans`,
  `account_limit_overrides` and `usage_counters` (migrations
  `20260726120000_plans_and_quotas.sql`, `20260726140000_unlimited_overrides.sql`,
  engine in `src/lib/quotas/index.ts`) answer "how much", and deliberately
  **fail open** because "quota enforcement is a business bound, not a security
  control". They do not answer "which surfaces exist for this workspace".
- **Permissions already exist and are a third axis.** The Zoho/Bigin-style
  profile model (`src/features/auth/lib/permissions.ts`, 31 slugs,
  `has_permission()` in SQL) answers "may *this member* do it".

So three questions are being conflated into one, and only two of them have
machinery:

| Question | Axis | Machinery today |
| --- | --- | --- |
| How much may this workspace consume? | Entitlement (commercial) | `plans` + quotas ✅ |
| May this member perform this action? | Permission (per-user) | profiles + `has_permission()` ✅ |
| **Does this workspace use this module at all?** | **Enablement (per-account, opt-in)** | **none** ❌ |

The missing axis is the one this ADR is about: a workspace that does not do
appointments should not see appointments anywhere — nav, routes, API, or Mira —
until someone turns it on.

**And a fourth question sits above all three:** *what does this kind of business
need in the first place?* A freelancer should not have to discover, evaluate and
individually switch on eleven optional modules; that is the same complexity
problem wearing a different hat. The answer must be a **starting set chosen once,
at onboarding, from the workspace's industry and shape** — the Vertical Pack of
`vertical-architecture.md` §2. Enablement is the mechanism; the pack is the
default it starts from; ADR-008 is the moment the pack is chosen.

Two competitor data points frame the target. **Zoho Bigin** wins the
freelancer/small-team segment precisely by shipping 20+ industry presets
(including a real-estate pipeline of enquiry → site visit → closing) and
refusing enterprise surface area. **HubSpot** branches onboarding immediately on
"what brings you here" and uses progressive disclosure so a user sees only tasks
relevant to their goal. Neither is a technology advantage we lack — both are
config plus a first-run question, which is all §2 claims a pack is.

Mira matters here, but as a **consumer of this axis, not the reason for it**: its
tool registry is one more surface that must be derived from the resolver, and it
is the one surface where a mis-scoped capability is also an injection target.

Forces at play:

1. `AGENTS.md` is unambiguous: "The UI disabling a button is never the security
   boundary." Hiding a nav item cannot be the whole answer.
2. Disabling a module must never destroy or orphan tenant data — a workspace
   that switches appointments off for a quarter and back on must find its
   appointments intact.
3. Mira's scope is a **prompt-injection surface**. A customer message is data,
   not instructions (`AGENTS.md`); an out-of-scope tool that merely *refuses* at
   call time still tells the model — and anything steering it — that the
   capability exists.
4. V1 is one account per user, but V2 adds multi-account membership. Whatever
   we store must be `account_id`-scoped so V2 needs no destructive migration.
5. **`vertical-architecture.md` §7 forbids designing the pack abstraction
   upfront** — it was revised after review to say: ship for one vertical,
   hardcoded where necessary, *then extract* the loader from what works. §8/G4
   adds that a vertical needing real custom *logic* becomes a flagged core
   module, never pack-embedded code. This ADR must therefore deliver the
   enablement axis **without** building the `vertical_packs` table, the loader,
   or the marketplace those gates defer.
6. §8 also fixes the migration semantics in advance: pack switches are
   **additive-only**, terminology is a label map over untouched data, and
   removed-module data is retained and hidden, never dropped. D7 below already
   matches this; it is now a cited constraint rather than a coincidence.

---

## Decision

Introduce **module enablement** as an explicit third axis, resolved
server-side, and derive every surface — navigation, route guards, API writes,
Mira's tool registry, and MCP exposure — from one resolver. Seed that axis from a
**vertical preset chosen at onboarding**, shipped as code rather than as the
§5 `vertical_packs` table, so §7's extract-don't-design rule holds.

The pack is **not a fourth factor in the equation** — it is the *initial value*
of the second one. Once applied, the workspace's enabled set is its own; the pack
never re-asserts itself behind the user's back.

**The capability equation.** A capability is available iff all three hold:

```
available(member, capability) =
      entitled(plan,    module)     // commercial: is it in the tenant's plan?
  AND enabled (account, module)     // opt-in:     has the workspace turned it on?
  AND permitted(profile, slug)      // per-user:   does this member hold the slug?
```

Numbered decisions:

1. **D1 — A module registry as pure data.** New
   `src/lib/modules/catalog.ts`: for each module key — label, one-line
   description, `core: boolean`, plan tier required, the routes it owns, the
   permission slugs it governs, the Mira tool names it exposes, and its
   dependencies. No imports, no I/O, so it is safe on both client and server —
   the same discipline that makes `permissions.ts` and `tool-catalog.ts` work.
   Every other artefact in this ADR *derives* from this file, so a new module is
   one entry plus a migration row, not seven scattered edits.

2. **D2 — Core modules are not disableable and are not rows.** Inbox,
   conversations, contacts, messaging and settings are the product's spine;
   `core: true` in the registry and absent from the enablement table entirely.
   There is no state in which a CRM has no contacts surface, and modelling one
   invites a support ticket we can never fix. Optional modules:
   `pipelines`, `appointments`, `catalog`, `broadcasts`, `templates`, `flows`,
   `ai_agents`, `support`, `external_sources`, `api_access`, `webhooks`.

3. **D3 — One table: `account_modules`.**
   `(account_id, module_key)` primary key, `state` ∈
   `('disabled','pending_approval','enabled')`, plus
   `requested_by/requested_at/requested_reason` and
   `enabled_by/enabled_at`. Absent row = plan default (D4). RLS enabled with
   `is_account_member(account_id)` for SELECT — every member must *see* what is
   on, or the nav cannot render — and **no direct INSERT/UPDATE grant at all**:
   writes go only through the RPC in D5.

4. **D4 — Default off, with the plan as the ceiling.** An absent row resolves to
   the registry's default for the tenant's plan, and every optional module
   defaults **off**. This is the whole point: the workspace opts in to
   complexity. The plan is a separate ceiling — a module the plan does not
   entitle cannot be enabled even by the owner, and the enable path returns
   `plan_upgrade_required` rather than pretending.

5. **D5 — Enablement happens only in a `SECURITY DEFINER` RPC that re-checks the
   caller.** `set_account_module(p_module_key, p_state, p_reason)` verifies
   `has_permission(account_id, 'settings:manage')` or account owner
   *server-side*, verifies plan entitlement, verifies dependencies (D6), writes
   the row, and writes an audit entry. Per `AGENTS.md`, `SECURITY DEFINER` is
   stated explicitly in the migration — `CREATE OR REPLACE` does not inherit it,
   and `scripts/push-supabase-schema.mjs` enforces this.

6. **D6 — Dependencies are declared and enforced at enable time, not discovered
   at runtime.** `broadcasts` needs `templates`; `ai_agents` needs a connected
   channel; `flows` needs `templates` when a flow node sends one. Enabling a
   module with unmet dependencies either enables the dependency in the same
   transaction (when the plan entitles it and the registry marks it
   `autoEnable`) or fails with `dependency_required` naming the module. Silent
   partial enablement is how you get a broadcast surface with no templates.

7. **D7 — Disable hides and blocks writes; it never deletes.** Disabling
   removes the surface from nav, 404s the routes, rejects writes at the API
   boundary, and withdraws the module's Mira tools. Existing rows stay
   untouched and readable to anything that already references them (a deal note
   pointing at an appointment does not break). Re-enabling restores the surface
   with its history. Explicitly: **no RLS predicate keyed on module state on
   domain tables** — that path silently voids historical reads and turns a
   packaging toggle into data loss.

8. **D8 — One resolver, threaded like `NavAccess` already is.**
   `resolveAccountCapabilities(accountId, member)` returns
   `{ modules: Set<ModuleKey>, permissions, isOwner, planId }`, computed once
   per request in the dashboard layout and passed down — the exact pattern
   `navigationForAccess(access)` uses today, extended with the module set. Nav
   filtering becomes `!item.permission || has(permission)` **and**
   `!item.module || modules.has(item.module)`.

9. **D9 — The server boundary is a `requireModule()` guard in the API layer, not
   the nav filter.** Every route handler in a module's namespace calls it, the
   same way it already resolves the session. Nav filtering is cosmetic; this is
   the boundary. A disabled module's endpoints return **404**, not 403 —
   consistent with D11's reasoning about not advertising surfaces, and honest:
   for that workspace the surface does not exist.

10. **D10 — Enablement fails open; entitlement fails closed.** If the resolver
    itself errors, optional modules resolve to their **last cached state, else
    on** — a broken toggle must never take the inbox down, matching the quota
    engine's documented posture. But the *enable path* fails closed: an
    unverifiable plan entitlement refuses the enable. UX bound → open;
    commercial and security bounds → closed. Cached in `src/lib/cache` keyed by
    account, TTL 60 s, invalidated by the RPC.

11. **D11 — Mira's out-of-scope tools are absent, not refused.** The per-request
    tool registry is the intersection of the catalog and the enabled module set.
    A tool for a disabled module is **never registered**, so the model cannot
    see it, cannot name it, and cannot be talked into calling it by a customer
    message replayed into context. This is strictly stronger than registering it
    and refusing: refusal leaks the capability's existence and hands an injected
    prompt a target. `tool-catalog.ts` gains a `module` field per entry, and
    `tool-catalog.test.ts` is extended to assert every non-core tool declares
    one.

12. **D12 — Mira can guide and *propose*, never self-approve.** One always-
    registered tool, `propose_module_enable(module_key, reason)`, access class
    `write` — so it inherits the existing `'user-approval'` gating and renders
    an approval card. Its effect depends on who is asking:
    - member **with** `settings:manage`/owner → approving the card calls the D5
      RPC and the module goes live;
    - member **without** it → the tool writes `state='pending_approval'` with
      `requested_by/reason`, notifies the owner, and tells the user honestly
      that it is waiting on an admin. It does **not** enable anything.
    Mira answering "what could this do for me?" for a disabled module is a
    *read* of the registry (static data, no tenant rows) and needs no approval —
    that is the "Mira can guide it" half of the requirement.

13. **D13 — MCP exposure is filtered by the same intersection.** The MCP server
    exposes read tools to any account-level API key holder. Those reads must be
    module-filtered too, or `api_access` becomes a hole around every toggle in
    this ADR. Same resolver, same intersection, no second code path.

14. **D14 — Deliberately not built: per-user module preferences.** Enablement is
    **per account**, and hiding a module from one member is what profile
    permissions are for. Two overlapping per-user hiding mechanisms would make
    "why can't I see X?" unanswerable without a debugger.

15. **D15 — Vertical presets ship as code, not as the `vertical_packs` table.**
    New `src/lib/modules/presets.ts`, a static map from vertical key to
    `{ label, description, modules: ModuleKey[], labelOverrides, pipelineStages,
    fieldHints }`. §5 asks for a `vertical_packs` table; §7 forbids designing the
    abstraction before one vertical works in anger. Presets-as-code satisfies
    both: it is the same *data*, in the cheapest possible container, reviewed in
    PRs, typed against the D1 registry so a preset naming a nonexistent module
    fails `pnpm typecheck` rather than at runtime. When a real design partner
    hits its limits, the table is a migration away and the seed content already
    exists — **that is the extraction §7 asks for**, and it is why this decision
    is a deferral, not a rejection.

16. **D16 — Two columns on `accounts` now: `vertical` and `compliance_profile`;
    the third (`enabled_modules`) is the `account_modules` table of D3, not
    jsonb.** §5 proposed `enabled_modules jsonb`. A table is chosen instead
    because enablement carries per-module state that jsonb models badly:
    `pending_approval` with `requested_by`/`requested_reason`/`enabled_by`/
    `enabled_at` (D3, F6) is a row, not a flag, and D5's RPC needs to write one
    module without read-modify-writing the whole document (lost-update under
    concurrent admins). `vertical` and `compliance_profile` stay scalar columns
    on `accounts` exactly as §5 specifies. `compliance_profile` is added
    **as a column with a default only** — no enforcement, no tier sold — because
    §9/G3 forbids selling "Elevated" before the vendor-chain audit; adding the
    column now is what makes that audit non-blocking later.

17. **D17 — Applying a preset is an ordinary sequence of D5 RPC calls, and it
    happens exactly once.** `applyVerticalPreset(vertical)` loops the preset's
    modules through `set_account_module`, so every entitlement check, dependency
    check, audit row and cache invalidation from D5/D6 applies unchanged. There
    is no second privileged write path, and no preset can enable something the
    plan does not entitle. It is idempotent, and it **never runs again** after
    onboarding: re-running it would silently re-enable modules a user had
    deliberately switched off, which is the §8 additive-only rule read
    backwards. Changing vertical later is D18.

18. **D18 — Changing vertical is additive-only and never disables.** Per §8's
    migration story: switching from `freelancer` to `agency` enables the
    difference, remaps terminology (a label map — data untouched), and
    **disables nothing**. Anything the user no longer wants, they switch off
    themselves through the D5 path, deliberately. Every switch writes an audit
    event with a before/after module set. This makes vertical changes safe by
    construction rather than by careful implementation.

19. **D19 — Terminology is a label map resolved with capabilities, not a
    rename.** "Lead" vs "Patient" vs "Buyer" vs "Client" is the cheapest and
    most convincing part of a pack, and §2 already scopes it as data. The
    resolver returns the active `labelOverrides`; UI reads labels through it;
    **no column, table, route or permission slug is ever renamed** — those stay
    canonical, so the public API (`/api/v1`) and MCP contracts are untouched, per
    ADR-006's stability rule. Out of scope for this ADR: per-vertical dashboard
    widgets, starter templates and starter flows (§2's remaining pack layers).
    They need the same preset container and no new mechanism, and bundling them
    here would make this ADR unshippable.

---

## Options considered

### Where the third axis lives

| Option | Fit | Complexity | Verdict |
| --- | --- | --- | --- |
| **A. Reuse permission slugs (owner unticks `activities:read` for everyone)** | Poor — permissions are per-member; an owner implicitly holds every slug, so an owner can never hide a module from themselves. Ties packaging to RBAC. | None (exists) | **Rejected** — wrong axis; the model cannot express "this workspace doesn't do appointments". |
| **B. Plan entitlements only (per-tier feature lists)** | Poor — commercially useful, but a paying tenant on the top tier gets *everything* switched on, which is exactly the complexity being complained about. | Low | **Rejected** as the whole answer; **kept** as the ceiling in D4. |
| **C. Client-side "layout" preference (localStorage / user setting)** | Poor — hides nav only. API, MCP and Mira all still reach the module. | Very low | **Rejected** — `AGENTS.md`: a disabled control is not a boundary. |
| **D. Registry + `account_modules` + one resolver (chosen)** | Expresses all three axes independently; one derivation point for nav, routes, API, Mira, MCP. | Moderate — one table, one RPC, one resolver, one registry | **Chosen.** |
| **E. Per-module RLS predicates on domain tables** | Total enforcement, but disabling silently voids historical reads and every query pays for the join. | High | **Rejected** — turns a packaging toggle into data loss (D7). |

### Where vertical presets live

| Option | §7 compliance | Cost to add a vertical | Verdict |
| --- | --- | --- | --- |
| **A. `vertical_packs` table + loader now (§5 as written)** | **Violates §7** — designs the abstraction before one vertical has run in anger; §8/G2 also defers pack authoring tooling | Low once built, but the build is the risk | **Deferred**, not rejected — this is the extraction target |
| **B. Presets as typed code (chosen)** | Complies — "hardcoded where necessary", extractable later, and the seed data survives the extraction | One PR, type-checked against the registry | **Chosen** (D15) |
| **C. No presets; user toggles modules individually** | Complies trivially | Zero | **Rejected** — pushes the eleven-module evaluation onto a first-time user; recreates the complexity this ADR exists to remove |
| **D. AI-generated packs from "describe your business" (§10.1)** | Premature — §10 lists it as a *candidate pull-forward*, and it presumes the pack container it would populate | — | **Rejected for now**; D15's preset shape is deliberately the shape such a generator would emit, so this stays open |

### How the enabled set is seeded vs. maintained

| Option | Failure mode | Verdict |
| --- | --- | --- |
| **A. Pack is live config — workspace always reflects its vertical** | A user's deliberate opt-out is silently reverted whenever the pack definition changes; users cannot trust their own settings | **Rejected** |
| **B. Pack seeds once, workspace owns state thereafter (chosen)** | Pack improvements do not reach existing tenants automatically — accepted, and honest: it is their workspace | **Chosen** (D17, D18) |

### How Mira handles a disabled module

| Option | Injection posture | Honesty | Verdict |
| --- | --- | --- | --- |
| **A. Register everything, refuse at execution** | Weak — the tool is visible in the model's context; an injected instruction has a named target and the refusal path becomes the thing to defeat. | Model may promise actions it cannot perform | **Rejected** |
| **B. Register nothing, no explanation** | Strong | Poor — user asks "can you book this?" and Mira looks broken | Rejected |
| **C. Intersect the registry + always-on `propose_module_enable` (chosen)** | Strong — out-of-scope tools are absent from context entirely | Good — Mira explains the module from static registry data and offers to request it | **Chosen** (D11, D12) |
| **D. Let Mira enable modules directly when the user is an owner** | — | — | **Rejected** — an AI acting on an injected "enable everything and export" is precisely the failure this ADR exists to prevent. Approval is a human act; D12 keeps propose and enable separate. |

---

## Security review (binding)

- **F1 — Re-check the role inside the RPC.** `set_account_module` must verify
  owner/`settings:manage` in SQL, not trust the caller. A route-only check is
  bypassable by any authenticated member with the anon key.
- **F2 — State `SECURITY DEFINER` explicitly.** Omitting it silently downgrades
  the function to INVOKER and it fails later, in production, only on the paths
  that needed elevation.
- **F3 — Mira must not be able to widen its own scope.** `propose_module_enable`
  writes at most a `pending_approval` row. The enable transition is reachable
  only from a human-approved action carrying that member's session.
- **F4 — Filter MCP reads by module (D13).** Otherwise an API key reads
  appointments for a workspace that has appointments off.
- **F5 — Ship the resolver and `requireModule()` before the nav filter.** A
  hidden-but-reachable module is a false sense of security; the opposite order
  is merely ugly for a release.
- **F6 — Audit every transition.** `enabled_by`, `enabled_at`, `requested_by`,
  `requested_reason` are the record of who widened the workspace's surface, and
  are the first thing an incident review asks for.
- **F7 — 404, not 403, for disabled modules** (D9) — do not enumerate surfaces
  the tenant has not enabled.
- **F8 — Preset application must not be its own privileged path.** It loops the
  D5 RPC (D17). A bulk "apply pack" function that writes rows directly would
  bypass the entitlement, dependency and audit checks the rest of this ADR rests
  on, and would be the obvious way to grant a free workspace paid modules.
- **F9 — `vertical` is tenant-supplied input; treat it as an enum, not a label.**
  It is written by the onboarding form. Constrain it in SQL (CHECK or enum) and
  resolve presets through a lookup keyed on known values — never interpolate it
  into a query, a path, or an AI prompt.
- **F10 — `compliance_profile` must not imply enforcement it does not have.**
  Per §9/G3 the column ships inert. Do not surface it in tenant-facing UI, and do
  not let Mira describe the workspace as compliant with anything, until the
  vendor-chain audit and DPDP mechanics exist. A half-promised security tier is
  worse than none.

---

## Consequences

**Easier**

- A new tenant sees a small, comprehensible product; complexity arrives when
  asked for. This is the mechanism ADR-008 spends.
- Mira gets sharper: a smaller tool set per tenant means less model confusion,
  fewer wrong-tool calls, and a smaller injection surface.
- Packaging becomes a data change — module × plan in the registry — instead of a
  code change.
- One place to answer "why can't I see X?": the resolver's three factors.

**Harder**

- Every module-owning route handler gains a `requireModule()` call; missing one
  is a hole. `pnpm check:boundaries` cannot catch this, so a test asserting
  every namespaced route guards its module is part of the work (action item 8).
- Empty states multiply: each module needs a "not enabled — here's what it does,
  request it" state, not a blank screen.
- Mira's tests must now cover *absence*: asserting a tool is missing is a
  different assertion shape than asserting it refuses.

**Revisit when**

- V2 multi-account membership lands — the resolver is already `account_id`-keyed,
  but the cache key must include the active account.
- A module needs *partial* enablement (e.g. appointments read-only for viewers) —
  today that is profile permissions' job; if it recurs, the registry grows a
  capability level rather than the table growing states.
- Module count passes ~20 and the settings screen needs grouping.

---

## Action items

1. [ ] `src/lib/modules/catalog.ts` — registry with `core`, plan tier, routes,
   permission slugs, Mira tool names, dependencies (D1, D2, D6)
2. [ ] Migration `YYYYMMDDHHMMSS_account_modules.sql` — table, RLS (SELECT via
   `is_account_member`, no direct writes), `set_account_module` RPC with explicit
   `SECURITY DEFINER` and in-function role + entitlement + dependency checks
   (D3, D5, D6, F1, F2, F6)
3. [ ] `resolveAccountCapabilities()` + 60 s cache with RPC invalidation; fail
   open for enablement, closed for entitlement (D8, D10)
4. [ ] `requireModule()` guard in `src/lib/api/`; apply to every module-owning
   route namespace; 404 on disabled (D9, F5, F7)
5. [ ] Extend `NavItemConfig` with `module` and `navigationForAccess()` with the
   module set (D8)
6. [ ] `tool-catalog.ts`: add `module` per entry; build Mira's per-request
   registry as catalog ∩ enabled; add `propose_module_enable`
   (D11, D12, F3)
7. [ ] MCP server: same intersection for read tools (D13, F4)
8. [ ] Tests: resolver truth table across the three axes; every module route
   404s when disabled; disabled-module tools **absent** from the registry;
   `propose_module_enable` by a non-admin creates `pending_approval` and enables
   nothing; disable→re-enable preserves rows (D7)
9. [ ] Settings → Modules screen (owner/`settings:manage`): enable, disable,
   pending requests, plan-locked modules with upgrade copy
10. [ ] `src/lib/modules/presets.ts` — vertical presets typed against the D1
   registry; start with the four ADR-008 needs (freelancer, sales, support,
   real estate) plus `general` (D15)
11. [ ] Migration: `accounts.vertical` (constrained enum, nullable until
   onboarding) and `accounts.compliance_profile` (default `baseline`, inert);
   `applyVerticalPreset()` looping the D5 RPC; audit event on vertical change
   (D16, D17, D18, F8, F9, F10)
12. [ ] Label map in the resolver + a `useLabels()`/`labelsFor()` accessor;
   migrate hardcoded "Lead"/"Deal" strings in module-owned UI only (D19)
13. [ ] Tests: preset application is idempotent and never enables a
   plan-locked module; vertical change is additive and disables nothing;
   preset keys type-check against the registry; label overrides never alter
   API/MCP payload keys
14. [ ] `pnpm db:doc`, `pnpm docs:sync`, `pnpm check`

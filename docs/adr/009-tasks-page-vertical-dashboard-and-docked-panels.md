# ADR-009: A real Tasks page, a sector-aware dashboard and onboarding, and a docked home for Mira and Team chat

**Status:** Proposed
**Date:** 2026-08-21
**Deciders:** Owner/product (nav additions, vertical widget sets), design (dock layout, dashboard composition), backend (tasks API extension, preset mechanism)
**Relates to:** ADR-007 and ADR-008 (**both Accepted but UNIMPLEMENTED as of this date** — no preset code, no onboarding split exists in `src/`; this ADR carries the *minimum implementation slice* of both that its decisions require), ADR-002 (affective layer — the greeting header stays)

---

## Context

### 0. Implementation reality check (verified 2026-08-21)

Only ADR-001 through ADR-006 are implemented. Direct audit of `src/`:

- `src/lib/modules/presets.ts` **does not exist**. No file in `src/` matches
  "vertical" in a preset/business-type sense.
- `src/features/onboarding/components/` contains exactly four files
  (`onboarding-wizard.tsx`, `welcome-gate.tsx`, `welcome-screen.tsx`,
  `welcome-halftone-canvas.tsx`). The ADR-008 wizard split, checklist, and
  cost-positioning work has not been built.

Therefore this ADR cannot "extend" ADR-007/008 artifacts. Where its
decisions need them, it defines the **smallest buildable slice** inline and
defers the rest of 007/008 unchanged.

### 1. Benchmark: the Salesforce 19-feature checklist

Research source: salesforce.com/in/crm/features ("19 CRM Features That Will
Benefit Your Business"). Audit of wacrm against it:

| # | Salesforce feature | wacrm status | Addressed by |
| --- | --- | --- | --- |
| 1 | Contact management | Strong (workspace, custom fields, import/dedupe) — but tasks/follow-up reminders half-built | **This ADR, Part 1** |
| 2 | Single source of truth | Strong (unified inbox, workspace scoping) | — |
| 3 | AI | Very strong (Mira, auto-reply, KB, agents) — but poorly *placed* in the UI | **This ADR, Part 3** |
| 4 | Reports, dashboards, analytics | Good engine; one hardcoded composition for every sector | **This ADR, Part 2** |
| 5 | Cloud-based | Yes | — |
| 6 | Mobile CRM | Responsive only; no PWA/offline | Deferred (D13) |
| 7 | Automation, workflows, approvals | Strong (Flows) | — |
| 8 | Collaboration tools | Team chat exists but is hidden behind a floating pill | **This ADR, Part 3** |
| 9 | Scalability, flexibility, customisation | Modules/plans exist; per-sector customisation absent | **This ADR, Part 2** |
| 10 | Sales forecasting | Missing entirely | Deferred — needs its own ADR |
| 11 | Sales opportunity management | Good (pipelines, deals) — no next-step/task linkage | **This ADR, D4** |
| 12 | Quotes & order management | Catalog only; no quotes/orders | Deferred — own ADR |
| 13 | Omni-channel support | Strong | — |
| 14 | Customer self-service | KB is AI-internal only; no customer-facing portal | Deferred — own ADR |
| 15 | Field service management | Missing (likely out of scope for a WhatsApp CRM) | Explicitly not planned |
| 16 | Campaign management | Good (broadcasts + funnel analytics) | — |
| 17 | Journey orchestration | Partial (Flows cover the mechanics) | — |
| 18 | Third-party integrations | Good (public API, webhooks, MCP, external sources) | — |
| 19 | Security | Good (RBAC, RLS, audit log, devices) | — |

Reading of the benchmark: the *engine-level* features are competitive. The
gaps this ADR takes are the three where a working backend is betrayed by a
missing or wrong **surface** — task management (Salesforce lists it under
contact management essentials and calls out "task management" explicitly in
its FAQ), customisable per-business dashboards ("each team, or even
individual employee, can decide the metrics that matter and personalise
their dashboards"), and collaboration/AI placement ("teams can see their
data right there in the flow of work, without leaving the app"). The big
missing *engines* — forecasting, quotes, self-service portal — are real gaps
but each is ADR-sized on its own and is deliberately not smuggled in here.

### 2. Tasks is an API and a widget, but not a place

The `tasks` table exists, `/api/v1/workspace/tasks` supports POST/PATCH/GET,
and the dashboard renders `TasksPanel`
(`src/features/dashboards/components/tasks-panel.tsx`) with quick-add and
one-click complete. But:

- There is **no route**: `src/app/(dashboard)/` has no `tasks/` directory.
- There is **no nav item**: `src/lib/navigation/config.ts` never mentions tasks.
- There is **no way to see completed tasks, filter, sort, assign, or link a
  task to a contact/deal** from anywhere but the panel's 200-char quick-add.

A follow-up you cannot find is a follow-up you drop. Salesforce, HubSpot,
and Bigin all treat activities/tasks as a first-class list view; here it is
a side panel with a hard cap of "whatever the dashboard query returns".

### 3. The dashboard and onboarding are one-size-fits-all

The Overview dashboard hardcodes one composition for every tenant: message
volume, channel performance, broadcast performance, sales pipeline. A
clinic, a real-estate agency, and a support desk all see the same five KPI
cards with the same labels. Onboarding never asks what kind of business the
workspace is, so nothing downstream *could* adapt. ADR-007 designed the
preset mechanism and ADR-008 designed the wizard that would ask — neither
was built. The product requirement stands regardless: **a customisable CRM
must fit the sector**, and the dashboard is where that fit is visible first.

### 4. Mira and Team chat float; they need an address

`src/app/(dashboard)/dashboard-shell.tsx` mounts both as overlay launchers:

- `TeamChatWidget` — a floating pill, bottom-right, over page content.
- `AssistantWidget` (Mira) — a floating vertical tab clinging to the right
  edge.

Both cover content (the Team chats pill sits on top of the dashboard's own
"Sales pipeline / View all" row in the current build), both are invisible as
*features*, and neither has a keyboard path. The product owner's requirement
is explicit: **not floating buttons, not icons — a real place in the
layout.** The reference pattern (Linear, Slack, Notion AI, Intercom) is a
sidebar entry for destinations and a docked, content-pushing side panel for
companions.

Forces:

1. Nav real estate is scarce. Anything added to nav must be core-spine.
2. Team chat is a *destination* (you go there, read history, manage
   channels). Mira is a *companion* (you summon it next to whatever you're
   doing — it must not navigate you away from the record you're asking
   about). Different interaction shapes, different homes.
3. The shell is one flex row (`SidebarProvider` → `AppSidebar` +
   `SidebarInset`). A docked right panel is a third flex sibling — cheap, no
   overlay math, no z-index war with dialogs.
4. `AGENTS.md`: UI placement is never a security boundary. Everything here
   is presentation; every data path already has RLS + permission checks and
   must keep them unchanged.

---

## Decision

### Part 1 — Tasks becomes a page

1. **D1 — New route `/tasks`, registered in `src/lib/routing/routes.ts`, nav
   item in the Engage group.** Label "Tasks", icon `square-check` (add to
   `NavIconName`). It is core — follow-ups are the spine of a CRM, the
   dashboard panel already ships to everyone, and a disableable tasks
   surface would orphan the panel. No new module key.

2. **D2 — The page is a filterable list, not a project tool.** Views: **Open
   (default) / Overdue / Completed / All**; filters: assignee (me/anyone),
   priority, due date, linked contact. Sort: due date asc, overdue pinned.
   One inline row editor (title, due, priority, assignee, linked contact) —
   no kanban, no subtasks, no recurring tasks in V1. The moment tasks grows
   project-management ambitions it competes with Flows and loses.

3. **D3 — Extend the existing API, don't fork it.** `/api/v1/workspace/tasks`
   GET gains `status`, `assignee`, `contact_id`, `due_before/after`, cursor
   pagination; PATCH gains the editable fields from D2; add DELETE
   (permission-gated). The dashboard `TasksPanel` keeps calling the same
   endpoints and gains one "View all →" link to `/tasks`. Public-API rule:
   additive only.

4. **D4 — Tasks attach to records.** `contact_id` (and `deal_id` if absent)
   become first-class nullable FKs; the contact record sheet and deal editor
   gain a "New task" affordance that pre-links. This is what turns tasks
   from a to-do list into CRM follow-ups — the cheapest real slice of both
   the Salesforce "contact management with follow-up reminders" (#1) and
   "opportunity management with next steps" (#11) checkboxes.

### Part 2 — The CRM asks the sector and the dashboard shows it

This part **implements the minimum slice of ADR-007/008** that a
sector-aware home screen needs. It does not implement all of either ADR.

5. **D5 — Create the vertical preset mechanism, minimally.** New file
   `src/lib/modules/presets.ts` shipping 4–6 launch presets (e.g. sales
   team, clinic/health, real estate, education/coaching, support desk,
   generic). Each preset is data only: `labelOverrides` (e.g. "Patients"
   for "Contacts"), `pipelineStages`, and a `dashboard` layer — an ordered
   widget list drawn from the **existing** custom-dashboard widget registry
   plus per-vertical KPI card selection. No new widget engine; presets
   compose widgets that already exist. A preset naming a nonexistent widget
   fails `pnpm typecheck`. The full ADR-007 module-enablement registry is
   **not** built here; presets only touch labels, stages, and dashboard
   composition.

6. **D6 — The vertical seeds the Overview dashboard once; it never
   re-asserts itself.** Applying a preset writes an ordinary user-editable
   dashboard layout (the custom-dashboard system's existing storage). The
   user rearranges or deletes widgets freely; changing vertical later adds
   missing widgets and touches nothing else. This is exactly Salesforce
   feature #4's promise — personalised dashboards — with a sensible
   sector default instead of a blank canvas.

7. **D7 — Onboarding asks the vertical question, as one tap.** The existing
   `onboarding-wizard.tsx` gains, in its first step, **"What kind of
   business is this?"** — a single-select grid of the shipped presets plus
   "Something else" (→ generic). Answering it applies the preset at wizard
   completion, server-side, owner-scoped, exactly once. Zero free text. The
   broader ADR-008 wizard split (checklist, cost positioning) remains
   deferred; this is one question added to the wizard that exists today.

8. **D8 — A data-derived "Set up" checklist renders as the first widget on
   the seeded dashboard** until dismissed (connect a channel, import
   contacts, create a pipeline, invite a teammate — each checked off from
   real data, never a stored boolean). This is the one ADR-008 idea pulled
   forward, because an empty sector dashboard with nothing actionable is
   the current onboarding's worst moment.

### Part 3 — Mira docks; Team chat gets an address

9. **D9 — Team chat becomes a page: `/team-chat`, nav item at the bottom of
   the Engage group** (label "Team chat", icon `message-square`). The
   existing widget conversation/channel components are reused as the page
   body in a two-pane layout (channel list + thread). The floating pill
   launcher is **removed**. Team chat is a destination and gets destination
   treatment; hiding a whole messaging surface behind a pill is why nobody
   found it. (Salesforce #8: collaboration "in the flow of work" — a page
   with history and channels, not a bubble.)

10. **D10 — Mira docks as a right-side panel that pushes content, toggled
    from one persistent affordance in the top bar.** Implementation: a third
    flex sibling inside `SidebarProvider`, width ~380 px, `hidden` below
    `lg` (where it falls back to a full-height sheet). Toggle lives at the
    **right end of the top bar on every route** (the `MobileTopBar` grows a
    desktop variant, or a slim persistent header strip) — a labelled "Mira"
    button, not an icon-only mystery — plus keyboard shortcut **⌘/Ctrl + J**.
    Open/closed state persists per user (localStorage; it is a UI
    preference, not data). The floating edge-tab launcher is removed.

11. **D11 — Mira keeps conversation context across routes.** The docked
    panel stays mounted in the shell (as the widget is today), so navigating
    from `/inbox` to `/contacts` mid-conversation loses nothing. This is the
    one property the floating widget got right and the redesign must not
    regress.

12. **D12 — One dock, one occupant.** Team chat does not also get a docked
    mini-mode in V1. Two competing right panels reintroduces the overlap
    problem this ADR exists to kill. If a "quick DM without leaving the
    record" need is proven later, it enters the same dock slot, mutually
    exclusive with Mira — revisit then.

13. **D13 — Deliberately not built (each needs its own ADR when demanded):**
    sales forecasting (#10), quotes/orders (#12), customer-facing
    self-service portal (#14), field service (#15 — likely never), PWA/
    offline mobile (#6), a global notification bell, a command palette
    (tracked as the ease-of-use follow-up), the full ADR-007 module registry
    and Settings → Modules surface, the full ADR-008 wizard split, tasks
    recurrence/reminders, and any change to Mira's tool registry or
    approval gating.

---

## Options considered

### Tasks surface

| Option | Findability | Effort | Verdict |
| --- | --- | --- | --- |
| **A. Keep panel-only, enrich the panel** | Poor — still invisible off-dashboard | Low | **Rejected** — the defect is the missing place, not the panel's features. |
| **B. `/tasks` page + panel links to it (chosen)** | Good — nav item + record-level entry points | Medium | **Chosen** (D1–D4) |
| **C. Full activities module (tasks + calls + notes timeline)** | Best | High — new schema, new module key | Rejected for now — right destination, too big a first bite; D4's FKs are the forward-compatible slice. |

### Sector-aware dashboard

| Option | Sector fit | Prerequisite honesty | Verdict |
| --- | --- | --- | --- |
| **A. One hardcoded dashboard (status quo)** | None | — | **Rejected** — the defect. |
| **B. Implement all of ADR-007 + 008 first, then the dashboard layer** | Good eventually | Honest but serialises months of work behind a home-screen fix | Rejected — the module registry and wizard split are not needed to make the dashboard fit a sector. |
| **C. Minimal preset slice: labels + stages + dashboard, one wizard question (chosen)** | Good on day one | Explicitly scoped as a slice of 007/008; neither is contradicted | **Chosen** (D5–D8) |
| **D. Fully dynamic per-vertical dashboard engine** | Best in theory | New widget engine + per-vertical queries | Rejected — nothing proves the need; presets compose existing widgets only. |

### Mira / Team chat placement

| Option | Discoverability | Content overlap | Verdict |
| --- | --- | --- | --- |
| **A. Floating launchers (status quo)** | Poor | Yes — covers page content | **Rejected** — the stated defect. |
| **B. Both as sidebar pages** | Good | None | Rejected for Mira — navigating away from the record you're asking about breaks the companion model (force 2). Chosen for Team chat (D9). |
| **C. Docked content-pushing right panel for Mira, page for Team chat (chosen)** | Good — labelled top-bar toggle + shortcut | None — flex sibling, no overlay | **Chosen** (D9–D12) |
| **D. Both in one tabbed dock** | Medium | None | Rejected — buries team chat history/channel management in a 380 px strip; kept as the D12 escape hatch only. |

---

## Security and correctness review (binding)

- **F1 — Tasks API stays account-scoped and permission-checked.** Every new
  filter and the DELETE verb re-verify account membership at the RLS layer
  and the route handler; `assignee` filtering must not allow reading another
  account's member list. Additive-only on `/api/v1` per the stability rule.
- **F2 — Task↔record links are same-account only.** The FK write path must
  verify the linked contact/deal belongs to the caller's account
  server-side — a task pointing across tenants is an IDOR primitive.
- **F3 — Preset application runs server-side in the onboarding completion
  path, owner-scoped, and writes through the existing dashboard storage
  path** with its existing authorization. Presets are static data compiled
  into the app; no user input flows into label overrides or widget lists.
- **F4 — The dock changes zero trust boundaries.** Mira's tools and approval
  cards are untouched; only the container moves. Team chat's page reuses the
  widget's data hooks and their RLS unchanged.
- **F5 — Dashboard composition is cosmetic; the API guard is the boundary.**
  Hiding or showing a pipeline widget must never be the only thing between a
  viewer-role member and pipeline data.

---

## Consequences

**Easier**

- Follow-ups become findable, filterable, and attachable to the records they
  are about — closing the loudest surface gap against the Salesforce
  checklist (#1, #11) at low cost.
- Two tenants in different sectors see different home screens with their own
  vocabulary from day one, without building the full module registry.
- Mira gains a permanent, labelled, keyboard-reachable home; Team chat stops
  being a secret. Nothing floats over content anymore.
- `dashboard-shell.tsx` gets simpler: two overlay widgets replaced by one
  dock slot and one route.
- ADR-007/008 get a shipped foothold: when their full scope is built later,
  the preset file, the wizard question, and the checklist are already in
  place to extend rather than invent.

**Harder**

- Nav grows by two items (Tasks, Team chat) — accepted because both are
  core-spine follow-up/communication surfaces, not optional complexity.
- The top bar must now exist on desktop on every route (today `MobileTopBar`
  is mobile-only); full-bleed routes like Inbox need a pass.
- Preset dashboard content is an opinion per sector that someone must author
  and maintain; a wrong default is worse than a bland one.
- Partial implementation of 007/008 creates a "which parts shipped?" reading
  burden — mitigated by this ADR's explicit slice list (D5, D7, D8) and D13's
  explicit deferral list.
- Removing the launchers breaks the muscle memory of existing users; ship a
  one-time "Mira moved here" pointer, then never again.

**Revisit when**

- Task volume or user demand proves the need for activities/notes/calls —
  option C of Part 1 becomes the follow-up ADR.
- Forecasting, quotes, or a self-service portal is demanded — each is its
  own ADR (D13), building on the pipeline/catalog/KB engines that exist.
- A second dock occupant is genuinely demanded (D12).
- The full ADR-007 module registry is scheduled — presets then gain their
  `modules` list and the Settings surface, additively.

---

## Action items

1. [ ] `/tasks` route + nav item + route constant; page with D2's views and
   filters (D1, D2)
2. [ ] Extend `/api/v1/workspace/tasks` GET/PATCH, add DELETE; cursor
   pagination; tests for scoping and additive compatibility (D3, F1)
3. [ ] `contact_id`/`deal_id` FKs via new timestamped migration; "New task"
   entry points on contact sheet and deal editor; cross-account link test
   (D4, F2) — then `pnpm db:doc` + `pnpm docs:sync`
4. [ ] `TasksPanel`: "View all →" link to `/tasks`
5. [ ] Create `src/lib/modules/presets.ts` with 4–6 launch presets:
   labelOverrides + pipelineStages + dashboard widget list, typecheck-
   enforced widget refs (D5)
6. [ ] Seed Overview layout from preset at onboarding completion; additive
   re-seed on vertical change (D6, F3)
7. [ ] Wizard gains the sector single-select in step 1 (D7)
8. [ ] Data-derived "Set up" checklist as first dashboard widget (D8)
9. [ ] `/team-chat` page from existing widget components; remove
   `TeamChatWidget` launcher (D9)
10. [ ] Docked Mira panel as shell flex sibling; top-bar toggle + ⌘J;
    per-user persistence; remove floating launcher; mobile sheet fallback
    (D10, D11)
11. [ ] One-time "moved here" pointers for both relocations
12. [ ] `pnpm check` + docs mirror sync

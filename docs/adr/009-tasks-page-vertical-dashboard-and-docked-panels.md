# ADR-009: A real Tasks page, a vertical-aware dashboard, and a docked home for Mira and Team chat

**Status:** Proposed
**Date:** 2026-08-21
**Deciders:** Owner/product (nav additions, vertical widget sets), design (dock layout, dashboard composition), backend (tasks API extension)
**Relates to:** ADR-007 (vertical presets and module enablement — this ADR builds the dashboard layer D19 deferred), ADR-008 (onboarding split — this ADR consumes its checklist and vertical choice), ADR-002 (affective layer — the greeting header stays)

---

## Context

Three defects were confirmed by direct audit of the running code on 2026-08-21.

### 1. Tasks is an API and a widget, but not a place

The `tasks` table exists, `/api/v1/workspace/tasks` supports POST/PATCH/GET,
and the dashboard renders `TasksPanel`
(`src/features/dashboards/components/tasks-panel.tsx`) with quick-add and
one-click complete. But:

- There is **no route**: `src/app/(dashboard)/` has no `tasks/` directory.
- There is **no nav item**: `src/lib/navigation/config.ts` never mentions tasks.
- There is **no way to see completed tasks, filter, sort, assign, or link a
  task to a contact/deal from anywhere but the panel's 200-char quick-add.**

A follow-up you cannot find is a follow-up you drop. Salesforce, HubSpot, and
Bigin all treat activities/tasks as a first-class list view; here it is a
side-panel with a hard cap of "whatever the dashboard query returns". The
panel is good for glancing; it cannot be the only surface.

### 2. The dashboard and onboarding are one-size-fits-all

The Overview dashboard hardcodes one composition for every tenant: message
volume, channel performance, broadcast performance, sales pipeline. A clinic,
a real-estate agency, and a support desk all see the same five KPI cards with
the same labels. ADR-007/D15 introduced vertical presets
(`src/lib/modules/presets.ts` — modules, labelOverrides, pipelineStages) and
ADR-007/D19 explicitly deferred "per-vertical dashboard widgets" as out of
scope. ADR-008/D9 decided a data-derived "Set up" checklist on the dashboard.
**Neither the vertical widget layer nor the checklist has a decided rendering
home.** This ADR is that decision: the dashboard is where a vertical becomes
*visible*, and today it isn't.

Onboarding compounds it: the wizard (ADR-008/D7) collects the workspace name
and channel, but the vertical question — the single input that would let the
dashboard, labels, and pipeline match the user's business — has no decided
placement in the wizard flow. ADR-007/D17 says `applyVerticalPreset` runs
"exactly once at onboarding" without fixing where the question is asked.

### 3. Mira and Team chat float; they need an address

`src/app/(dashboard)/dashboard-shell.tsx` mounts both as overlay launchers:

- `TeamChatWidget` — a floating pill, bottom-right, over page content.
- `AssistantWidget` (Mira) — a floating vertical tab clinging to the right
  edge, bottom-left launcher.

Both cover content (the Team chats pill sits on top of the dashboard's own
"Sales pipeline / View all" row in the current build), both are invisible as
*features* (a new user has no reason to know a full team-messaging surface
hides behind a pill), and neither has a keyboard path. The product owner's
requirement is explicit: **not floating buttons, not icons — a real place in
the layout.** The reference pattern (Linear, Slack, Notion AI, Intercom) is a
sidebar entry for destinations and a docked, content-pushing side panel for
companions.

Forces:

1. Nav real estate is scarce and ADR-007's whole point is *fewer* surfaces,
   not more. Anything added to nav must be core-spine or module-gated.
2. Team chat is a *destination* (you go there, read history, manage
   channels). Mira is a *companion* (you summon it next to whatever you're
   doing — it must not navigate you away from the record you're asking about).
   These are different interaction shapes and deserve different homes.
3. The shell is one flex row (`SidebarProvider` → `AppSidebar` +
   `SidebarInset`). A docked right panel is a third flex sibling — cheap,
   no overlay math, no z-index war with dialogs.
4. `AGENTS.md`: UI placement is never a security boundary. Everything here is
   presentation; every data path already has RLS + permission checks and must
   keep them unchanged.

---

## Decision

### Part 1 — Tasks becomes a page

1. **D1 — New route `/tasks`, registered in `src/lib/routing/routes.ts`, nav
   item in the Engage group.** Label "Tasks", icon `square-check` (add to
   `NavIconName`). It is **core** in the ADR-007 registry sense — follow-ups
   are the spine of a CRM, the dashboard panel already ships to everyone, and
   a disableable tasks surface would orphan the panel. No new module key.

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
   gain a "New task" affordance that pre-links. This is what turns tasks from
   a to-do list into CRM follow-ups, and it is the cheapest slice of the
   "360° timeline" gap identified against Salesforce.

### Part 2 — The dashboard renders the vertical; onboarding asks for it

5. **D5 — Vertical presets gain a `dashboard` layer** (the exact extraction
   ADR-007/D19 deferred): each preset in `src/lib/modules/presets.ts` names an
   ordered widget list drawn from the **existing** custom-dashboard widget
   registry (`src/features/dashboards/lib/widgets.ts`). No new widget engine —
   presets compose widgets that already exist, plus per-vertical KPI card
   selection and label overrides (a clinic sees "Patients this month", not
   "New contacts"). A preset naming a nonexistent widget fails `pnpm
   typecheck`, same discipline as D15's module list.

6. **D6 — The vertical seeds the Overview dashboard once; it never re-asserts
   itself.** Applying a preset writes an ordinary user-editable dashboard
   layout (the custom-dashboard system's storage), exactly like ADR-007/D17's
   additive-only rule. The user rearranges or deletes widgets freely;
   changing vertical later adds missing widgets and touches nothing else.

7. **D7 — Widget visibility intersects with module enablement.** A pipeline
   widget renders only when `pipelines` is enabled (ADR-007 resolver); a
   disabled module's widget shows nothing — not an upsell card — on the
   default dashboard. Upsell lives in Settings → Modules and Mira's
   evidence-based suggestions (ADR-008/D10), not on the home screen.

8. **D8 — Onboarding asks the vertical question in step 1, as one tap.**
   Step 1 of the ADR-008/D7 wizard becomes: workspace name **+ "What kind of
   business is this?"** — a single-select grid of the shipped presets plus
   "Something else" (→ generic preset). Answering it triggers
   `applyVerticalPreset` (ADR-007/D17) at wizard completion. It adds zero
   free-text input and removes the "which modules do you need?" question
   permanently (ADR-007/D11 already forbids that). The ADR-008/D9 "Set up"
   checklist renders as the first widget on the seeded dashboard until
   dismissed.

### Part 3 — Mira docks; Team chat gets an address

9. **D9 — Team chat becomes a page: `/team-chat`, nav item in a new "Team"
   position at the bottom of the Engage group** (label "Team chat", icon
   `message-square`). The existing widget conversation/channel components are
   reused as the page body in a two-pane layout (channel list + thread). The
   floating pill launcher is **removed**. Team chat is a destination and gets
   destination treatment; hiding a whole messaging surface behind a pill is
   why nobody found it.

10. **D10 — Mira docks as a right-side panel that pushes content, toggled
    from one persistent affordance in the top bar.** Implementation: a third
    flex sibling inside `SidebarProvider`, width ~380 px, `hidden` below
    `lg` (where it falls back to a full-height sheet). Toggle lives at the
    **right end of the top bar on every route** (the `MobileTopBar` grows a
    desktop variant, or a slim persistent header strip) — a labelled "Mira"
    button, not an icon-only mystery — plus keyboard shortcut **⌘/Ctrl + J**.
    Open/closed state persists per user (localStorage; it is a UI
    preference, not data). The floating edge-tab launcher is removed.

11. **D11 — Mira keeps conversation context across routes.** The docked panel
    stays mounted in the shell (as the widget is today), so navigating from
    `/inbox` to `/contacts` mid-conversation loses nothing. This is the one
    property the floating widget got right and the redesign must not regress.

12. **D12 — One dock, one occupant.** Team chat does not also get a docked
    mini-mode in V1. Two competing right panels reintroduces the overlap
    problem this ADR exists to kill. If a "quick DM without leaving the
    record" need is proven later, it enters the same dock slot,
    mutually exclusive with Mira — revisit then.

13. **D13 — Deliberately not built:** a global notification bell, a
    command palette (tracked separately as the ease-of-use follow-up),
    per-widget vertical *data* queries (presets compose existing widgets
    only), tasks recurrence/reminders, and any change to Mira's tool
    registry or approval gating (ADR-007/D11-D12 stand unchanged).

---

## Options considered

### Tasks surface

| Option | Findability | Effort | Verdict |
| --- | --- | --- | --- |
| **A. Keep panel-only, enrich the panel** | Poor — still invisible off-dashboard, unbounded list in a side card | Low | **Rejected** — the defect is the missing place, not the panel's features. |
| **B. `/tasks` page + panel links to it (chosen)** | Good — nav item + record-level entry points | Medium | **Chosen** (D1–D4) |
| **C. Full activities module (tasks + calls + notes timeline)** | Best | High — new schema, new module key | Rejected for now — right destination, too big a first bite; D4's FKs are the forward-compatible slice. |

### Vertical dashboard

| Option | Sector fit | Mechanism | Verdict |
| --- | --- | --- | --- |
| **A. One hardcoded dashboard (status quo)** | None | — | **Rejected** — the defect. |
| **B. Preset-seeded, user-owned layout (chosen)** | Good — differs by vertical on day one, user keeps control | Reuses custom-dashboard storage + presets file | **Chosen** (D5–D8) |
| **C. Fully dynamic per-vertical dashboard engine** | Best in theory | New widget engine + per-vertical queries | Rejected — violates ADR-007 §7 extract-don't-design; nothing proves the need yet. |

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
  filter and the DELETE verb re-verify `is_account_member` at the RLS layer
  and the route handler; `assignee` filtering must not allow reading another
  account's member list. Additive-only on `/api/v1` per the stability rule.
- **F2 — Task↔record links are same-account only.** The FK write path must
  verify the linked contact/deal belongs to the caller's account server-side
  — a task pointing across tenants is an IDOR primitive.
- **F3 — Preset-seeded dashboards write through the existing dashboard
  storage path** with its existing authorization; the seeding runs in the
  onboarding completion server action, owner-scoped (ADR-008/F3).
- **F4 — The dock changes zero trust boundaries.** Mira's tools, approval
  cards, and module intersection (ADR-007/D11–D12) are untouched; only the
  container moves. Team chat's page reuses the widget's data hooks and their
  RLS unchanged.
- **F5 — Widget/module intersection is cosmetic; the API guard is the
  boundary** (ADR-007/D9). Hiding a pipeline widget must never be the only
  thing between a viewer-role member and pipeline data.

---

## Consequences

**Easier**

- Follow-ups become findable, filterable, and attachable to the records they
  are about — the cheapest real step toward the contact-360 gap.
- The vertical choice made in onboarding is finally *visible*: two tenants in
  different sectors see different home screens with their own vocabulary, at
  the cost of one preset field and zero new engines.
- Mira gains a permanent, labelled, keyboard-reachable home; Team chat stops
  being a secret. Nothing floats over content anymore.
- `dashboard-shell.tsx` gets simpler: two overlay widgets replaced by one
  dock slot and one route.

**Harder**

- Nav grows by two items (Tasks, Team chat) — tension with ADR-007's
  fewer-surfaces goal, accepted because both are core-spine communication/
  follow-up surfaces, not optional complexity.
- The top bar must now exist on desktop on every route (today `MobileTopBar`
  is mobile-only); full-bleed routes like Inbox need a pass.
- Preset dashboard content is an opinion per vertical that someone must
  author and maintain; a wrong default is worse than a bland one.
- Removing the launchers breaks the muscle memory of existing users; ship a
  one-time "Mira moved here" pointer, then never again.

**Revisit when**

- Task volume or user demand proves the need for activities/notes/calls —
  option C of Part 1 becomes the follow-up ADR.
- A second dock occupant is genuinely demanded (D12).
- A design partner's vertical needs widgets that don't exist — that is the
  moment to consider per-vertical widget *code*, not before.

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
5. [ ] Add `dashboard` layer to `presets.ts`; typecheck-enforced widget refs
   (D5)
6. [ ] Seed Overview layout from preset at onboarding completion; additive
   re-seed on vertical change (D6, F3)
7. [ ] Widget × module-enablement intersection in the dashboard renderer
   (D7, F5)
8. [ ] Wizard step 1 gains the vertical single-select; checklist renders as
   first dashboard widget (D8; depends on ADR-008 items 3 and 6)
9. [ ] `/team-chat` page from existing widget components; remove
   `TeamChatWidget` launcher (D9)
10. [ ] Docked Mira panel as shell flex sibling; top-bar toggle + ⌘J;
    per-user persistence; remove floating launcher; mobile sheet fallback
    (D10, D11)
11. [ ] One-time "moved here" pointers for both relocations
12. [ ] `pnpm check` + docs mirror sync

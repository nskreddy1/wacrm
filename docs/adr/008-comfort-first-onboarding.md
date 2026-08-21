# ADR-008: Comfort-first onboarding — the user chooses their workspace layout

**Status:** Proposed
**Date:** 2026-08-21
**Deciders:** Owner/product (step contents + suggestions), design (wizard UX), backend (persisting choices)
**Supersedes:** the rejected "Onboarding split and cost positioning" draft (removed in `7d7ce7f`)
**Relates to:** ADR-007 (the enablement mechanism this wizard writes to), ADR-004 (invites), ADR-006 (channel constraints on what onboarding may promise)

---

## Why the previous draft was rejected — and what changes

The removed draft bundled two things review would not accept together:

1. **Pricing and cost positioning against HubSpot/Zendesk.** Tier tables and
   competitor price lists do not belong in an onboarding ADR. All pricing
   content is **removed** — this ADR is about onboarding only.
2. **An activation-metric flow, not a comfort flow.** Its success criterion
   was "a message row exists". Review's criterion is different: _the user
   finishes onboarding understanding what their workspace contains, having
   chosen it themselves, comfortable that nothing was forced on them and
   nothing is hidden from them._

What this ADR keeps: onboarding must ask few questions, every step must do
real work, and it must never promise a channel connection ADR-006 says we
cannot deliver.

## Context

### The current wizard defers all complexity to discovery

`src/features/onboarding/components/onboarding-wizard.tsx` is three steps:
name the workspace, a **read-only pointer** at Settings → Channels, invite
teammates. It configures nothing about what the user will see. The user then
lands in a 27-module application with every nav item visible — the product
decided the layout, and it decided "everything". That is the rejection reason
in one sentence: **onboarding never asked what the user needs.**

### How leading CRMs actually onboard (research)

- **Salesforce** ([salesforce.com/in/crm/features](https://www.salesforce.com/in/crm/features/))
  frames feature choice as the customer's decision: "pick the ones that matter
  most to you, with the flexibility to add or subtract features as your needs
  evolve." Its setup flows are goal-oriented, not exhaustive.
- **HubSpot** branches immediately on "what brings you here today?" and uses
  progressive disclosure — users see only tasks relevant to their stated goal,
  and the rest of the product reveals itself later.
- **Industry guidance (2026)** converges on: keep the blocking wizard to 2–4
  steps and default everything defaultable; move the rest to a non-blocking,
  skippable checklist; sequence value over breadth ("crawl/walk/run"); route
  by use case so users only see relevant modules.

The common shape: **a short wizard that asks about the user, shows a
recommendation, lets the user edit it, and defers everything else.** Nobody
successful front-loads configuration, and nobody successful configures
silently either.

## Decision

### D1 — Onboarding's job: the user leaves with a workspace shaped by their own choices

The wizard's success criterion is comprehension and consent, not a metric: at
the end, the user has (a) named the workspace, (b) **seen the full feature
catalog and chosen their layout from it**, and (c) been told exactly where the
unchosen features live. Nothing in the wizard may configure something the user
did not see.

### D2 — Four steps, each doing real work

| #   | Step                     | What it does                                                                                                                                                                                                         | Blocking?                                                    |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | **Workspace**            | Name the workspace (unchanged)                                                                                                                                                                                       | Yes — minimal                                                |
| 2   | **About your business**  | 2 light questions: what the team mainly does (selling / supporting / both / something else) and rough team size. Used **only** to reorder suggestions in step 3 — never to auto-enable anything                      | Skippable                                                    |
| 3   | **Choose your features** | The feature picker (D3) — the heart of the flow                                                                                                                                                                      | Yes — but pre-filled, so "Continue" is always one click away |
| 4   | **Review**               | A visual summary of the chosen layout: the nav the user will see, rendered as a preview; plus one line — "Everything you didn't pick is in Settings → Features, off until you want it." Finish lands on `/dashboard` | Yes — read-only                                              |

Invites and channel connection **leave the wizard** and move to a
non-blocking, dismissible "Getting started" checklist on the dashboard
(connect a channel, invite a teammate, add your first contact, send a
template). Per the research: the wizard blocks on choices only the user can
make; everything else is a checklist item they finish at their own pace.

### D3 — The feature picker: user picks, product suggests, nothing is silent

Step 3 renders the ADR-007 catalog as a plain-language checklist:

- **Core features** (Inbox, Contacts, Dashboard…) shown at top as
  already-included — visible so the user knows what they're getting, not
  toggleable, labeled "Included".
- **Optional features** each show name, one-sentence benefit, and a checkbox.
- **Suggestions are visible and rejectable.** Entries the catalog (D1 of
  ADR-007) marks suggested — reordered by the step-2 answers — appear
  pre-checked with a "Suggested" badge. Unchecking is one click and never
  argued with. If step 2 was skipped, the static catalog defaults apply.
- **Unchecked features are explicitly accounted for.** The step footer states:
  "Features you don't pick stay off and hidden — you can turn any of them on
  later in Settings → Features." The user consents to the hiding; it is never
  a surprise.
- Selecting nothing optional is valid: core CRM alone is a legitimate layout.

On Finish, the selection is written once via the ADR-007 RPC and the wizard
completes as today (`onboarding_completed_at`, one-way `router.replace`).

### D4 — Honest channel messaging, inherited from ADR-006

Neither the wizard nor the checklist may promise a live WhatsApp connection
while ADR-006/D10 holds (sandbox-only credentials). The checklist's "connect
a channel" item links to Settings → Channels and describes the sandbox path
truthfully. Onboarding never demos with fake data presented as real.

### D5 — Re-runnable in spirit: Settings → Features is the wizard's permanent twin

The wizard runs once, but its central step never becomes unreachable: the
Settings → Features page (ADR-007/D4) shows the same catalog, same language,
same one-click toggles, forever. "You can change this later" is a real
sentence with a real destination, which is what makes a 4-step wizard safe to
keep short.

## Consequences

**Positive**

- First render after onboarding shows a nav the user personally assembled —
  the comfort criterion, made mechanical.
- Suggestions give the "business perspective" guidance the user asked for
  without ever deciding for them.
- The wizard stays short (4 steps, 2 skippable-or-one-click) while doing
  strictly more real work than the current 3 steps, which do almost none.
- No pricing entanglement; this ADR can be approved by product/design alone.

**Negative / accepted costs**

- The picker is the wizard's one heavy screen; it must be excellent (clear
  copy, no jargon, fast) or it becomes a wall. Design owns this risk.
- Reordering suggestions from step-2 answers is a heuristic that needs copy
  review so it never reads as the product deciding.
- Existing workspaces (onboarded before this) never saw the picker; they
  default to **all features enabled** so nothing disappears from anyone's nav
  on deploy, and they can prune from Settings → Features.

**Explicitly not doing (learned from the rejection)**

- No pricing, tiers, or competitor cost positioning anywhere in onboarding.
- No business-type presets that enable features without the user seeing and
  confirming each one.
- No activation-metric gate ("must send a message to finish") — activation is
  the checklist's job, comfort is the wizard's.

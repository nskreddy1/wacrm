# ADR-007: Feature catalog and user-chosen module enablement

**Status:** Proposed
**Date:** 2026-08-21
**Deciders:** Owner/product (catalog contents + recommendations), backend (enablement storage + enforcement), design (Settings → Features surface)
**Supersedes:** the rejected "Vertical packs and module enablement" draft (removed in `7d7ce7f`)
**Relates to:** ADR-001 (workspace modules), ADR-004 (invites and membership), ADR-005 (AI agent configuration), ADR-008 (the onboarding flow that asks the question this ADR stores the answer to)

---

## Why the previous draft was rejected — and what changes

The removed draft chose features **for** the user: it inferred a "vertical pack"
from business type and pre-configured the workspace from a preset. Review
rejected that direction:

1. **Presets decide; users should decide.** A preset is a guess. When the guess
   is wrong, the user gets surface area they never asked for — the exact
   problem the mechanism was meant to solve.
2. **It optimized activation metrics, not user comfort.** The goal is that the
   user understands what they have, chose it themselves, and knows where the
   rest lives.

This ADR keeps the one thing the rejected draft got right — the missing
**enablement axis** (per-workspace "do we use this module at all?") — and
replaces preset-driven selection with **direct user choice plus visible
suggestions**.

## Context

### What the research says a CRM is made of

Salesforce's canonical feature list ([salesforce.com/in/crm/features](https://www.salesforce.com/in/crm/features/))
enumerates 19 CRM capabilities. Mapped against this codebase's 27 feature
modules (`src/features/`), almost everything already exists here:

| Salesforce CRM feature               | This product's module(s)                   | Core or optional?                                            |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| 1. Contact management                | `contacts`, `module-fields`                | **Core** — every CRM user needs it                           |
| 2. Single source of truth            | shared conversations/contacts data model   | **Core** (architecture, not a toggle)                        |
| 3. AI                                | `assistant` (Mira), `agents`               | Optional                                                     |
| 4. Reports, dashboards & analytics   | `dashboards`                               | **Core** (the landing surface)                               |
| 5. Cloud-based CRM                   | the deployment itself                      | N/A                                                          |
| 6. Mobile CRM                        | responsive shell                           | N/A                                                          |
| 7. Automation, workflows & approvals | `flows`                                    | Optional                                                     |
| 8. Collaboration tools               | `team-chat`, `presence`, `alerts`          | Optional                                                     |
| 9. Scalability & customisation       | `module-fields`, `settings`                | **Core** infrastructure                                      |
| 10. Sales forecasting                | `pipelines` (reporting layer)              | Optional                                                     |
| 11. Sales opportunity management     | `pipelines`                                | Optional — core **for sales teams**, noise for support desks |
| 12. Quotes & order management        | `catalog`                                  | Optional                                                     |
| 13. Omni-channel support             | `channels`, `whatsapp`, `inbox`            | **Core** — the product's reason to exist                     |
| 14. Customer self-service            | `support` (tickets/KB)                     | Optional                                                     |
| 15. Field service management         | `appointments`                             | Optional                                                     |
| 16. Campaign management              | `broadcasts`, `templates`                  | Optional                                                     |
| 17. Journey orchestration            | `flows` + `broadcasts`                     | Optional                                                     |
| 18. Third-party integrations         | `webhooks`, `api-keys`, `external-sources` | Optional                                                     |
| 19. Security                         | RLS, roles, encrypted secrets              | **Core** (never a toggle)                                    |

Salesforce's own closing guidance is the thesis of this ADR:

> "The right CRM will allow your organisation to **pick the ones that matter
> most to you**, with the flexibility to **add or subtract features as your
> needs evolve**."

Note what Salesforce does _not_ do: it does not silently configure your org
from your industry. Picking features is presented as the customer's decision.

### The gap in the running code

Three access questions exist; only two have machinery:

| Question                                        | Axis                                | Machinery today                  |
| ----------------------------------------------- | ----------------------------------- | -------------------------------- |
| How much may this workspace consume?            | Entitlement (plan/quota)            | `plans` + `src/lib/quotas/` ✅   |
| May this member do this action?                 | Permission (per-user role)          | profiles + `has_permission()` ✅ |
| **Does this workspace use this module at all?** | **Enablement (per-account choice)** | **none** ❌                      |

Concretely:

- **Navigation** (`src/lib/navigation/config.ts`) gates only on per-member
  `permission` slugs. A workspace that will never book an appointment still
  shows `/appointments` to its owner; one with no product catalog still shows
  `/catalog`.
- **Mira's tool catalog** (`src/features/assistant/lib/tool-catalog.ts`)
  registers all tools unconditionally, including tools for surfaces the
  workspace never opted into.
- **Onboarding** never asks the question, so there is no answer to store.

## Decision

### D1 — A feature catalog, written in the user's language

Define a static catalog (`src/features/settings/lib/feature-catalog.ts`) that
groups the optional modules into user-facing features. Catalog entries are
**plain-language**: name, one-sentence "what you get", and which nav items /
routes / Mira tools it controls. The catalog is code, not database content —
it changes with releases, not per tenant.

**Always-on core (never asked, never hideable):** Dashboard, Inbox +
Channels, Contacts (with custom fields), Settings, security. This is the
minimum honest CRM per the Salesforce research (features 1, 2, 4, 13, 19).

**Optional features (the user's choice):**

| Catalog entry (user-facing name)  | Modules controlled                         | Suggested-on by default?                                              |
| --------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Sales pipeline & deals            | `pipelines`                                | Yes — most common reason to adopt a CRM                               |
| Message templates & quick replies | `templates`, quick-replies                 | Yes — needed the first time anyone replies twice                      |
| Broadcast campaigns               | `broadcasts`                               | No                                                                    |
| Automations & flows               | `flows`                                    | No                                                                    |
| AI assistant & auto-reply         | `assistant`, `agents`                      | No — BYO-key feature; suggesting it before a key exists is a dead end |
| Support tickets & help desk       | `support`                                  | No                                                                    |
| Appointments & scheduling         | `appointments`                             | No                                                                    |
| Product catalog & quotes          | `catalog`                                  | No                                                                    |
| Team chat & presence              | `team-chat`, `presence`                    | No                                                                    |
| Developer & integrations          | `webhooks`, `api-keys`, `external-sources` | No                                                                    |

"Suggested" means **pre-checked in the picker, clearly labeled "Suggested",
and freely uncheckable** — a recommendation the user can see and reject, never
a decision made for them.

### D2 — Storage: one `enabled_features` set on the account

Add a single migration: `enabled_features text[] NOT NULL DEFAULT '{}'` on
`accounts` (plus a `feature_enablement_events` audit table recording who
toggled what, when). No `vertical` column, no pack tables, no resolver
service — the rejected draft's machinery stays rejected. Reads go through one
helper: `getEnabledFeatures(accountId)`; writes go through one RPC that
re-checks the caller is owner/admin server-side (the UI is never the boundary,
per `AGENTS.md`).

`account_id`-scoped as always, so V2 multi-account needs no migration.

### D3 — Enforcement at three layers, hiding at one

A disabled feature is:

1. **Hidden from navigation** — `NAV_GROUPS` items gain an optional
   `feature` key checked against `enabled_features` in the same server pass
   that already checks `permission`.
2. **Absent from Mira** — the tool catalog filters by enabled features before
   registration. An out-of-scope tool must not exist in the model's context at
   all (a tool that refuses at call time still advertises the capability to a
   prompt injector).
3. **Refused at the API** — feature-owned route handlers return 404 for
   disabled features. 404, not 403: "this workspace doesn't have that" is not
   a permissions conversation.

**Data is never touched.** Disabling hides; re-enabling restores everything
exactly as it was. A workspace that turns appointments off for a quarter and
back on finds its appointments intact.

### D4 — Unwanted features stay visible in exactly one place: Settings → Features

The decision the user confirmed: hidden from nav entirely, **but always listed
in Settings**. A new Settings → Features page shows the full catalog in two
sections:

- **On** — enabled features, each with a short description and a "Turn off"
  action (owner/admin only).
- **Off — turn on any time** — every disabled feature, same plain-language
  description, one-click enable. Nothing is secret; the user always knows the
  product can do more, and where that door is.

This is the "add or subtract as your needs evolve" half of the Salesforce
guidance, and it is what makes hiding safe: discovery has a permanent,
predictable home.

### D5 — Enablement is separate from entitlement and permissions

A plan may _entitle_ a workspace to a feature that remains _off_ because
nobody enabled it; a member may lack _permission_ to a feature that is _on_.
The three axes compose (`visible = entitled ∧ enabled ∧ permitted`) and none
substitutes for another. Quotas keep failing open; enablement fails **closed**
(unknown feature string = disabled).

## Consequences

**Positive**

- A workspace's surface area is exactly what its owner chose — the freelancer
  sees a 5-item nav, the support desk sees tickets, neither sees the other's
  tools.
- The choice is legible and reversible: one Settings page is the complete map
  of what exists, what's on, and what's off.
- Mira's prompt-injection surface shrinks to the workspace's actual scope.
- One column + one audit table; no new architecture to maintain.

**Negative / accepted costs**

- Every feature-owned route handler needs the enablement check — a broad but
  mechanical sweep, enforced by a lint/boundary check where possible.
- Deep links to disabled features 404; the Settings → Features page is the
  recovery path and support answer.
- The catalog list in D1 is a product judgment that will need periodic review
  as modules are added.

**Explicitly not doing (learned from the rejection)**

- No business-type presets, vertical packs, pack loaders, or marketplaces.
- No inference of features from industry; the user is asked (ADR-008).
- No pricing/tier coupling in this ADR — entitlement stays where it lives
  (`plans`), and pricing is out of scope entirely.

# ADR-003: Record-open UX pattern, catalog module hardening, and entity-normalization triggers

**Status:** Proposed — awaiting sign-off
**Date:** 2026-08-13
**Deciders:** Product owner (nskreddy1)
**Inputs:** UI-consistency audit + catalog audit (this session), live-DB evidence,
`docs/archive/roadmap/phase-5-enterprise-scale.md` (trigger-condition scaling),
`docs/enterprise-v1-architecture.md` §12 (vertical-before-breadth), ADR-001 house style.

---

## Context

Three audit findings need architectural decisions, not just fixes:

1. **Five record-list surfaces use four different "open a record" mechanisms.**
   Contacts and Pipelines use a title button (no focus ring), Catalog now uses a
   title button (with focus ring — added this session), Appointments is
   pencil-icon-only with an unclickable title, Broadcasts makes the whole card a
   button. Drift is *proven*, not hypothetical — Catalog shipped with a
   non-clickable card and nobody noticed until a user hit it.

2. **Catalog is structurally the weakest module.** Only feature with no `lib/`
   directory (types inline in components), zero tests — while now being the
   target of AI write tools (`create_catalog_item`, `update_catalog_item`).
   Its schema lacks SKU, image, duration, tax rate, account currency default;
   `category` is free text.

3. **`/api/v1` holds two auth regimes.** 11 routes funnel through
   `requireApiKey` (the contract documented in `docs/public-api.md`); the
   `workspace/*`, `dashboard`, `session`, `notifications`, `security/*` routes
   use cookie sessions (`getCurrentAccount`) and are documented nowhere.
   ADR-001's claim that "all 25 `/api/v1` routes funnel through
   `requireApiKey`" is no longer true.

Also examined and **explicitly deferred**: a `companies` table. Live DB holds
1 contact / 1 deal / 1 catalog item; `mappers.ts:75` already inherits
`deal.company` from the contact, so the reported display was correct behavior.
Designing dedupe/backfill against imaginary data violates the phase-5
principle: build when the trigger condition arrives.

### Scale posture (from the existing docs, applied here)

Phase-5's core claim is that the account-scoped RLS architecture reaches
large-org scale **without rewrites** — every scale item is an isolated,
additive change gated on a trigger condition. This ADR adopts the same shape:
each decision below states what to do *now* (cheap, structural) and what to do
*at trigger* (deferred, additive). Nothing here requires destructive migration,
consistent with the V1→V2 rule of keeping `account_id` scoping intact.

---

## Decision 1 — One canonical record-open pattern, enforced structurally

### Options considered

**Option A: Convention only.** Document the pattern; fix the three deviating
surfaces in place.

| Dimension | Assessment |
|---|---|
| Complexity | Low (3 small edits + doc) |
| Drift resistance | Weak — the next module can silently deviate again |
| Blast radius | Zero |

**Option B: Shared primitive.** Extract `RecordTitleButton` (~25 lines) into
`src/components/shared/`, apply it in Contacts, Pipelines, Catalog,
Appointments.

| Dimension | Assessment |
|---|---|
| Complexity | Low-medium (1 new component + 4 call sites) |
| Drift resistance | Strong — the pattern is imported, not re-typed |
| Blast radius | 4 files, all leaf UI |

### Decision: Option B

Drift already happened once with only five surfaces; Invoices and Payments are
coming (ADR-001 context), so the surface count grows. A primitive is cheaper
than the third re-fix. Rules the primitive encodes:

- The **record title** is the open affordance: a real `<button>` (or `<Link>`
  when the target is a route), `hover:text-primary hover:underline`, visible
  `focus-visible` ring, nested inside the heading element so semantics survive.
- **Whole-card-as-button is permitted only when the card contains no other
  interactive control** (Broadcasts qualifies today; Catalog never could —
  it has a nested actions menu). This variant is documented, not banned.
- Row/card **actions** live in a `DropdownMenu` behind a `MoreHorizontal`
  trigger with an `aria-label`. The Appointments pencil-icon converges to this.
- Immediate fixes bundled with adoption: missing focus rings on Contacts
  (`:819`) and Pipelines (`:1153`, `:1330`) title buttons; Appointments title
  becomes clickable.

**Non-goal:** no visual redesign. Same look users already know from Pipelines,
made uniform.

## Decision 2 — Catalog is hardened as a vertical, not decorated with fields

Per enterprise-v1-architecture §12: complete one vertical properly before
adding breadth. Catalog's breadth (schema fields) is deferred behind triggers;
its **verticals that are already load-bearing get hardened now**.

### Now (load-bearing, cheap)

1. **`src/features/catalog/lib/`** — extract inline types + data access from
   the components into `lib/types.ts` and `lib/repository.ts`, matching every
   other feature module. Pure motion, no behavior change.
2. **Tests.** Catalog has zero while being writable by AI tools with
   user-approval gating. Minimum bar: repository account-scoping tests +
   record-sheet open/edit state test — the exact class of bug just fixed.
3. **Bulk actions UI.** The API already accepts `DELETE {ids:[...]}`; the UI
   exposes no multi-select. Wire the existing Contacts selection pattern to the
   existing endpoint. Backend is ahead of frontend; this closes the gap with
   zero new API surface.

### At trigger (additive, phase-5 style)

| # | Item | Trigger condition | Change |
|---|---|---|---|
| 1 | `sku` column | First request to reconcile with an external system (import/export/accounting) | Nullable text column + unique-per-account partial index. |
| 2 | `image_url` | First workspace that sells visually (products vs services) | Nullable column; storage via existing Supabase storage patterns. |
| 3 | `duration_minutes` | First appointment double-booked because slot length was unknowable | Nullable int; appointment form reads it as default slot length. |
| 4 | `tax_rate` | First workspace that must show tax-inclusive prices (₹ pricing suggests GST will arrive) | Nullable numeric + `price_includes_tax` boolean. |
| 5 | Account currency default | First workspace with items in mixed currencies by accident | `accounts.default_currency`; catalog form pre-fills; no constraint on existing rows. |
| 6 | Category normalization | First workspace where the category filter shows case-duplicates | See Decision 4 — same mechanism as companies. |

Each is one nullable column + UI field: no backfill, no breaking change,
consistent with the additive-only rule for `/api/v1` payloads.

## Decision 3 — `/api/v1` namespace: document the split now, relocate at trigger

### Options considered

**Option A: Document.** Amend `docs/public-api.md` and `AGENTS.md`: the public
contract is *exactly* the `requireApiKey` routes; cookie-session routes under
`/api/v1` (`workspace/*`, `dashboard`, `session`, `notifications`,
`security/*`) are internal BFF surface, exempt from the stability contract but
held to additive-only changes as a courtesy to the mobile/SPA callers.

**Option B: Relocate.** Move cookie-session routes to `/api/internal/*`.
Honest namespace, but touches 8+ route directories and every internal fetcher,
for zero user-visible benefit today — and `/api/v1/workspace/*` URLs may
already be baked into deployed clients.

### Decision: Option A now; Option B's trigger is *the first external API
consumer confused by an undocumented `/api/v1` route, or the first breaking
change needed on an internal route.* Until then, relocation is churn.

Also correct ADR-001's now-false "all 25 routes funnel through `requireApiKey`"
claim by annotating it with a pointer to this ADR (ADRs are immutable; the
annotation is a superseding note, not an edit of history).

## Decision 4 — Entity normalization (companies, categories): defer with a named escape hatch

**Full `companies` table: rejected for now.** Trigger condition, phase-5
style: *an account accumulates enough contacts that "all deals at company X"
or company-level dedupe is asked for* (realistically hundreds of contacts).
The full build is a migration + backfill + FK on contacts *and* deals + company
UI + import dedupe + AI-context changes — a subsystem, and its dedupe rules
can only be designed well against real company strings.

**Escape hatch available any time (non-destructive, one small migration):**

```sql
ALTER TABLE contacts ADD COLUMN company_norm TEXT
  GENERATED ALWAYS AS (lower(btrim(company))) STORED;
CREATE INDEX idx_contacts_company_norm
  ON contacts (account_id, company_norm) WHERE company_norm IS NOT NULL;
```

This yields "all deals at X" grouping and duplicate detection with no new
table, no FK, no UI change — and if the full `companies` table is built later,
`company_norm` becomes the backfill join key, so the escape hatch is *on the
path* to the full solution, not a detour. The identical mechanism applies to
`catalog_items.category` when its trigger (Decision 2 #6) fires.

`deals.company` stays as-is: the mapper's contact-inheritance fallback is
correct behavior, verified against the live DB this session.

---

## Trade-off analysis

The single recurring trade-off is **structural enforcement now vs churn
avoidance**. The line drawn: enforce structurally where drift has *already
been observed* (record-open pattern → primitive; catalog layout → `lib/`;
AI-writable module → tests), and defer everything whose justification relies
on data that does not exist yet (schema breadth, companies, relocation).
This is the same line phase-5 draws, applied at module scale.

## Consequences

- **Easier:** adding module #12 with a correct record UX (import the
  primitive); reasoning about what is public API (one sentence rule); adding
  catalog fields later (all nullable, no backfill).
- **Harder:** nothing today. The deferred items each cost one migration when
  their trigger fires.
- **Revisit:** this ADR when Invoices/Payments modules land (they will stress
  both the record-open primitive and the catalog schema), and when ADR-001's
  module-enablement work begins (nav registry and this primitive should not
  drift apart).

## Action items (in order)

1. [ ] `RecordTitleButton` primitive + adopt in Contacts, Pipelines, Catalog, Appointments (incl. focus-ring fixes)
2. [ ] `src/features/catalog/lib/` extraction (types + repository)
3. [ ] Catalog tests: repository account-scoping + record-sheet open/edit
4. [ ] Catalog bulk-select UI wired to existing bulk DELETE
5. [ ] `docs/public-api.md` + `AGENTS.md`: document the two-regime rule; annotate ADR-001
6. [ ] (parked, triggers named) schema breadth, companies/category normalization, route relocation

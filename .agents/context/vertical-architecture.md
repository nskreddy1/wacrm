# Multi-Vertical Architecture — one platform, many industries

> How a single codebase serves sales teams, WhatsApp-auto-reply shops, real
> estate, healthcare, ecommerce, and future verticals — without forking.
> Companion to `research-2026-07.md` and `../TODO.md`.

---

## 1. The principle: horizontal core + vertical packs

We ship **ONE product**, never a per-industry fork. Structure:

- **Horizontal core (~80% shared):** contacts, inbox, pipeline, broadcasts,
  templates, flows, invoices, projects, client portal, dashboards, auth/RBAC.
  Every client runs this exact engine.
- **Vertical Packs (~20%, pure config/data):** a bundle applied at onboarding
  that adapts the core to an industry. NO new code per vertical.

Adding a new vertical later = author a new pack (seed/JSON) + optional flag.
Zero changes to the core.

### Why not fork per vertical
Three codebases = 3x bugs, no leverage, divergent features. Config-driven packs
keep one engine and let non-engineers add verticals.

---

## 2. What a Vertical Pack contains

A pack is data, not code. Applied when the workspace picks its industry.

| Pack layer | Varies per vertical | Existing primitive to reuse |
|---|---|---|
| Custom fields | RE: property type, budget, locality. Clinic: patient age, treatment. Ecom: order value, SKU | `module_field_settings` (exists — generalize beyond appointments/catalog) |
| Pipeline stages | RE: Enquiry→Site visit→Negotiation→Token→Registration. Ecom: Cart→Abandoned→Recovered→Repeat | `pipelines` (already stage-configurable) |
| Templates | Vertical WhatsApp templates (RE listing blast, clinic reminder, cart recovery) | `templates` (dynamic, Twilio/Meta) |
| Automation flows | Vertical auto-replies + journeys | `flows` |
| Terminology map | "Lead" vs "Patient" vs "Buyer" vs "Shopper" | new: label map in pack |
| Dashboard widgets | RE: site-visits; Ecom: cart-recovery rate; Clinic: no-show rate | `dashboards` |
| Enabled modules | which features are on for this workspace | new: module-enablement flags |
| Compliance profile | security tier (see §4) | new: `compliance_profile` |

---

## 3. Feature scope = flags, not different apps

Different client needs map to **enabled-module sets**, one binary:

- **WhatsApp-only auto-reply shop** → inbox + templates + flows ON; invoices /
  projects / portal OFF. Sees a lean messaging app.
- **Sales team** → pipeline + lead capture + broadcasts emphasized.
- **Agency (Clienter parity)** → everything ON.

Driven by plan tier AND vertical pack. Same codebase renders the right surface.

---

## 4. Security & compliance is a SEPARATE axis from vertical

"Healthcare needs to be unhackable" is NOT a vertical feature — it's a
**compliance tier** any workspace can be on. Orthogonal to the pack: a
real-estate KYC client and a clinic can both be Elevated.

### Baseline (every workspace, already mostly in place)
- Supabase RLS multi-tenant isolation.
- Encryption at rest; per-workspace encrypted channel credentials.
- Tenant audit events; RBAC.

### Elevated (healthcare / finance / KYC-heavy)
Driven by a `compliance_profile` column → enforced in middleware + policies:
- Field-level PII encryption + redaction in logs.
- Stricter data retention + right-to-delete / consent capture.
- Access logging on every PII read (not just writes).
- Forced 2FA, optional IP allowlist.
- Data residency (India region) where required.
- BAA-style handling / DPA posture.

This is one column + a policy layer, decoupled from which pack is loaded.

---

## 5. Data model additions (foundational — do before Phase 1 verticalizes)

On the workspace/account:
- `vertical` (enum/text) — which pack is active.
- `compliance_profile` (enum: baseline | elevated) — security tier.
- `enabled_modules` (jsonb) — feature-enablement set.

New tables:
- `vertical_packs` — pack definitions (fields, stages, templates refs, labels,
  widgets, default enabled modules). Seedable.
- Generalize `module_field_settings` to any entity (not just appointments/catalog).

---

## 6. Onboarding flow (the "all-in-one" experience)

1. Sign up → pick **industry** (Sales / Real estate / Healthcare / Ecommerce /
   Agency / Other) → pick **plan**.
2. App applies the matching Vertical Pack: seeds fields, stages, starter
   templates + flows, relabels terminology, enables the right modules, sets the
   compliance profile default (Healthcare → Elevated).
3. Client lands in a workspace that already "speaks their language" — first
   value in minutes (matches Clienter's onboarding bar).

---

## 7. Build order (folds into `../TODO.md`) — REVISED after review

**Key revision from the 2026-07 three-lens review (§8–§10): do NOT design the
pack abstraction upfront and hope it fits.** Extract it from one working
vertical instead:

1. **Ship Phase 1 revenue features (invoices → projects → portal) for ONE
   hand-picked design-partner vertical first** — hardcoded where necessary.
   Learn where the config seams actually are.
2. Add `vertical`, `compliance_profile`, `enabled_modules` columns + RLS
   (cheap, non-blocking — do alongside step 1).
3. **Extract** the Vertical Pack loader from the working example; generalize
   `module_field_settings` into a custom-object/field engine only where the
   partner actually hit its limits.
4. Seed the 2nd pack (most distinct vertical from the first) + onboarding
   industry picker. Validate with a 2nd design partner.
5. Compliance-profile middleware (baseline vs elevated) + access logging —
   scoped by the honest compliance program in §9, not just a column.

---

## 8. Falsifiable gates (added from `/what am I missing` review)

These keep the 80/20 claim honest. Breaking a gate = stop and rethink.

- **G1 — No third vertical** until 2 paying design partners in 2 different
  verticals have run **60 days without us writing vertical-specific code.**
- **G2 — No pack marketplace/SDK work** until 5 packs exist and at least 1 was
  authored end-to-end by a non-founder without code review escalations.
- **G3 — No "Elevated" compliance tier is SOLD** until the §9 vendor-chain
  audit is complete. Half-promised security is worse than none.
- **G4 — Abstraction escape-hatch rule:** the moment a vertical needs true
  custom *logic* (not fields/stages/labels), it becomes a flagged core module,
  never a fork and never pack-embedded code.

### Config test-matrix strategy
The config space is combinatorial: `vertical` × `compliance_profile` ×
`enabled_modules`. Untested combinations are where "only happens for Elevated
real-estate workspaces with module X off" bugs live. Policy:
- Maintain a **canonical matrix fixture** (one seeded test workspace per
  supported combination — start with 4: default/baseline, default/elevated,
  vertical-A/baseline, vertical-A/elevated).
- Every new module ships with a smoke test run against ALL matrix fixtures.
- Unsupported combinations are **rejected at write time** (DB constraint), not
  discovered at render time.

### Vertical migration story
Clients outgrow packs (Sales shop → Agency). Rules:
- Pack switch is **additive-only by default**: new fields/stages/labels are
  added, existing data and stages are never deleted or renamed silently.
- Terminology remaps instantly (it's a label map, data is untouched).
- Removed-module data is retained and hidden, never dropped — re-enabling the
  module restores it.
- Every migration writes a tenant audit event with a before/after snapshot.

---

## 9. Compliance is a PROGRAM, not a column (honest scope)

The §4 tiers stand, but "Elevated" is only sellable after:
- **Vendor-chain audit:** Twilio and Supabase plan tiers must themselves
  support the promises we make (BAA availability, India data residency,
  encryption guarantees). We cannot be more compliant than our vendors.
- **DPDP Act mechanics:** consent capture, purpose limitation, breach
  notification workflow, right-to-erasure that actually cascades (messages,
  media, logs, backups).
- **Auditability:** access logs that survive legal discovery; retention
  policies enforced by jobs, not by promise.
- Until all three exist, healthcare/finance prospects get **Baseline + honest
  roadmap**, not "Elevated".

---

## 10. 10x upgrades (from the `/10x` review — candidate pull-forwards)

Ordered by leverage; none are gated on the others:

1. **AI-generated packs (STRONG pull-forward candidate — AI SDK already
   wired).** Onboarding asks "describe your business" ("I run a dental clinic
   in Pune") → LLM generates the starter pack: fields, stages, 5 WhatsApp
   templates in the right compliance category, auto-reply flows, dashboard —
   human approves before apply. Collapses time-to-value to ~90 seconds and
   makes the long tail of verticals free. Supersedes hand-authoring packs
   beyond the first two.
2. **Conversation intelligence re-pointed by pack.** One "Rios"-style engine
   scoring chats against the active pack's goals (RE: site-visit intent;
   clinic: no-show risk; ecom: cart intent). Structural moat: incumbents own
   either messaging OR vertical config, never both.
3. **Compliance-as-a-product.** Once §9 is real, "CRM for Healthcare —
   DPDP-ready, audit-logged" is a certified SKU at 3–5x price, not a tier.
4. **Pack SDK + marketplace (LAST — gated by G2).** Agencies author and sell
   packs to their niche; we take a cut. Flips us from CRM vendor to the
   platform vertical CRMs are built on. Do not start before G2 passes.

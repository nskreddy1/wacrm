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

## 7. Build order (folds into `../TODO.md`)

This is a **Phase 0.5 foundation** BEFORE we verticalize Phase 1 revenue
features, so invoices/projects/portal are pack-aware from day one:
1. Add `vertical`, `compliance_profile`, `enabled_modules` to workspace + RLS.
2. Generalize `module_field_settings` into a reusable custom-object/field engine.
3. Vertical Pack loader + seed 2 packs to validate the abstraction
   (Real estate + Ecommerce — most distinct from current agency default).
4. Compliance-profile middleware (baseline vs elevated) + access logging.
5. Onboarding industry/plan picker that applies a pack.

Validation gate (per `research-2026-07.md` §4): prove the pack abstraction with
2 real design-partner verticals before authoring the long tail.

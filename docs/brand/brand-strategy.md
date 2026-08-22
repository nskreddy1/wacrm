# Company brand strategy — name, positioning, architecture

- **Status:** **Finalized (provisional)** — founder selected **Auxelon** on 2026-08-22 as the working company brand. Founder note: "not fully satisfied — keep Auxelon temporarily." All new repos, infra, and internal naming use **Auxelon** from now on; a rename before public launch remains possible but requires a follow-up ADR because repo names, org handles, and infra identifiers will already carry the name.
- **Decided name:** **Auxelon** (AUX-eh-lon) — see §3 Tier 1 rationale. Logo and visual identity: `docs/brand/assets/` (see §8).
- **Date:** 2026-08-22
- **Scope:** the parent **company** brand. The product currently known as "wacrm" becomes one product line under it (§5).

---

## 1. What the company is (from founder brief)

Not "a WhatsApp CRM." The company is an **AI-native services and products firm**:

1. **Client services** — building custom products for clients.
2. **AI workflows & automations** — designing and operating AI-driven business automation for companies that can't integrate AI themselves.
3. **AI integration consulting** — bringing AI into companies' existing systems.
4. **Own products, sold as subscriptions** — starting with the AI sales CRM (wacrm), more to follow.

Positioning in one line: **"We build the AI operating layer for businesses — theirs, or ours."**

- **Mission:** make every business AI-operable, regardless of its size or technical depth.
- **Category:** AI product & automation studio (services fund the runway; subscription products build the asset).
- **Audience:** SMBs and mid-market companies (initially India + global English-speaking markets) that want AI outcomes without an AI team.

---

## 2. Naming principles (2026 premium standard)

Research-validated conventions for how top-tier tech brands name today:

- **Short, coined, pronounceable** — 2–3 syllables, spellable after hearing it once (the Vercel/Replit pattern). Compound descriptive names ("SyncAI", "DataFlow") read as dated and are legally weak.
- **Fanciful marks win trademarks** — an invented word is the strongest, cheapest trademark class and the most likely to have domains free.
- **Name the feeling, not the function** — the company name should not say "CRM" or "WhatsApp"; products carry the descriptive weight (§5).
- **Works as a suffix-free brand** — no "Labs", "AI", "Tech" crutch needed (though "X Labs" can be the legal entity name).
- Founder constraint: `axon.com` is taken (Axon Enterprise, NASDAQ: AXON — also a trademark risk for anything too close to "Axon"). Acceptable TLDs: **.com preferred, .in (home market), and low-cost developer TLDs like .dev as fallback**.

---

## 3. Name shortlist

All candidates below were **screened via web research in Aug 2026 and showed no established software/tech company conflicts at screening time**. This is a screening, not a clearance: before committing, the founder MUST (a) check exact-domain availability at a registrar, (b) run trademark searches (India IP Office class 9/42 + USPTO/WIPO), and (c) check social handles.

### Tier 1 — recommended

| Name | Say it | Why it works | Suggested domains |
| --- | --- | --- | --- |
| **Auxelon** | AUX-eh-lon | From *aux-* (to help, to augment) — literally "the augmentation company." Carries the Axon-like technical gravity the founder liked, without the conflict. Strong, enterprise-credible, fanciful mark. | `auxelon.com`, `auxelon.in`, `auxelon.dev` |
| **Voranta** | vor-AHN-ta | Smooth, premium, global mouthfeel (the "-anta" ending reads established, like Vedanta/Atlanta). Feels like a firm, not an app — right for a services + products house. | `voranta.com`, `voranta.in` |
| **Caldrix** | KAL-driks | Compact, technical, engineered. The "-ix/-rix" ending signals systems and infrastructure. Best fit if the brand should feel deeply technical. | `caldrix.com`, `caldrix.in` |

### Tier 2 — strong alternates

| Name | Say it | Character |
| --- | --- | --- |
| **Ravonix** | ra-VON-iks | Energetic, product-forward; slightly more startup than firm |
| **Zylvane** | ZIL-vayn | Distinctive and rare (zero hits at screening); more abstract/mysterious — a "brand you grow into" |

### Screened and rejected (conflicts found)

Veyron (Bugatti TM), Auralix, Nuvex, Zentara, Kyvara, Velmora, Aurevo, Axoryn, Ondrix, Axelith, Orvyn, Orvanta, Vayronix — all have active companies or marks in software/tech. Anything containing "Axon" is off the table (Axon Enterprise).

**Recommendation: Auxelon** — it best encodes the mission (augmentation), survives enterprise scrutiny, satisfies the Axon-adjacent taste legitimately, and had the cleanest screening profile of the Tier-1 set.

---

## 4. Brand character (premium, founder-led)

The founder wants Forbes-top-100 / Musk-tier brand energy. What that actually is, distilled:

- **Extreme clarity over cleverness.** Tesla's page says "Electric cars." The site should say what we do in five words.
- **A mission bigger than the product** (SpaceX: "making life multiplanetary"). Ours: *every business, AI-operable.*
- **Restraint = premium.** One typeface family, near-monochrome palette with one accent, generous whitespace, no gradients-and-glow AI clichés.
- **Proof over adjectives.** Show shipped products, automation case numbers, uptime — never "cutting-edge", "revolutionary", "next-gen".
- **Voice:** confident, plain, technical when needed; short sentences; no exclamation marks.

---

## 5. Brand architecture (branded house)

One master brand, descriptively named products under it — the pattern that lets a small company look big:

```text
<Company>                      ← the brand people trust
├── <Company> CRM              ← today's product (wacrm): AI sales CRM — WhatsApp + email, AI auto-reply, pipelines
├── <Company> Flows            ← AI workflows & automation service/platform
├── <Company> Studio           ← client product-building services arm
└── (future products)          ← each launches with the master brand's trust, at zero naming cost
```

- Products get **descriptive names** (CRM, Flows, Studio) — the invented word is spent once, on the company.
- The legal entity can be `<Company> Technologies Pvt. Ltd.` (India) while the brand stays the bare word.
- "wacrm" remains an internal/repo codename until rename; a customer-facing rename of the app (login, titles, emails, `messages/` catalogs) is a separate, later task.

---

## 6. Execution checklist (founder actions, in order)

1. Pick the name (recommend Auxelon; sleep on it 48 hours).
2. Verify + register domains same day: `.com` (even if premium-priced, try), `.in`, `.dev`; also grab common misspellings if cheap.
3. Trademark search then filing: India classes 9 & 42 first; US/WIPO when revenue justifies.
4. Register handles: X/Twitter, LinkedIn company page, GitHub org, YouTube.
5. Incorporate / rename entity as `<Name> Technologies Pvt. Ltd.` (or keep current entity, trade as the brand).
6. Then (separate deliverables, on request): visual identity (logo, palette, type), company landing page, in-app rebrand of the CRM.

---

## 7. Out of scope of this doc

Landing page and renaming inside the app — deferred. The logo and core visual identity are now delivered (§8); the in-app rebrand of the CRM (login, titles, emails, `messages/` catalogs) remains a separate, later task.

---

## 8. Visual identity v1 (finalized with the name)

Premium, restrained, per §4 — one typeface family, near-monochrome plus one accent.

- **Logo:** abstract "augmentation" monogram — an upward-forking node mark derived from the "A/X" of Auxelon, rendered as a single continuous stroke. Files in `docs/brand/assets/`:
  - `auxelon-logo-mark.png` — the standalone mark (dark background master)
  - `auxelon-logo-lockup.png` — mark + "AUXELON" wordmark, horizontal lockup
- **Palette (3 colors, per premium restraint):**
  - Ink `#0A0A0B` (near-black, primary surface)
  - Bone `#F5F4F2` (off-white, text on dark / light surface)
  - Signal `#3E6FF4` (electric cobalt accent — used only for the mark's fork node and interactive emphasis)
- **Typography:** Geist (sans) for everything; wordmark set in Geist Medium, letter-spaced +8%. No second family.
- **Usage rules:** never place the mark on gradients; never recolor the accent; minimum clear space = height of the mark's fork node; no taglines welded to the lockup.
- **Repo naming (effective now):** GitHub org/user `nskreddy1` hosts `auxelon-app` (the product) and `auxelon-infra` (deployment/ops). The legacy `wacrm` repo is the reference/archive codebase.

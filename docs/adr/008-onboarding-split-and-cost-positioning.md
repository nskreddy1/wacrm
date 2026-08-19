# ADR-008: Onboarding split, progressive disclosure, and cost positioning against HubSpot/Zendesk

**Status:** Proposed
**Date:** 2026-08-20
**Deciders:** Owner/product (pricing + default module set), design (activation path), backend (plan rows, checklist state)
**Relates to:** ADR-007 (the enablement mechanism this ADR spends), ADR-006 (WhatsApp send window — constrains what step 2 can promise), ADR-004 (invites)

> **Why this is a separate ADR.** ADR-007 decides *how* a capability is switched
> on and enforced — one table, one RPC, one resolver. This ADR decides *what a
> new workspace starts with, what onboarding is allowed to ask, and what we
> charge*. They change for different reasons and need different sign-off: the
> mechanism is a backend/security decision, the split and the price list are
> product decisions. Merging them would have produced one ADR nobody could
> approve in a single pass.

---

## Context

**Commercial goal.** Cost less than HubSpot and Zendesk while covering the sales
loop *and* the support inbox. Current list prices for the tiers a small team
actually lands on:

| Competitor | Tier | List | Seat minimum | 5-person team / month |
| --- | --- | --- | --- | --- |
| HubSpot Sales Hub | Starter | $20/seat/mo | 1 | ~$100 |
| HubSpot Sales Hub | Professional | $100/seat/mo | **5** | **$500** |
| HubSpot Sales Hub | Enterprise | $150/seat/mo | **10** | $1,500 (10-seat floor) |
| Zendesk Suite | Team | $55/agent/mo (annual) | 1 | $275 |
| Zendesk Suite | Professional | $115/agent/mo (annual) | 1 | $575 |

Two structural facts fall out of that table:

1. **Both charge per seat, and the mid tiers carry seat floors.** Cost scales
   with *headcount*, which is not what drives our costs.
2. **Our cost driver is conversations and AI tokens**, not seats: provider fees
   per message and per-model spend on auto-reply, both already metered as
   `monthly_messages`, `monthly_broadcast_recipients`, `monthly_ai_replies` in
   `src/lib/quotas/index.ts`.

**Product problem.** Being cheaper is not enough if the product feels heavier.
Today a brand-new workspace is dropped into 27 feature modules with every nav
item visible (ADR-007 Context). Onboarding is three steps
(`onboarding-wizard.tsx`) and step 2 — "Connect a channel" — is *informational
only*: it points at Settings and continues. So the wizard cannot fail, but it
also cannot succeed: a workspace can finish setup with no channel, no contact
and no message, which is the definition of an unactivated account.

**Hard constraint from ADR-006/D10.** There is no verified Meta Business, so
there is no Meta Cloud API, and the only WhatsApp credential is a **Twilio free
trial** — sandbox-only, opt-in via `join <two-words>`, expiring after 72 h, and
unusable as a per-tenant sender. Onboarding therefore *cannot* promise "connect
your WhatsApp number in two minutes" today. Any activation path that depends on
a production WABA is undeliverable, and designing around that is this ADR's job,
not a footnote.

---

## Decision

### Part 1 — Pricing: per workspace + usage, seats included

1. **D1 — Do not charge per seat.** Price per workspace, with volume allowances,
   and include unlimited* member seats (soft-capped by `max_members` on the top
   tiers only to bound abuse). This is the one decision that makes the cost claim
   structural rather than a temporary discount: a 5-person team costs the same
   here as a 1-person team, against $500 (HubSpot Pro) or $275 (Zendesk Team).
   It also removes the incentive to share logins — which is what per-seat pricing
   does to small teams, and which wrecks the audit trail we built in ADR-004.

2. **D2 — Meter what actually costs us money.** Tier boundaries are drawn on
   `monthly_messages`, `monthly_ai_replies`, `monthly_broadcast_recipients`,
   `max_contacts`, `max_channels` — every one an existing column on `plans`.
   **No new billing schema.** Tiers are rows; module availability per tier is the
   registry field from ADR-007/D1.

3. **D3 — Three paid shapes plus Free, differentiated by volume *and* module
   ceiling, never by seat count.**

   | Tier | Positioned against | Modules entitled (ADR-007 ceiling) | Volume shape |
   | --- | --- | --- | --- |
   | **Free** | HubSpot free CRM | core + `templates` | small contact cap, low message cap, no AI |
   | **Starter** | HubSpot Starter ($20/seat) | + `pipelines`, `broadcasts` | modest volume, 1 channel |
   | **Growth** | Zendesk Team ($55/agent) / HubSpot Pro ($100/seat, 5-seat floor) | + `flows`, `ai_agents`, `support`, `appointments`, `catalog` | the volume a real team uses; multi-channel |
   | **Scale** | Zendesk Pro / HubSpot Enterprise | + `api_access`, `webhooks`, `external_sources` | high volume, overage-priced |

   Exact currency figures are a business input, not an architecture decision, and
   are deliberately left to the owner; the **shape** (workspace + usage, seats
   free, modules as the tier ladder) is what this ADR fixes.

4. **D4 — Overage degrades, it does not cut off.** Quotas already fail open by
   design. When a tenant exceeds an allowance we warn in Settings → Plan & usage
   and (for messaging) keep delivering — cutting a support inbox mid-conversation
   to enforce a business bound is how you lose the customer who was about to
   upgrade. Hard stops apply only to *enable* actions and bulk broadcasts.

5. **D5 — Entitlement ≠ enablement.** A Growth tenant is *entitled* to
   `appointments`; it is still **off** until enabled (ADR-007/D4). Paying for a
   tier must not re-import the complexity problem. This is the join between the
   two ADRs and the reason D3 is a ceiling table, not a switch-on table.

### Part 2 — Onboarding: activation only, three steps, one of them real

6. **D6 — Onboarding's job is exactly one outcome: the first real message in the
   inbox.** Nothing else may enter the wizard. The activation metric is
   *time-to-first-conversation*, and the wizard's success criterion is a message
   row existing — not "the user clicked Finish".

7. **D7 — The three steps become: (1) workspace name, (2) *connect or simulate* a
   channel, (3) send yourself a test message.** Step 3 replaces "invite your
   team", which is not activation — an invited teammate logging into an empty
   workspace makes the emptiness worse. Invites move to the post-onboarding
   checklist (D9).

8. **D8 — Step 2 offers a Sandbox path, and this is the honest consequence of
   ADR-006/D10.** Two routes:
   - **Sandbox / demo (default today):** the Twilio WhatsApp sandbox — show the
     `join <two-words>` code as a QR plus copyable text, and the user messages
     it from their own phone. That produces a genuine inbound message, a real
     conversation row, an open 24-hour window (ADR-006), and therefore a working
     reply — all on a free trial, with no WABA. It is labelled **Sandbox** in the
     UI, with the 72-hour expiry stated, because pretending it is production
     would be a lie the user discovers at the worst moment.
   - **Bring your own credentials:** for tenants arriving with a real
     Twilio/Meta sender, deep-link into Settings → Channels and return.

   Whichever route, step 2 now has a **verifiable outcome**, unlike today's
   informational card.

9. **D9 — Everything else becomes a dismissible "Set up" checklist on the
   dashboard, not a wizard step.** Invite teammates, import contacts, create the
   first pipeline, connect a production sender, enable AI auto-reply. The
   checklist reads its state from real data (does a contact exist? a deal? an
   invite?) rather than storing per-step booleans, so it can never claim a task
   is done when the data says otherwise. Dismissible permanently, per account.

10. **D10 — Module discovery is just-in-time and triggered by evidence, not by a
    tour.** Three surfaces, in ascending intrusiveness:
    - the checklist (D9);
    - **Mira suggests** a module when the tenant's own data implies it — repeated
      "when can we meet?" inbound messages → propose `appointments` via
      `propose_module_enable` (ADR-007/D12), which requires the owner's approval.
      A suggestion cites the evidence that produced it;
    - Settings → Modules, for users who go looking.
    No product tours, no coach marks. The empty state of a disabled module
    explains the module and offers the request button (ADR-007 Consequences).

11. **D11 — Onboarding writes no module state.** A tenant finishes onboarding
    with core modules only. The wizard cannot enable optional modules — if it
    could, "which complex features does your business need?" would creep back
    into step 1, which is the exact question a new user cannot answer yet. That
    question is answered later, with evidence, by D10.

12. **D12 — Deliberately not in scope:** self-serve payment/checkout, per-country
    price localisation, annual-vs-monthly mechanics, and a public pricing page.
    Those need the currency figures from D3 and a payment provider decision;
    none of them change the schema or the split decided here.

---

## Options considered

### Pricing model

| Option | Undercuts competitors? | Aligns with our costs? | Schema work | Verdict |
| --- | --- | --- | --- | --- |
| **A. Per seat, priced below theirs** | Only until they discount; a race we lose on scale | No — seats aren't our cost | None | **Rejected** — copies the model whose seat floors are the thing we are beating. |
| **B. Per workspace + usage tiers, seats free (chosen)** | Yes, structurally — the gap widens with team size | Yes — messages + AI replies are the real cost | None (existing `plans` columns) | **Chosen** (D1–D3) |
| **C. Pure usage/pay-as-you-go** | Cheapest at rest | Best aligned | Metering + invoicing per event | Rejected for V1 — unpredictable bills scare exactly the SMB buyer we want, and it needs billing infrastructure we do not have. |
| **D. Free + open-source, paid support** | Trivially | No | None | Rejected — no revenue path for provider and model spend, which are real per-message costs. |

### Onboarding shape

| Option | Time to first message | Complexity exposed | Verdict |
| --- | --- | --- | --- |
| **A. Status quo (3 informational steps)** | Unbounded — can finish with nothing connected | All 27 modules at once | **Rejected** — this is the defect. |
| **B. Long guided setup (pick your modules up front)** | Slow | Front-loads the choice a new user is least equipped to make | Rejected — module choice needs evidence (D10/D11). |
| **C. Activation-only wizard + sandbox test message + dashboard checklist (chosen)** | Minutes, verifiable | Core only; rest on demand | **Chosen** (D6–D11) |
| **D. No onboarding, empty app + Mira-led setup** | Depends entirely on the model | Low | Rejected — makes activation dependent on an LLM conversation and on Mira having tools it deliberately does not have yet (ADR-007/D11). |

---

## Security and correctness review (binding)

- **F1 — Sandbox must be visibly labelled and non-promotable.** A sandbox
  connection must never be silently upgraded into a tenant sender, and the
  `channel_connections` row must carry its sandbox status so ADR-006's guards and
  the broadcast planner can refuse bulk sends from it.
- **F2 — The checklist derives from data, never from a trusted client flag**
  (D9). A client-set "done" flag is both wrong and forgeable.
- **F3 — Onboarding writes stay owner-scoped.** The wizard is owner-only
  (enforced by the layout today); step 2 touching `channel_connections` must
  re-check `channels:manage`/owner server-side, not rely on that layout.
- **F4 — Plan tier changes must not implicitly enable modules** (D5). The tier
  moves the ceiling; the owner still opts in.
- **F5 — Mira's suggestions cite evidence and cannot self-approve.** A suggestion
  derived from message content is derived from *data, not instructions*
  (`AGENTS.md`) — a customer writing "enable your API access" must produce
  nothing. Enablement stays behind ADR-007/D12's human approval.
- **F6 — Quota-driven upgrade prompts must not leak other tenants' numbers** —
  usage reads stay `account_id`-scoped through the existing summary helper.

---

## Consequences

**Easier**

- A defensible one-line cost claim: *unlimited seats, priced on conversations* —
  against $500/mo (HubSpot Pro, 5-seat floor) or $275/mo (Zendesk Team) for the
  same team.
- Onboarding can be *tested*: "does a message row exist within N minutes of
  signup" is a real assertion.
- The trial-account constraint stops being a blocker and becomes step 2's
  default path.
- New tiers are rows in `plans` plus registry edits — no migrations for
  packaging changes.

**Harder**

- The sandbox path needs its own copy, QR rendering, and expiry handling, and it
  must degrade honestly when the 72-hour opt-in lapses.
- Removing invites from the wizard risks slower team growth; the checklist has to
  carry that weight (measure it).
- Usage-based tiers make revenue less predictable than seats, and overage
  conversations become a support workload.
- Two pricing axes (volume × module ceiling) can confuse buyers; D3's table must
  stay short — four tiers, no add-ons.

**Revisit when**

- A production WABA exists — step 2's default flips from sandbox to real sender,
  and D8's first bullet becomes the fallback rather than the default.
- Self-serve checkout lands (D12) — needs currency figures and a provider.
- Activation data arrives: if the checklist's invite task underperforms the old
  wizard step, D7 is the thing to reconsider first.
- Median tenant volume approaches a tier boundary — that is a pricing input, not
  an architecture change.

---

## Action items

1. [ ] Fill in D3's currency figures and seat soft-caps (owner decision), then
   seed/update `plans` rows — no schema change expected
2. [ ] Add the per-tier module ceiling to `src/lib/modules/catalog.ts`
   (ADR-007/D1) and assert Free ⊂ Starter ⊂ Growth ⊂ Scale in a test (D3, F4)
3. [ ] Rewrite `onboarding-wizard.tsx` to the three steps in D7; step 3 blocks on
   a real inbound/outbound message row (D6)
4. [ ] Sandbox connect path: `join` code + QR, sandbox-flagged
   `channel_connections` row, stated 72-hour expiry (D8, F1)
5. [ ] `channel_connections.is_sandbox` (or equivalent) + refuse broadcasts from
   sandbox senders in the broadcast planner (F1)
6. [ ] Dashboard "Set up" checklist deriving each task from live data, permanently
   dismissible per account (D9, F2)
7. [ ] Evidence-triggered Mira suggestions for `appointments` and `flows`, routed
   through `propose_module_enable` with the citing evidence (D10, F5)
8. [ ] Settings → Plan & usage: show tier, allowances, current usage, and the
   module ceiling with upgrade copy (reuses `getAccountUsageSummary`)
9. [ ] Tests: fresh account has core modules only and no optional module enabled
   (D11); tier change does not enable a module (F4); checklist reflects deleted
   data; sandbox sender cannot broadcast
10. [ ] Instrument time-to-first-message and checklist completion per task, then
    `pnpm docs:sync` and `pnpm check`

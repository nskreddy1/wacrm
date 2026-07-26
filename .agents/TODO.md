# Master Backlog — Path to the Best All-in-One Client CRM

> Sorted, phased plan to evolve our WhatsApp-first platform into an all-in-one
> "run your whole client business" CRM that beats Clienter and the India
> WhatsApp-CRM incumbents. Read `.agents/context/research-2026-07.md` first for
> the why. Every feature must pass the validation gate in that doc (§4).
>
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
> Priority: **P0** now · **P1** next · **P2** later · **P3** differentiator
>
> Ordering note: revenue-generating Clienter-parity features come first. The
> **email block builder is intentionally scheduled last** (Phase 6) — it is
> polish, not a wedge, and depends on nothing else.

---

## Phase 0 — Stabilize the base (P0)
Foundation must be solid before we stack the business layer on top.

- [ ] **Template Studio polish** — carry the provider-lock/sync work to done;
      confirm broadcast picker only shows APPROVED templates (verified) and
      surface Meta review status changes on sync. (see `feature-template-studio.md`)
- [ ] **Usage instrumentation** — a shared event-logging helper so every new
      feature emits adoption events (validation framework depends on this).
- [ ] **Feature-flag scaffold** — gate new modules per-workspace for design
      partners / thin-slice rollouts.
- [ ] **Billing rails** — Razorpay integration (UPI/cards/net-banking), plan
      tiers (Free/Pro/Ultra) + entitlement checks. Prereq for monetizing
      everything below.

## Phase 1 — Invoices & payments (P1 — biggest draw, do first)
The #1 gap vs Clienter and the single biggest reason clients pay for a CRM.

- [ ] Schema: `invoices`, `invoice_line_items`, `payments` (tenant-scoped, RLS).
- [ ] GST-ready invoice builder — line items, tax, discounts, branded header.
- [ ] PDF export (use `in-repo-pdf` skill / server render).
- [ ] Send invoice over WhatsApp + email; record payments; outstanding view.
- [ ] Live revenue analytics on dashboard (paid vs outstanding, MRR).
- [ ] Razorpay payment links on invoices (depends on Phase 0 billing rails).
- [ ] Validate — problem interviews + design-partner test + adoption gate.

## Phase 2 — Projects & tasks (P1)
Turn a won deal into delivered work without leaving the app.

- [ ] Schema: `projects` (per contact/client, budget, deadline), `tasks`.
- [ ] Kanban board (To-do → In progress → Done), assignable to team members.
- [ ] Link projects to pipeline deals + invoices.
- [ ] 1-click **lead → client** conversion (carry contact data, no retyping).
- [ ] Validate — adoption gate before promoting past design partners.

## Phase 3 — Client portal + verified reviews (P1 — the "wow" differentiator)
Depends on Phase 1 + 2. The client-facing surface competitors leave open.

- [ ] Branded per-workspace portal (agency logo, custom subdomain/slug).
- [ ] Client view: project progress, invoice download + pay, shared files.
- [ ] E-sign contracts/proposals.
- [ ] **Verified reviews growth loop** — post-project review from the portal →
      public profile page; only real clients can post (verified trust) →
      shareable profile drives organic acquisition. Track as its own KPI.
- [ ] Validate — measure portal logins + review-submission rate.

## Phase 4 — Calendar sync (P2)
- [ ] Google Calendar 2-way sync for `appointments`.
- [ ] In-app scheduling links (client picks a slot).

## Phase 5 — AI differentiators (P3)
Where we beat both Clienter and the messaging incumbents.

- [ ] **Conversation intelligence** (Rios-style, on chat not just calls):
      score WhatsApp conversations for sentiment, script adherence, outcome;
      surface coaching insights per agent; feed scores back into pipeline.
- [ ] **AI copilot in inbox** — suggested replies, summarize thread, draft
      follow-up, auto-fill CRM fields from conversation.
- [ ] **Predictive lead scoring** from engagement signals.

## Phase 6 — Email block builder (P2 — scheduled LAST, polish not wedge)
Complete the earlier ask once the revenue core is in place.

- [ ] **Choose lib** — use maintained upstream **EmailBuilder.js**
      (`@usewaypoint/email-builder`) rather than the stale `itswadesh` fork
      (2 stars, no updates since Aug 2024). MIT, React, email-safe HTML output.
- [ ] **Clone + enterprise-ize** — vendor it into `src/features/templates/email/`,
      strip demo chrome, wire our design tokens, brand logo, and merge-variables
      ({{first_name}} etc.) into the block palette.
- [ ] **Editor UX** — drag blocks (heading/text/button/image/divider/spacer),
      live desktop+mobile preview, dark-mode-aware canvas.
- [ ] **Persistence** — store block JSON + rendered HTML on `email_templates`;
      migration for a `design_json` column.
- [ ] **Send path** — render to HTML on send; respect `email_opt_out`.
- [ ] **Validate** — design-partner test, adoption gate before promoting.

## Phase 7 — Go-to-market execution (P1, parallel track)
See `go-to-market.md` for detail; track the build-gated launch here.

- [ ] Public marketing site + pricing page (Free/Pro/Ultra, launch offers).
- [ ] Onboarding: first client set up in minutes, no credit card.
- [ ] Design-partner cohort (Indian freelancers/small agencies).
- [ ] Referral / verified-review growth loop live.
- [ ] Phase KPIs wired to instrumentation (0→10→100→1k→10k clients).

---

## Immediate next actions (start here)
1. Phase 0 → **usage instrumentation** + **feature-flag scaffold** + **Razorpay
   billing rails** (unblocks validation + monetization for everything else).
2. Phase 1 → **Invoices & payments** end to end (biggest draw, revenue-first).
3. In parallel, run **problem interviews** for Projects (Phase 2) so it's
   validated by the time invoices ship.
4. Email block builder stays **last (Phase 6)** — do not start it until the
   revenue core (Phases 1–3) is shipped.

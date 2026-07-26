# Implementation Plan — Phase 1 (Foundation Hardening + Invoices)

Status: DRAFT v1 → certified below (§9). Read alongside
`current-architecture-review.md`, `vertical-architecture.md`, `../TODO.md`.

Guiding rule from the review: **extract the vertical abstraction from ONE
working vertical — do not design it upfront.** So Phase 1 ships the first
revenue module (Invoices) for the current default (agency) workspace, on top of
the minimum foundation that keeps a money+messaging product safe at scale.

---

## 1. Scope (what ships in Phase 1)

Foundation (blocking — money/messaging cannot be trusted without it):
- **F1 Tenant-guard middleware** — one `withWorkspace()` wrapper every API
  route passes through; forbids cross-tenant access even with service-role.
- **F2 Observability** — Sentry + structured request logging + a per-tenant
  usage counter table (billing foundation).
- **F3 Durable outbox** — an `outbox` table + worker so sends/syncs are
  idempotent and retryable (prerequisite for broadcasts and for invoice
  delivery via WhatsApp/email).

Feature:
- **I1 Invoices** — GST-ready invoice from a deal/contact: line items, tax,
  totals, statuses (draft/sent/paid/overdue/void), PDF, deliver via
  WhatsApp+email, record payment, revenue rollup.
- **I2 Razorpay payment link** — attach a hosted payment link to an invoice;
  webhook marks it paid through the outbox.

Explicitly OUT of Phase 1: projects, portal, reviews, packs, marketplace,
email block builder (last), conversation intelligence.

---

## 2. Non-negotiable acceptance criteria ("certainties")

Each is binary and testable. The plan is "certified" only when every one has a
named mechanism that makes it true (see §9).

- C1 **Tenant isolation:** no API route can read/write another workspace's
  rows, even when it uses the service-role key. Proven by an automated
  cross-tenant test that must FAIL to access foreign data.
- C2 **Money integrity:** invoice totals = sum(line items) + tax, to the paisa,
  computed server-side; client-sent totals are ignored. No floating-point
  currency — integer minor units only.
- C3 **Idempotent delivery:** re-running any send/sync/webhook with the same
  idempotency key produces no duplicate side effects.
- C4 **Payment truth:** an invoice is `paid` ONLY via a verified Razorpay
  webhook signature — never via client callback or UI action.
- C5 **Auditability:** every state change (invoice status, payment, send)
  writes an append-only audit/event row with actor + workspace + before/after.
- C6 **No regressions:** existing template/broadcast flows still pass their
  smoke checks after the middleware + outbox land.
- C7 **Graceful failure:** a failed PDF render, WhatsApp send, or webhook is
  retried and surfaced; it never leaves an invoice in a half-updated state.

---

## 3. Data model (integer minor units, workspace-scoped, RLS on)

- `invoices` — id, workspace_id, contact_id, deal_id?, number (per-workspace
  sequence), status enum, currency, subtotal_minor, tax_minor, total_minor,
  notes, due_date, issued_at, created_by, timestamps.
- `invoice_line_items` — id, invoice_id, description, qty, unit_price_minor,
  tax_rate_bps (basis points), line_total_minor.
- `payments` — id, workspace_id, invoice_id, amount_minor, method,
  provider_ref (razorpay_payment_id), status, raw_payload jsonb, created_at.
- `outbox` — id, workspace_id, type, payload jsonb, idempotency_key UNIQUE,
  status (pending/processing/done/failed), attempts, next_attempt_at,
  last_error, timestamps.
- `usage_counters` — workspace_id, metric, period, count (metering).
- `audit_events` — id, workspace_id, actor_id, entity, entity_id, action,
  before jsonb, after jsonb, created_at (append-only; no update/delete policy).

All tables: RLS `USING (workspace_id = current tenant)`; invoice number via a
per-workspace sequence table to avoid gaps/races.

---

## 4. Service layer (fixes W1 — logic leaves routes/components)

Create `src/features/invoices/lib/service.ts` as the ONLY place invoice logic
lives: `createInvoice`, `recalcTotals`, `issueInvoice`, `recordPayment`,
`voidInvoice`. Routes/hooks call the service; the service writes audit + outbox
rows in the same transaction as the state change.

Shared `src/lib/tenant/with-workspace.ts` (F1) and
`src/lib/outbox/{enqueue,worker}.ts` (F3) are cross-cutting utilities the
invoice service reuses — and that broadcasts later reuse too.

---

## 5. Payment flow (satisfies C4)

1. `issueInvoice` enqueues an outbox job → creates Razorpay payment link →
   stores link on invoice.
2. Delivery job sends the link via WhatsApp (approved utility template) + email.
3. Razorpay webhook route verifies HMAC signature → enqueues a `payment.captured`
   outbox job (idempotency_key = razorpay_payment_id).
4. Worker marks invoice paid, writes payment + audit rows in one transaction.

## 6. Idempotency + retry (satisfies C3, C7)

- Every outbox row has a UNIQUE idempotency_key; enqueue is upsert-on-conflict-
  do-nothing.
- Worker uses `SELECT ... FOR UPDATE SKIP LOCKED`, exponential backoff via
  next_attempt_at, max attempts → status=failed + Sentry alert.
- Worker trigger: Vercel Cron (baseline) — swap to queue later without changing
  the enqueue contract.

## 7. UI (dark, existing design tokens)

- Invoices list under Automate nav: table (number, contact, total, status
  badge, due date), status filter, revenue summary cards.
- Invoice editor: contact/deal picker, line-item rows with live server-echoed
  totals, tax field, preview, Issue button.
- Detail drawer: PDF preview, payment status, timeline (from audit_events),
  resend action. Reuse existing shadcn table/badge/drawer patterns.

## 8. Task order (each ends in a verifiable checkpoint)

1. F1 tenant-guard + cross-tenant test (C1) → checkpoint: test red-then-green.
2. F2 Sentry + logging + usage_counters → checkpoint: error visible in Sentry.
3. F3 outbox + worker + idempotency test (C3) → checkpoint: dup-enqueue no-op.
4. I1 schema + service + totals test (C2, C5) → checkpoint: totals property test.
5. I1 UI (list/editor/detail) → checkpoint: browser-verified create→issue.
6. I2 Razorpay link + signed webhook (C4) → checkpoint: test-mode paid flow.
7. Regression sweep (C6) → checkpoint: template/broadcast smoke pass.

---

## 9. CERTIFICATION PASS v1 (self-audit against §2)

Mechanism-per-certainty check. A criterion is GREEN only if a concrete
mechanism above makes it true; otherwise it is a GAP to fix before build.

- C1 → §4 `with-workspace.ts` + §3 RLS + §8.1 test. **GREEN.**
- C2 → §3 integer minor units + §4 server-side `recalcTotals` + §8.4 property
  test. **GREEN.**
- C3 → §3 UNIQUE idempotency_key + §6 upsert-do-nothing + §8.3 test. **GREEN.**
- C4 → §5.3 HMAC verify + §5.4 webhook-only transition. **GREEN.**
- C5 → §3 audit_events append-only + §4 same-transaction writes. **GREEN.**
- C6 → §8.7 regression sweep. **PARTIAL** — no existing smoke tests today
  (W5). GAP-1.
- C7 → §6 backoff/failed status. **PARTIAL** — PDF render failure path not
  modeled as an outbox job. GAP-2.

### Gaps found → fixes folded in (v2)
- GAP-1: There are no automated smoke tests yet, so C6 has nothing to run.
  FIX: task 0 (before F1) = author minimal smoke tests for the current
  template-sync and broadcast-eligibility paths, recorded against fixtures.
  Without this, "no regressions" is unfalsifiable.
- GAP-2: PDF generation is a failure point outside the outbox.
  FIX: model PDF render as an outbox job type too (render→store→attach), so C7
  covers it under the same retry/idempotency guarantees.

### Residual risks (accepted, tracked)
- Cron worker latency (seconds-to-minutes) is fine for invoices; revisit before
  large broadcasts (needs a real queue — tracked in current-arch-review 10x #2).
- Razorpay availability requires the integration/keys; if absent, invoice still
  works minus payment link (degrade, don't block).

**v1 result:** 2 gaps → closed in v2 (task 0 smoke tests, PDF-as-outbox-job).

---

## 10. CERTIFICATION PASS v2 (adversarial — attack the "GREEN"s)

A clean v1 is a warning sign. Attacking each GREEN found 3 deeper gaps:

- **GAP-3 (breaks C1):** §3 says "RLS on all tables", but W3 in the review
  states API routes use the **service-role key, which BYPASSES RLS.** So C1
  cannot rely on RLS at all for server code — isolation rests ENTIRELY on
  every query carrying `workspace_id`. One forgotten filter = cross-tenant
  leak, and RLS won't catch it. FIX: (a) `withWorkspace()` returns a scoped
  db handle that injects `workspace_id` into every query and REFUSES queries
  without it; (b) a lint/CI check bans raw service-role queries outside the
  scoped handle; (c) the C1 test runs against the service-role path, not just
  the RLS path. RLS stays as defense-in-depth, never the primary control.

- **GAP-4 (breaks C2 "GST-ready"):** A single `tax_minor` is NOT GST-ready.
  Indian GST requires **CGST+SGST (intra-state) or IGST (inter-state)** split,
  per-line **HSN/SAC codes**, and both parties' **GSTIN**, plus place-of-
  supply logic to decide the split. FIX: line items carry `hsn_code` +
  `tax_rate_bps`; invoice carries `seller_gstin`, `buyer_gstin`,
  `place_of_supply`; totals store `cgst_minor`, `sgst_minor`, `igst_minor`
  (not one blob). `recalcTotals` picks intra vs inter-state from place-of-
  supply. Phase-1 escape hatch: if the workspace has no GSTIN, fall back to a
  simple single-tax invoice (non-GST) — but the columns exist from day one so
  we never migrate money data later.

- **GAP-5 (breaks C2 "to the paisa"):** "sum of line items" is undefined
  without a rounding rule. GST mandates rounding each tax component and the
  invoice total to the nearest rupee with a `round_off_minor` adjustment line.
  FIX: define one rule — compute per-line in minor units, round half-up per
  tax component, store an explicit `round_off_minor`; the C2 property test
  asserts `total = subtotal + cgst + sgst + igst + round_off` exactly.

### v2 result → fixes folded into v3
GAP-3/4/5 closed above. Also added: **out-of-order webhook handling** — if
`payment.captured` arrives before the link is stored, the outbox job matches on
`provider_ref` and still resolves (payment truth is the webhook, not our
ordering). C4 unaffected, hardened.

---

## 11. CERTIFICATION PASS v3 (final)

Re-attacked all criteria; no new correctness gaps. Remaining items are
scope/ops, not integrity:
- Invoice numbering race → per-workspace sequence row with `SELECT … FOR
  UPDATE` (documented in §3), covered by a concurrency test.
- Cron latency + Razorpay-optional → already tracked as residual risks.

**Certification result:** v1 (2 gaps) → v2 (3 deeper gaps) → v3 clean. Every
C1–C7 now maps to a mechanism that survives an adversarial read, including the
service-role/RLS reality (GAP-3) and real Indian GST structure (GAP-4/5). Plan
is **CERTIFIED — strongest form reached for current scope.** Re-run passes v1→v3
if scope or the service-role auth model changes.

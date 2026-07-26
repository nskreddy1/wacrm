# Phase 1: Foundation + GST Invoices + Razorpay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use in-repo-executing-plans (inline) or in-repo-subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. All schema work follows the in-repo-supabase skill (imperative migrations, RLS checklist, explicit Data API grants).

**Goal:** Ship the money layer — GST-correct invoices with Razorpay payment links, delivered over WhatsApp, built on a durable outbox — satisfying certification criteria C1–C7 in `.agents/context/impl-plan-phase1.md`.

**Architecture:** New `invoices` feature module following the existing `src/features/<name>/{components,hooks,lib}` shape. Tenancy via the EXISTING `account_id` model and `requirePermission()` context (research correction: docs said `workspace_id` — the codebase uses `account_id` everywhere; there is no separate tenant-guard to build). A generic `outbox_jobs` table drained by the existing verified cron (`/api/flows/cron`) gives durable PDF generation, WhatsApp sends, and Razorpay webhook processing.

**Tech Stack:** Next.js 16 App Router, Supabase (imperative migrations), Razorpay Payment Links API + webhooks, vitest.

## Global Constraints

- Tenancy column: `account_id UUID REFERENCES accounts(id)` — NEVER `workspace_id`.
- ALL money stored in **minor units** (`*_minor BIGINT`, paise). No floats anywhere.
- GST: per-line `hsn_code`, `tax_rate_bps`; invoice-level `cgst_minor`/`sgst_minor`/`igst_minor` + `round_off_minor`; split decided by `place_of_supply` vs seller state (intra → CGST+SGST, inter → IGST). No seller GSTIN → simple single-tax invoice (columns still populated as `tax = 0`, `simple_tax_minor` used).
- Rounding rule (C2): per-line compute in paise, round half-up per tax component, invoice total rounded to nearest rupee with explicit `round_off_minor`. Property test asserts `total = subtotal + cgst + sgst + igst + simple_tax + round_off` exactly.
- Immutability (C3): DB trigger rejects UPDATE of financial columns once `status = 'issued'`; corrections via credit-note rows (`kind = 'credit_note'`, negative amounts, links `original_invoice_id`).
- Numbering (C2): per-account sequence row locked with `SELECT ... FOR UPDATE`; format `INV-{FY}-{seq}` where FY is Indian fiscal year (Apr–Mar, e.g. `2026-27`).
- Razorpay: verify `x-razorpay-signature` HMAC over the RAW body; dedup on `x-razorpay-event-id` via unique insert; ack 200 fast, process via outbox. Payment truth = webhook, never redirect.
- New tables: explicit RLS + policies (Supabase checklist: `TO authenticated` + membership predicate, UPDATE gets USING **and** WITH CHECK) AND explicit Data API handling — server routes use service-role via `requirePermission()` context, so tables do NOT need anon/authenticated Data API grants; RLS is defense-in-depth.
- Feature flag: entire module behind `invoices` flag (env `FEATURE_INVOICES=1` + per-account enable), default OFF in production.
- Migration workflow: imperative SQL file in `supabase/migrations/` (project convention), applied via Supabase integration; use `IF NOT EXISTS` / `DROP POLICY IF EXISTS` guards like existing migrations.
- Every task: test-first where logic exists; run `npx vitest run <file>`; commit per task.

## File Structure

```
supabase/migrations/2026MMDD_invoices_and_outbox.sql   (Task 1)
src/lib/money/gst.ts + gst.test.ts                     (Task 2)  pure math, zero deps
src/features/invoices/lib/types.ts                     (Task 3)
src/features/invoices/lib/service.ts + service.test.ts (Task 3)  create/recalc/issue
src/features/invoices/lib/numbering.ts                 (Task 3)  FY + FOR UPDATE seq
src/features/invoices/lib/razorpay.ts + .test.ts       (Task 4)  client + link + verify
src/app/api/invoices/route.ts                          (Task 5)  list/create
src/app/api/invoices/[id]/route.ts                     (Task 5)  get/patch(draft)/issue
src/app/api/webhooks/razorpay/route.ts                 (Task 6)  + proxy PUBLIC_PREFIXES entry
src/lib/outbox/outbox.ts + outbox.test.ts              (Task 7)  enqueue/claim/complete
src/app/api/flows/cron/route.ts                        (Task 7)  modify: drain outbox
src/features/invoices/components/*                     (Task 8)  UI (list, editor, detail)
src/app/(dashboard)/invoices/page.tsx                  (Task 8)
```

---

### Task 1: Schema — invoices, line items, payments, sequences, outbox, webhook events

**Files:**
- Create: `supabase/migrations/20260726120000_invoices_and_outbox.sql`

**Interfaces produced:** tables `invoices`, `invoice_items`, `invoice_payments`, `invoice_sequences`, `outbox_jobs`, `razorpay_webhook_events`; trigger `invoices_freeze_issued`.

- [ ] **Step 1: Write the migration** (core DDL; follows repo guard conventions)

```sql
-- Money layer. All amounts in minor units (paise). account_id tenancy.
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice','credit_note')),
  original_invoice_id UUID REFERENCES invoices(id),
  number TEXT,                                   -- assigned at issue, immutable
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','partially_paid','paid','void')),
  currency TEXT NOT NULL DEFAULT 'INR',
  seller_gstin TEXT, buyer_gstin TEXT,
  seller_state_code TEXT, place_of_supply TEXT,  -- '29' style GST state codes
  subtotal_minor BIGINT NOT NULL DEFAULT 0,
  cgst_minor BIGINT NOT NULL DEFAULT 0,
  sgst_minor BIGINT NOT NULL DEFAULT 0,
  igst_minor BIGINT NOT NULL DEFAULT 0,
  simple_tax_minor BIGINT NOT NULL DEFAULT 0,    -- non-GST fallback
  round_off_minor BIGINT NOT NULL DEFAULT 0,
  total_minor BIGINT NOT NULL DEFAULT 0,
  amount_paid_minor BIGINT NOT NULL DEFAULT 0,
  notes TEXT, due_date DATE, issued_at TIMESTAMPTZ, paid_at TIMESTAMPTZ,
  razorpay_payment_link_id TEXT, payment_link_url TEXT,
  pdf_path TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, number)
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  hsn_code TEXT,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price_minor BIGINT NOT NULL DEFAULT 0,
  tax_rate_bps INT NOT NULL DEFAULT 0,           -- 1800 = 18%
  line_subtotal_minor BIGINT NOT NULL DEFAULT 0,
  line_tax_minor BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount_minor BIGINT NOT NULL,
  method TEXT NOT NULL DEFAULT 'razorpay' CHECK (method IN ('razorpay','manual')),
  provider_ref TEXT,                             -- razorpay payment id
  recorded_by UUID REFERENCES auth.users(id),    -- for manual entries
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider_ref)                          -- idempotent webhook recording
);
CREATE TABLE IF NOT EXISTS invoice_sequences (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fiscal_year TEXT NOT NULL,                     -- '2026-27'
  next_seq INT NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, fiscal_year)
);
CREATE TABLE IF NOT EXISTS outbox_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,                        -- 'invoice_pdf' | 'send_invoice_whatsapp' | 'razorpay_event'
  payload JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ,
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_jobs (run_after) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS razorpay_webhook_events (
  event_id TEXT PRIMARY KEY,                     -- x-razorpay-event-id
  received_at TIMESTAMPTZ DEFAULT NOW()
);
```

- [ ] **Step 2: Immutability trigger (C3) in same file**

```sql
CREATE OR REPLACE FUNCTION invoices_freeze_issued() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor OR
    NEW.cgst_minor IS DISTINCT FROM OLD.cgst_minor OR
    NEW.sgst_minor IS DISTINCT FROM OLD.sgst_minor OR
    NEW.igst_minor IS DISTINCT FROM OLD.igst_minor OR
    NEW.simple_tax_minor IS DISTINCT FROM OLD.simple_tax_minor OR
    NEW.round_off_minor IS DISTINCT FROM OLD.round_off_minor OR
    NEW.total_minor IS DISTINCT FROM OLD.total_minor OR
    NEW.number IS DISTINCT FROM OLD.number OR
    NEW.kind IS DISTINCT FROM OLD.kind
  ) THEN
    RAISE EXCEPTION 'issued invoices are immutable; create a credit note';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_invoices_freeze ON invoices;
CREATE TRIGGER trg_invoices_freeze BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_freeze_issued();
```

- [ ] **Step 3: RLS (Supabase checklist: TO authenticated + membership predicate; UPDATE gets USING and WITH CHECK)**

```sql
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE razorpay_webhook_events ENABLE ROW LEVEL SECURITY;
-- Pattern per existing is_account_member(account_id) helper used by newer tables:
DROP POLICY IF EXISTS inv_select ON invoices;
CREATE POLICY inv_select ON invoices FOR SELECT TO authenticated
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS inv_insert ON invoices;
CREATE POLICY inv_insert ON invoices FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id));
DROP POLICY IF EXISTS inv_update ON invoices;
CREATE POLICY inv_update ON invoices FOR UPDATE TO authenticated
  USING (is_account_member(account_id)) WITH CHECK (is_account_member(account_id));
-- repeat select/insert/update for invoice_items, invoice_payments;
-- invoice_sequences, outbox_jobs, razorpay_webhook_events: NO client policies
-- (service-role only; RLS enabled with no policies = deny-all to clients).
```
NOTE: verify `is_account_member` exists (`grep -l is_account_member supabase/migrations/`); if the actual helper is named differently (e.g. checks via `account_members` table), copy the predicate used by the most recent tenant table migration.

- [ ] **Step 4: Apply via Supabase integration, then verify** — run the SQL, then `SELECT` each table and attempt an UPDATE on an issued row expecting the trigger exception.
- [ ] **Step 5: Commit** `git add supabase/migrations && git commit -m "feat(invoices): money-layer schema, outbox, webhook dedup"`

---

### Task 2: GST money math (pure, test-first)

**Files:** Create `src/lib/money/gst.ts`, `src/lib/money/gst.test.ts`

**Interfaces produced:**
```ts
export type LineInput = { quantity: number; unitPriceMinor: number; taxRateBps: number };
export type GstContext = { sellerGstin?: string|null; sellerStateCode?: string|null; placeOfSupply?: string|null };
export type Totals = { subtotalMinor: number; cgstMinor: number; sgstMinor: number;
  igstMinor: number; simpleTaxMinor: number; roundOffMinor: number; totalMinor: number;
  lines: { lineSubtotalMinor: number; lineTaxMinor: number }[] };
export function computeTotals(lines: LineInput[], ctx: GstContext): Totals;
export function roundHalfUp(n: number): number;
```

- [ ] **Step 1: Write failing tests** — cases: (a) intra-state 18% splits 9/9; (b) inter-state goes full IGST; (c) no GSTIN → simple_tax; (d) rounding property `total = subtotal+cgst+sgst+igst+simple+round_off` over 500 random line sets; (e) round_off ≤ 50 paise absolute; (f) zero lines → all zeros; (g) paise-precision case: 1 unit @ ₹99.99 + 18% intra = subtotal 9999, cgst 900, sgst 900 (899.91 rounded half-up), total 11800, round_off +1.
- [ ] **Step 2: Run, verify fail.** `npx vitest run src/lib/money/gst.test.ts`
- [ ] **Step 3: Implement** — per line: `lineSubtotal = round(quantity * unitPriceMinor)`, `lineTax = round(lineSubtotal * taxRateBps / 10000)`. GST split: intra if `sellerStateCode === placeOfSupply` (both required), each component = half of summed tax rounded half-up per component. Invoice total rounded to nearest 100 paise; `round_off = roundedTotal - rawTotal`.
- [ ] **Step 4: Run, verify pass.** **Step 5: Commit.**

---

### Task 3: Invoice service + fiscal-year numbering

**Files:** Create `src/features/invoices/lib/{types,service,numbering}.ts` + `service.test.ts`

**Interfaces consumed:** `computeTotals` (Task 2); `AccountContext` from `src/features/auth/lib/account.ts` (`requirePermission` returns `{ accountId, role, supabase }`).
**Interfaces produced:**
```ts
createDraft(sb, accountId, input: DraftInput): Promise<Invoice>       // items[] recalculated server-side, NEVER trusts client totals (C2)
updateDraft(sb, accountId, id, patch): Promise<Invoice>               // rejects non-draft (service-level; trigger backs it)
issueInvoice(sb, accountId, id): Promise<Invoice>                     // assigns number, sets issued_at, enqueues pdf+link jobs
recordManualPayment(sb, accountId, id, amountMinor, userId): Promise<void>
indianFiscalYear(d: Date): string                                     // Apr 1 boundary → '2026-27'
nextInvoiceNumber(sb, accountId, d: Date): Promise<string>            // 'INV-2026-27-0001', FOR UPDATE
```

- [ ] **Step 1: tests first** — fiscal year boundaries (Mar 31 → prior FY, Apr 1 → new FY); createDraft recomputes totals ignoring client-sent totals; issue on already-issued rejects; concurrency test: 10 parallel `nextInvoiceNumber` yield 10 distinct sequential numbers (against real db via service client).
- [ ] **Step 2–5:** fail → implement → pass → commit. Numbering runs inside an RPC `next_invoice_number(p_account_id, p_fy)` (SQL function added in Task 1 file if preferred) or a transaction using `SELECT next_seq FROM invoice_sequences WHERE ... FOR UPDATE`; upsert row when missing.

---

### Task 4: Razorpay client wrapper

**Files:** Create `src/features/invoices/lib/razorpay.ts` + `razorpay.test.ts`
**Env:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (request via SystemAction when wiring; feature degrades gracefully without them — invoices work, pay-links don't).

**Interfaces produced:**
```ts
export function isRazorpayConfigured(): boolean;
export async function createPaymentLink(inv: { id: string; totalMinor: number; number: string; contactName?: string; contactPhone?: string }): Promise<{ id: string; shortUrl: string }>;
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean; // HMAC-SHA256 over RAW body, timingSafeEqual
```

- [ ] Steps: failing tests for `verifyWebhookSignature` (known-vector HMAC, tampered body fails, timing-safe) and payload shaping (`amount` = totalMinor, `reference_id` = invoice id, `notify: {sms:false}` — WE send via WhatsApp); mock `fetch` for `POST https://api.razorpay.com/v1/payment_links` with Basic auth. Implement with plain fetch (no SDK dependency; SDK's validateWebhookSignature is 10 lines of HMAC we test ourselves). Run, pass, commit.

---

### Task 5: API routes (session-scoped)

**Files:** Create `src/app/api/invoices/route.ts` (GET list w/ status filter + POST create), `src/app/api/invoices/[id]/route.ts` (GET, PATCH draft-only, POST `?action=issue|record_payment`).

**Pattern (copy exactly from repo convention):** every handler starts `const ctx = await requirePermission('invoices:manage')` — falling back to `requireRole('member')` if the permission registry doesn't cover custom slugs (check `src/features/auth/lib/permissions.ts` first and register `invoices:manage` there following how existing slugs are declared). All queries filter `.eq('account_id', ctx.accountId)` (C1 — service-role bypasses RLS, scoping is mandatory in code). 404 for cross-account ids, never 403. Feature-flag check returns 404 when `invoices` flag is off.

- [ ] Steps: route tests (vitest + direct handler invocation like existing route tests — see `src/features/auth/lib/api-context.test.ts` for the harness pattern): create→list→issue→verify number assigned; cross-account access returns 404 (C1 test); PATCH after issue → 409. Implement thin handlers delegating to Task 3 service. Run, pass, commit.

---

### Task 6: Razorpay webhook (ack-first, dedup, outbox)

**Files:** Create `src/app/api/webhooks/razorpay/route.ts`; Modify `src/proxy.ts` PUBLIC_PREFIXES (add `/api/webhooks/razorpay` with comment, same as `/api/flows/cron` precedent).

Flow (mirrors the WhatsApp webhook lessons — this is the exact architecture that already works at `/api/whatsapp/webhook`):
1. Read RAW body text FIRST (`await request.text()`), verify `x-razorpay-signature` with Task 4 helper → 401 on fail.
2. Insert `x-razorpay-event-id` into `razorpay_webhook_events`; PG 23505 duplicate → return 200 (already processed).
3. Enqueue `outbox_jobs` row `{ job_type: 'razorpay_event', idempotency_key: event_id, payload }` → return 200. NO business logic in-request.
4. Outbox handler (Task 7): on `payment_link.paid` / `payment.captured` → match invoice by `reference_id` (fallback: `razorpay_payment_link_id`), insert `invoice_payments` (UNIQUE provider_ref makes it idempotent), recompute `amount_paid_minor`, flip status to `paid`/`partially_paid`, set `paid_at` (C4). Out-of-order safe: match on provider refs, not local state.

- [ ] Steps: tests (signature reject, duplicate event-id returns 200 without second job, job enqueued with correct key) → implement → pass → commit.

---

### Task 7: Outbox worker on the existing cron

**Files:** Create `src/lib/outbox/outbox.ts` + `outbox.test.ts`; Modify `src/app/api/flows/cron/route.ts` (add `drainOutbox()` call alongside existing sweep/resume/schedule, report counts in response JSON).

**Interfaces produced:**
```ts
enqueue(sb, job: { accountId?: string; jobType: string; payload: unknown; idempotencyKey: string; runAfter?: Date }): Promise<void>; // upsert-ignore on idempotency_key
claimBatch(sb, limit = 20): Promise<Job[]>;  // UPDATE ... SET status='processing' WHERE id IN (SELECT ... WHERE status='pending' AND run_after <= now() ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED) RETURNING *
completeJob(sb, id): Promise<void>;
failJob(sb, id, err: string): Promise<void>; // attempts+1; attempts>=max → 'failed', else 'pending' with exponential run_after backoff (2^attempts minutes)
registerHandler(jobType: string, fn: (job) => Promise<void>): void;
```
Handlers registered: `razorpay_event` (Task 6 logic), `invoice_pdf` (Task 8), `send_invoice_whatsapp` (Task 8). `FOR UPDATE SKIP LOCKED` via RPC function (client library can't express it — add `claim_outbox_jobs(p_limit int)` SQL function to Task 1 migration).

- [ ] Steps: tests (claim marks processing; double-claim race returns disjoint sets; failJob backoff schedule; enqueue dedups on key) → implement → wire into cron GET → run full flows suite (must stay 133+ green) → commit.

---

### Task 8: UI + PDF + WhatsApp send

**Files:** Create `src/features/invoices/components/{invoice-list,invoice-editor,invoice-detail,payment-badge}.tsx`, `src/features/invoices/hooks/use-invoices.ts` (SWR, matching existing hooks conventions), `src/app/(dashboard)/invoices/page.tsx`; nav entry in the dashboard sidebar component (locate via `grep -r "Broadcasts" src/components src/features --include="*.tsx" -l` and add adjacent).

- Editor: line items (description, HSN, qty, unit price ₹, tax rate select 0/5/12/18/28%), live totals from a client copy of `computeTotals` (display only — server recomputes), GSTIN fields in a collapsible "GST details" section, buyer defaults from linked contact.
- Detail: status timeline, payment records, "Record manual payment" (role-gated `requireRole('member')`+ server check), "Send on WhatsApp" → enqueues `send_invoice_whatsapp` job (renders invoice summary + payment link into an approved utility template — reuse the Template Studio's existing send path in `src/features/whatsapp/lib`).
- PDF: `invoice_pdf` handler renders HTML → PDF. Use `@react-pdf/renderer` (install first) in the job handler, upload to Supabase Storage bucket `invoices` (private; signed URLs for download), store `pdf_path` (C5).
- Design: dark-mode-first per current preview; tokens only (no raw palette classes); status colors via existing badge patterns.

- [ ] Steps: install dep → build components → verify in browser with agent-browser (create draft → issue → detail shows number + payment link; screenshot to /tmp/agent-browser/) → commit.

---

### Task 9: Certification re-run + docs

- [ ] Run C1–C7 checks from `.agents/context/impl-plan-phase1.md` §9–11 (each has a named test from Tasks above; C6 = feature flag off→404; C7 = outbox drain observable in cron response).
- [ ] Full test suite green; `npx tsc --noEmit` clean.
- [ ] Write `.agents/context/feature-invoices.md` (per-feature HLD/LLD doc, following `feature-template-studio.md` format); update `.agents/TODO.md` Phase 1 items to done; note the `workspace_id → account_id` correction in `impl-plan-phase1.md`.
- [ ] Commit + summary.

## Self-Review (performed)

1. **Spec coverage:** C1 (Task 5 cross-account test + account_id scoping), C2 (Tasks 2–3: server-side recompute, GST split, rounding property, FOR UPDATE numbering), C3 (Task 1 trigger + Task 5 409), C4 (Task 6 idempotent payments), C5 (Task 8 PDF via outbox), C6 (flag in Task 5/8), C7 (Task 7 durable jobs). GAP-3/4/5 from certification v2 all addressed.
2. **Placeholder scan:** all steps carry concrete DDL/signatures/test cases; the two "check first" notes (is_account_member name, permission slug registry) are explicit verification steps, not deferred design.
3. **Type consistency:** `computeTotals`/`Totals` used in Tasks 2→3→8; `idempotency_key` naming consistent across Tasks 1/6/7; minor-unit suffix `_minor` everywhere.

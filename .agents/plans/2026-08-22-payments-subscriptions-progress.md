# Payments & Subscriptions — implementation progress log

Companion to [`2026-08-22-payments-subscriptions.md`](./2026-08-22-payments-subscriptions.md)
(ADR-009). Append-only: newest session at the bottom. Records what landed,
what deviated from the plan and why, and what is still open — so the next
session does not have to re-derive it from `git log`.

Legend: **DONE** · **PARTIAL** · **OPEN**

---

## Task status

| Task | Status | Notes |
| --- | --- | --- |
| 1 — Schema (5 tables, RLS, `accounts`/`plans` columns) | DONE | `20260822140000_subscriptions_and_payments.sql` |
| 4 — `process_payment_event` RPC | PARTIAL | claim+apply in one transaction, environment gate, ledger fence, ordering guard, manual short-circuit all present. **Task 4.1b subscription reconstruction is NOT implemented** — see OPEN-1 |
| 2 — Port + boundary test | DONE | `src/lib/ports/payment-provider.ts` |
| 3 — Pure state machine | DONE | exhaustive transition tests |
| 5 — Razorpay adapter (verify/client/adapter) | PARTIAL | implementation complete; **unit tests for `verify.ts` / `adapter.ts` are missing** — see OPEN-2 |
| 6 — Factory + Noop | PARTIAL | implementation complete; partial-config (A2/A25) tests missing |
| 7 — `POST /api/billing/checkout` | DONE | intent-first, strict body schema, rate limited |
| 8 — `GET/DELETE /api/billing/subscription` | DONE | cancel records intent only; never calls the RPC |
| 9 — `POST /api/webhooks/payments/[provider]` | DONE | route test present |
| 10 — `/api/cron/billing-reconcile` | DONE | this session |
| 11 — Settings → Plan & usage UI | OPEN | |
| 12 — Red-team suite (A1–A35) | OPEN | |
| 13 — Fail-open sweep + semgrep | OPEN | |
| 14 — Go-live gate | OPEN | blocked on 11–13 |
| 15 — Docs (`.agents/context/*`, ADR fixes) | OPEN | |

---

## Session — 2026-08-23

### Landed

1. **Typecheck breakage fixed** (pre-existing, blocked `pnpm check`).
   - `src/app/api/billing/checkout/route.ts` — the plan-ref resolver read
     `plan.provider_refs` inside a closure where TypeScript had discarded
     the null narrowing. Switched to the `activePlan` const that exists
     for exactly that reason, instead of adding a `!`.
   - `src/features/billing/lib/cancel-subscription.test.ts` — the stubbed
     `rpc()` inferred `error: null` from its happy path, so the failure
     cases could not be expressed. Gave it an explicit `RpcResult` type.

2. **Task 10 — reconciliation cron.**
   - `src/app/api/cron/billing-reconcile/route.ts` (new). Wiring only; all
     policy stays in the pure `reconcile.ts` module.
     - `authorizeCronRequest` + `cronAuthEnv()`, identical matrix to
       `/api/flows/cron`, fails closed (503) when unconfigured.
     - Payments dormant (`PAYMENTS_PROVIDER` unset or invalid
       `PAYMENTS_ENVIRONMENT`) ⇒ quiet `200 {skipped:'payments_dormant'}`.
       Deliberately NOT an alert: unlike the webhook endpoint, a cron tick
       on a dormant deployment carries no signal that money is dropping.
     - Noop-provider detection by `provider.id`, not by catching
       `PaymentsUnavailableError` — an exception is not control flow.
     - Durable cursor read/upsert on `billing_reconciliation_state`,
       keyed `(provider, environment)` (A24). Keyset pagination on `id`;
       `offset` would skip rows as statuses change under a paging run.
     - Both trust levels passed to the RPC: configured environment from
       `paymentsEnvironment()`, observed environment from the provider
       read (4.1c, A30).
     - Candidate join maps an unreadable `accounts` row to
       `billing_mode = 'manual'` — the fail-CLOSED direction, since
       `manual` means "skip". Commented against the deliberately
       fail-OPEN quota engine so nobody harmonises the two.
     - Run failure ⇒ `500` + `BILLING_RECONCILE_FAILED` alert line. A
       silently-failing safety net is the worst available outcome.
   - `src/features/billing/lib/reconcile.test.ts` (new, 36 tests): budget
     cap, cursor advance past an unreadable subscription, cursor reset on
     a completed pass, state-keyed (not date-keyed) synthetic event ids,
     grace expiry bounds including "never expire a window this tick just
     opened" and "an unparseable deadline is not expired", orphan
     classification requiring all three lookups to miss (A34).

3. **`src/middleware.ts`** — added `/api/cron/billing-reconcile` to
   `PUBLIC_PREFIXES`. Without it the proxy 307-redirects the cron to
   `/login` and reconciliation never runs; this is the exact defect a
   previous audit found on `/api/flows/cron`. Exempted as an **exact
   path**, not as an `/api/cron/` prefix, so a future route dropped into
   that folder does not inherit public reachability.

### Deviations from the plan (deliberate, need an ADR follow-up)

- **7.8 abandoned-intent sweep uses two windows, not one.** The plan says
  24 h for both open statuses. Implemented as 24 h for `created` and
  **7 days** for `provider_attached`. A `provider_attached` intent has a
  real provider object behind it and Razorpay retries a failed delivery
  for up to 24 hours, so closing it exactly at 24 h races the provider's
  own last retry — and the loser is a paying customer whose tenant can no
  longer be resolved. The sweep only moves `status`; it never deletes and
  never touches `provider_ref`.

### Open items, in priority order

- **OPEN-1 (highest — a paying customer can lose access).** Task 4.1b
  `ensure_subscription_for_event` is **not** in the deployed RPC. Today,
  when no `subscriptions` row exists the function records the money and
  returns `no_local_subscription`, with a comment that "Task 10
  reconciliation will materialise the subscription" — but `reconcileOnce`
  only iterates over `subscriptions` rows that already exist, so nothing
  ever materialises it. Net effect: attack **A22** (our process dies
  after the provider created the subscription) is currently NOT
  recovered. Fix is a new migration that reconstructs the row from the
  `checkout_intents` match inside the same transaction, under the seven
  bind conditions of 4.1b step 2b.
- **OPEN-1a.** The correlation-locator bind in the deployed RPC filters
  only on `provider` + `environment`. Conditions 6 (`status IN
  ('created','provider_attached')`) and 7 (`provider_ref` NULL-or-equal,
  never overwritten) from 4.1b step 2b are missing, which is what attack
  **A28** targets. Same migration as OPEN-1.
- **OPEN-2.** No unit tests for `razorpay/verify.ts` or
  `razorpay/adapter.ts` (Task 5.4) — that file is the entire webhook
  perimeter, so it is the least acceptable coverage gap in the module.
- **OPEN-3.** Tasks 11 (UI), 12 (A1–A35 red-team suite), 13 (fail-open
  sweep + semgrep), 15 (docs).
- **OPEN-4.** No `vercel.json`, so no cron schedule is configured for
  either `/api/flows/cron` or `/api/cron/billing-reconcile`. The
  reconciliation route exists but nothing calls it yet.

### Verification run this session

- `pnpm typecheck` — green.
- `npx vitest run src/features/billing src/app/api/webhooks src/lib/ports`
  — green (137 tests).

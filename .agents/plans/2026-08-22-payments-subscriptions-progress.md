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
| 4 — `process_payment_event` RPC | DONE | claim+apply in one transaction, environment gate, ledger fence, ordering guard, manual short-circuit, **and** 4.1b subscription reconstruction + the full 7-condition locator bind. Corrected 2026-08-25 — the previous PARTIAL was stale, see OPEN-1/OPEN-1a below |
| 2 — Port + boundary test | DONE | `src/lib/ports/payment-provider.ts` |
| 3 — Pure state machine | DONE | exhaustive transition tests |
| 5 — Razorpay adapter (verify/client/adapter) | DONE | implementation + Task 5.4 unit tests (150 tests, mutation-verified). `client.ts` still has no direct test — see OPEN-5 |
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

---

## Session — 2026-08-25

### Audit correction: OPEN-1 and OPEN-1a were ALREADY FIXED

The previous session's OPEN-1/OPEN-1a are **stale and now closed**. Both
were verified against the migration source, not inferred:

- Task 4.1b reconstruction **is** implemented in
  `20260823120000_process_payment_event_environment_gate.sql`
  (`ensure_subscription_for_event`, step 3), which supersedes
  `20260822150000_process_payment_event.sql`.
- The locator bind in that migration **does** carry condition 6
  (`status in ('created','provider_attached')`) and condition 7
  (`provider_ref is null or provider_ref = p_subscription_ref`, never
  overwritten) — the two the old note said were missing. So **A28** is
  fenced and **A22** is recovered.
- Confirmed the later `20260824130000_subscription_cancel_intent.sql`
  does **not** redefine `process_payment_event` — it only adds
  `request_subscription_cancellation` and
  `settle_subscription_cancel_request`, both `security definer`. So the
  environment-gate migration is the live definition and there is no
  regression behind it.

Lesson for future sessions: the log said "NOT implemented" while the
migration said otherwise. Re-verify OPEN items against source before
acting on them — on this module a wasted "fix" would mean a second
`CREATE OR REPLACE` racing the real one.

### Landed — Task 5.4 (closes OPEN-2)

`src/features/billing/lib/razorpay/verify.test.ts` (new) and
`adapter.test.ts` (new). 150 tests, and the gate they guard is the
unauthenticated webhook perimeter.

Signatures are **computed with `node:crypto` in the tests**, never pasted
as constants: a hardcoded digest stops testing the HMAC the moment the
base string changes, which is precisely the refactor these files exist to
catch. Coverage of note:

- **Fail-closed configuration** — an unconfigured deployment rejects even
  a delivery we signed ourselves ("no secret ⇒ skip" is the bug shape).
- **Raw-bytes base string** — a body written so `JSON.parse` →
  `JSON.stringify` provably changes the bytes, so any "parse first,
  verify later" refactor fails. Plus UTF-8 (not UTF-16) signing.
- **Parse-after-verify ordering** — unsigned malformed JSON surfaces as a
  *signature* failure, never as parser feedback to an unauthenticated
  caller.
- **Event id required, never synthesised** — including "same body,
  different headers ⇒ different ids", which fails if anyone derives the
  id from the payload and silently collapses real events into duplicates.
- **Rotation** — `previous` accepted and *flagged*; error messages
  asserted not to name which secret failed (no distinguishing oracle).
- **No replay window, deliberately** — a 2001-dated body still verifies,
  with the reasoning recorded in-test so nobody "hardens" it by throwing
  away Razorpay's 24 h of legitimate retries.
- **`provider_ref` selection (A35)** — money events key on the
  payment/refund/dispute id, lifecycle events on the subscription id, and
  two distinct renewal charges keep distinct refs.
- **Environment is configured, never observed (A30)** — a signed payload
  carrying `environment: 'live'` and a `x-razorpay-environment` header
  are both ignored.
- **Correlation is a locator, never authority (F3/A4/A29)** — non-UUIDs
  dropped *silently*; `notes` on the payment entity ignored (Razorpay
  documents it only on the subscription); a signed event naming an
  account/plan/amount/interval has none of it reach the parsed event.
- **Closed create-subscription body** — exact five-key set asserted, plus
  `quantity` pinned to 1, `customer_notify: false`, no `start_at`/`end_at`,
  and no amount ever transmitted.
- **`cancel_at_cycle_end: 1`, never `0`** — `0` revokes paid-for access.

### Mutation-verified, not just green

Green tests prove nothing about a perimeter, so each load-bearing line
was mutated and the suite re-run. All five mutations are caught:

| Mutation | Real-world effect | Tests failed |
| --- | --- | --- |
| `authenticated: 'incomplete'` → `'active'` | access granted on an unpaid mandate | 2 |
| money `provider_ref` → subscription id | every renewal looks like a duplicate; revenue dropped | 4 |
| `environment` read from payload | A30 environment gate defeated | 1 |
| hex guard removed from `digestMatches` | see below | 2 |
| `cancel_at_cycle_end: 1` → `0` | immediate revocation of paid-for access | 1 |

**The hex-guard mutation initially survived — a real coverage hole the
first draft missed.** `Buffer.from(hex,'hex')` stops decoding at the first
invalid character, so `<64 valid hex chars> + 'zz'` is 66 characters that
decode to exactly the 32 expected bytes: the length check passes and
`timingSafeEqual` returns **true**. Verified empirically before writing
the test. Both existing non-hex tests were passing for the wrong reason
(they failed the *length* check, not the hex check), so the guard was
untested. Added `rejects a VALID digest with non-hex garbage appended`
plus a property-style loop; the mutation is now caught. Not exploitable
alone — the attacker still needs a valid digest, hence the secret — but a
comparison that accepts inputs its own validator rejects is one refactor
from being reachable.

### Blocker — `pnpm check` is red on PRE-EXISTING boundary debt

`pnpm typecheck` and `pnpm lint` pass (one unrelated unused-import
warning in `broadcasts/step4-schedule-send.tsx`). `pnpm check:boundaries`
fails with **9 violations, none of them the new test files** — all are
billing files committed earlier in `c730b4b`:

```
src/app/api/billing/checkout/route.ts
src/app/api/billing/subscription/route.ts
src/app/api/cron/billing-reconcile/route.ts
src/app/api/webhooks/payments/[provider]/route.ts
src/features/billing/lib/cancel-subscription.ts   (+ .test.ts)
src/features/billing/lib/checkout-intent.ts
src/features/billing/lib/process-payment-event.ts (+ .test.ts)
```

Each imports `@supabase/*` or `@/lib/supabase` directly instead of the
`@/lib/db` facade (ADR-002 Phase 0). This is **not** caused by this
session — `git status` shows only the two new untracked test files — but
it means `pnpm check`, the gate the plan requires before Task 14, cannot
pass today. Fixing it means routing the money path's data access through
the facade, which is an architectural change to transactional code and
was deliberately NOT attempted as a drive-by inside a test task.

### Open items, in priority order

- **OPEN-A (blocks `pnpm check`, therefore Task 14).** The 9 pre-existing
  boundary violations above. Needs an explicit decision: migrate billing
  to the `@/lib/db` facade, or record an ADR-002 exemption for the
  payments module (the RPC caller arguably *is* an adapter-layer
  concern). Not a silent fix either way.
- **OPEN-3.** Tasks 11 (UI), 12 (A1–A35 red-team suite), 13 (fail-open
  sweep + semgrep), 15 (docs).
- **OPEN-4 — superseded.** Deployment target is **Cloudflare**, not
  Vercel cron, so `vercel.json` is the wrong mechanism. The schedule for
  `/api/cron/billing-reconcile` and `/api/flows/cron` must be a
  Cloudflare Worker Cron Trigger. Until it exists the reconciliation
  safety net is still dead code and A22 recovery never fires in
  production.
- **OPEN-5.** `razorpay/client.ts` has no direct test. The
  `ambiguous` flag is the field that decides retry-vs-reconcile on the
  one call that can double-charge, and it is currently only exercised
  indirectly. Worth a small suite: POST timeout ⇒ `ambiguous: true`,
  4xx ⇒ `false`, 5xx/429 on POST ⇒ `true`, GET never ambiguous, and no
  credential in any error message.
- **OPEN-6.** Task 6 partial-config (A2/A25) tests for the provider
  factory are still missing.

### Verification run this session

- `pnpm typecheck` — green.
- `pnpm lint` — green (1 pre-existing unrelated warning).
- `pnpm vitest run src/features/billing/lib/razorpay` — green, 150 tests.
- `pnpm check:boundaries` — **red**, 9 pre-existing violations (OPEN-A).

// ============================================================
// Billing data layer — client acquisition (ADR-002 §A, ARCH-005).
//
// WHY THIS FILE EXISTS
// --------------------
// ARCH-005 confines imports of the SQL adapters (`@/lib/db/admin`,
// `@/lib/db/session`) to the data layer. The money path's route
// handlers were importing them directly, which is the violation this
// module closes: `src/features/<domain>/repositories/` is a sanctioned
// data-layer path (scripts/check-architecture.mjs), so the adapter
// import lives here and the routes depend on this module instead.
//
// WHY THE CLIENT IS STILL PASSED INTO THE HELPERS
// -----------------------------------------------
// This is NOT a re-export for its own sake. The transactional helpers on
// the money path — `startCheckout()`, `requestCancellation()`,
// `processPaymentEvent()`, `logAuditEvent()` — all take an INJECTED
// client, because claim-and-apply must happen through one client inside
// one transaction. They cannot acquire their own. Something in an
// allowed directory therefore has to hand them one, and that is this
// module.
//
// THE PRIVILEGE LEVEL IS THE WHOLE POINT
// --------------------------------------
// The two accessors are named for their trust level rather than
// exported as one generic `db()`, so a call site cannot pick the wrong
// one by accident and a reviewer can see which was chosen without
// following an import. Choosing wrongly is not a style question — it is
// a tenancy failure:
//
//   - `billingAdminDb()` BYPASSES RLS. Legitimate only behind a
//     non-RLS authorization boundary (a verified webhook signature,
//     `CRON_SECRET`, or `requireRole()`), and every query through it
//     MUST filter by `account_id` in the query text.
//
//   - `billingSessionDb()` is RLS-scoped and carries `auth.uid()`.
//     The billing reads and the cancellation RPCs are authorized BY
//     THE DATABASE against account membership and owner-ness. Running
//     them through the admin client would make `auth.uid()` NULL and
//     silently turn those checks into no-ops — the strongest guarantee
//     on the money path, deleted by something that looks like a
//     cleanup.
//
// Never "simplify" one into the other.
// ============================================================

export { adminDb as billingAdminDb } from '@/lib/db/admin';
export { sessionDb as billingSessionDb, type SessionDb } from '@/lib/db/session';

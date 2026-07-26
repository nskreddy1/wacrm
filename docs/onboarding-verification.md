# Onboarding & Plans — Verification Handoff

Instructions for whoever tests this (human or AI). No code changes needed;
everything runs against the live preview.

## Happy path

1. Sign up with a fresh email → land on `/onboarding` (not the dashboard).
2. Step 1: rename workspace → Continue. Name persists (check Settings later).
3. Step 2: informational channel cards → Continue.
4. Step 3: invite a teammate (email + role) → invite appears in the sent list.
5. Finish → land on `/dashboard`. Browser Back must NOT return to the wizard.
6. Settings → Plan & usage shows Free plan with animated meters.

## Worst-case scenarios (must all hold)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Visit `/onboarding` when logged out | Redirect to `/login` |
| 2 | Visit `/onboarding` after completing it | Redirect to `/dashboard` (one-way door) |
| 3 | Invited member (non-owner) logs in on a fresh workspace | Straight to dashboard — wizard never shows for non-owners |
| 4 | POST `/api/account/onboarding` as agent/viewer role | 403 — route requires admin |
| 5 | POST with `workspace_name` of 1 char / 200 chars / non-string | 400 with a clear message; account row untouched |
| 6 | POST `complete: true` twice | Second call succeeds but the ORIGINAL timestamp is kept (idempotent) |
| 7 | Kill the network mid-step, click Continue | Inline error, user stays on the step, nothing lost |
| 8 | Enter key while composing CJK text in the name/email inputs | Does NOT submit (isComposing / keyCode 229 guard) |
| 9 | Invite the same email twice in step 3 | Inline "already invited" error, no duplicate API call |
| 10 | Free-plan account with seats full → send invite from wizard | 402 quota error surfaces inline (invite route enforces `max_members`) |
| 11 | Hammer the onboarding endpoint (script, >admin rate limit) | 429 responses |
| 12 | Tamper: POST onboarding with another account's ID in the body | Impossible — tenant comes from the session, body has no account field |
| 13 | `prefers-reduced-motion` enabled | Wizard renders without slide/stagger; usage bars render at final width |
| 14 | Existing (pre-feature) workspaces after deploy | Never see the wizard (migration backfilled `onboarding_completed_at`) |

## Security review summary (done, for the record)

- **Tenant isolation**: onboarding writes are scoped by `ctx.accountId` from
  the server session; the request body cannot name a target account.
- **AuthZ**: `requireRole('admin')` on the API; owner-only + not-yet-onboarded
  enforced server-side in the layout (client cannot bypass via direct URL).
- **Input validation**: name trimmed, 2–120 chars, string-typed; invite email
  validated client-side AND by the existing invitations route server-side.
- **Rate limiting**: `adminAction` bucket on the onboarding endpoint.
- **Audit**: `onboarding.updated` / `onboarding.completed` events logged with
  actor + account; no PII beyond what audit already stores.
- **Idempotency**: completion uses `.is('onboarding_completed_at', null)` so
  replays cannot overwrite the original timestamp.
- **No secrets in client**: wizard only calls same-origin APIs; plan numbers
  are fetched server-side in the RSC page.
- **SEO/robots**: onboarding pages are `noindex`.

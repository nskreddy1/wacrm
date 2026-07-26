# Production readiness & security review — Axon

Audited against the 37-point pre-launch checklist. Every line below was
**verified against the codebase or a live request**, not assumed.

Legend: PASS · FIXED (this pass) · TODO (needs owner action) · N/A (with reason)

---

## 1. Security

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | RLS enabled | **PASS** | All **80** public tables have `rowsecurity = true`. Zero exceptions. |
| 2 | Auth/paywall on server, not frontend | **PASS** | `src/proxy.ts` guards every route; API routes independently call `getCurrentAccount()`. Admin routes gated by `requireSuperAdmin`. Verified live: unauthenticated `PATCH /api/account/onboarding` → **401**; non-super-admin hitting `/admin/platform` → redirected. |
| 3 | No secrets in frontend | **PASS** | Only 6 `NEXT_PUBLIC_*` vars, all non-sensitive (URL, locale, Supabase anon key — anon key is designed to be public and is RLS-bound). Audited every file importing `SERVICE_ROLE`: **none** carry `'use client'`. |
| 4 | Force HTTPS / SSL | **PASS** | `Strict-Transport-Security` in `SECURITY_HEADERS`, applied via catch-all rule in `next.config`. Vercel terminates TLS. |
| 5 | Rate-limit expensive AI endpoints | **FIXED** | `POST /api/assistant/chat` ran the **platform** LLM key with **no limiter** — one user could burn the platform budget, and each turn fans out to 5 tool steps. Added per-user (15/min) + per-account (40/min) caps. See "Notable finds" below. |
| 6 | Security audit for injection/authz | **PASS** | All DB access is parameterized (Supabase client / `pg` placeholders) — no string-concatenated SQL. WhatsApp webhook verifies `x-hub-signature-256` via `verifyMetaWebhookSignature` on the **raw** body. `/api/flows/cron` uses a constant-time compare on `AUTOMATION_CRON_SECRET`. |

## 2. Emails

| # | Item | Status | Notes |
|---|------|--------|-------|
| 7 | SPF / DKIM / DMARC | **TODO — owner** | DNS-level, cannot be set from code. Configure on the sending domain in your DNS provider. |
| 8 | Transactional emails | **PASS** | Implemented in `src/lib/email/`; invite delivery wired and exercised during onboarding QA. |
| 9 | Test signup mail in Gmail **and** Outlook | **TODO — owner** | Manual. Note our QA found Supabase **rejects `@example.com`** — use a real inbox. |
| 10 | Marketing mail from a subdomain | **TODO — owner** | DNS/vendor decision. Keeps marketing reputation off the transactional domain. |
| 11 | mail-tester.com score 9/10+ | **TODO — owner** | Run after #7 lands; the score is mostly a function of SPF/DKIM/DMARC. |

## 3. Findability / SEO

**Context: Axon is a private authenticated CRM with `robots: noindex, nofollow`
set app-wide. Most SEO items are N/A *by design* — there is no public
surface to rank. That makes #13 and #16 the ones that actually matter.**

| # | Item | Status | Notes |
|---|------|--------|-------|
| 12 | OG preview image | **N/A** | Nothing is publicly shareable; every route sits behind auth. |
| 13 | Submit sitemap | **N/A (deliberate)** | Publishing a sitemap would advertise the exact routes we ask crawlers to skip. `robots.ts` intentionally omits a `sitemap` entry. |
| 14 | Not blocking Google in robots.txt | **FIXED (inverted)** | We *want* to block. `robots.txt` didn't exist. Added `src/app/robots.ts` → `Disallow: /`. **Found a real bug:** the proxy matcher intercepted `/robots.txt` and 307'd it to `/login`, so rules were never delivered — the auth guard silently defeated the file meant to keep this CRM out of search. Excluded metadata routes from the matcher. Verified: `curl /robots.txt` → `User-Agent: * / Disallow: /`. |
| 15 | Real title + description per page | **PASS** | Root `layout.tsx` sets a title template (`%s — Axon`) + description; route groups override. New 404 sets `title: 'Page not found'` (verified in browser tab). |
| 16 | No localhost/staging leftovers | **PASS** | No hardcoded `localhost` in shipped source; URLs come from env. |
| 17 | App on subdomain, marketing on main | **TODO — owner** | Infra choice, not code. |
| 18 | metatags.io preview | **N/A** | Follows from #12. |

## 4. Speed / Performance

| # | Item | Status | Notes |
|---|------|--------|-------|
| 19 | PageSpeed Insights | **TODO — owner** | Run against the deployed URL; localhost numbers are meaningless. Authenticated app, so use a logged-in trace. |
| 20 | Compress images | **PASS** | No raster assets in `public/` to squash; **zero** raw `<img>` tags in `src/` — the one image path uses `next/image` (automatic optimization). |
| 21 | Fix layout shifts | **PARTIAL — see §7** | Skeletons are used for async panels. The admin console had genuine *responsive* breakage (fixed this pass, below), which is adjacent to CLS. |
| 22 | Remove unused libraries | **TODO — owner** | Recommend `npx depcheck`. Not done here: pruning `package.json` without a full-build regression run risks removing a transitively-needed dep. |

## 5. Analytics

| # | Item | Status | Notes |
|---|------|--------|-------|
| 23 | Install analytics + verify firing | **TODO — owner** | **Nothing installed** — no `@vercel/analytics`, no PostHog, no Sentry. This is the single biggest gap. |
| 24 | Track web vitals | **TODO — owner** | `@vercel/speed-insights` or `useReportWebVitals`. |
| 25 | Basic bot protection | **PARTIAL** | Rate limiting covers abuse volume; no CAPTCHA/WAF on `/signup`. Consider Vercel WAF / Bot Management. |
| 26 | One conversion funnel | **TODO — owner** | Depends on #23. Natural funnel: signup → email confirm → onboarding step 1 → finish. |
| 27 | Error tracking | **PARTIAL — improved** | Added `global-error.tsx` which logs `message` + `digest` to Vercel logs. A real tracker (Sentry) is still recommended so failures page someone. |
| 28 | Session recordings + consent | **TODO — owner** | Requires #23 and a consent gate (#31). |

## 6. Legal

| # | Item | Status | Notes |
|---|------|--------|-------|
| 29 | ToS + Privacy Policy | **TODO — owner** | No `/terms` or `/privacy` route exists. Needs real legal text — I won't fabricate binding language. |
| 30 | Merchant of record | **TODO — owner** | Business decision. Relevant: plans priced in paise (₹) in the admin console. |
| 31 | Cookie banner (EU) | **TODO — owner** | Currently only strictly-necessary auth cookies are set, which generally need no consent. Becomes **required** the moment #23/#28 land. |

## 7. Final Testing

| # | Item | Status | Notes |
|---|------|--------|-------|
| 32 | Stripe webhooks in live mode | **TODO — owner** | Requires live keys. |
| 33 | Core flow on a second browser/desktop | **PASS** | Full client-perspective pass: signup → confirm → login → 3-step onboarding → invite → finish → dashboard. |
| 34 | Core flow on phone | **FIXED** | Admin console was **not** responsive. Root cause: pages used *viewport* breakpoints (`lg:`/`xl:`) while the real content column is viewport minus ~450px of chrome (sidebar 48px collapsed → 256px expanded, plus admin nav). So `xl:grid-cols-3` fired while the column was still narrow, squeezing plan cards to ~290px and pushing **Save changes outside the card border**. Converted to container queries (`@container/console`, `@container/plan`) across plans, providers, AI agent, and platform pages. Audit tables now scroll instead of crushing. |
| 35 | Click every link/button | **PASS (onboarding scope)** | Exercised in QA; see `docs/onboarding-verification.md`. |
| 36 | Try to break forms | **PASS** | Verified: 1-char workspace name → Continue disabled; 200-char input clamped by `maxlength=120`; invalid invite email → inline error; duplicate invite → rejected; unauthenticated API → 401. |
| 37 | Check 404 page | **FIXED** | Didn't exist (Next.js served its unstyled default, which reads as a crash). Added `src/app/not-found.tsx` — verified live: correct `Page not found — Axon` title, styled, single focus stop per action. |

---

## Notable finds

**1. Unmetered LLM endpoint on the platform key (cost/DoS).**
`/api/assistant/chat` had no rate limit while every sibling AI route did.
It's also the *only* AI route spending the **platform** key rather than the
tenant's BYO key — so abuse bills us, not them, and each turn fans out to
`stepCountIs(5)` model round-trips. Fixed with dual caps. The per-account cap
is deliberately per-account rather than one global platform budget: a global
cap would let a single noisy tenant deny the assistant to every other customer.

**2. Auth guard defeated robots.txt.**
The proxy matcher excluded static assets but not *generated metadata routes*,
so `/robots.txt` 307'd to `/login`. The file intended to keep a private CRM out
of search results was never actually served. Caught only by `curl`-ing the live
route — reading the source would not have revealed it.

**3. Seat quota counts members but not pending invites (UX gap, not a breach).**
On the Free plan (2 seats) an owner can send 2+ invites, exceeding seats.
**Not over-subscribable** — `/api/invitations/[token]/redeem` enforces the cap
at redemption, so the extra invite fails when accepted. The result is a poor
experience (invite sent, then bounces) rather than a security hole. Recommend
counting `members + pending invites` at *send* time so it fails fast.

**4. Missing i18n keys rendered raw.** Settings nav showed literal
`Settings.sections.usage` / `.activity`. Added to `messages/en.json`.

## Verification

- `npx tsc --noEmit` — clean
- `npx vitest run` — **83 files, 725 tests, all passing**
- Live browser checks for robots.txt, 404, onboarding, and admin responsiveness

## Top priorities before launch

1. **Analytics + error tracking** (#23, #27) — you are currently blind in prod.
2. **ToS + Privacy Policy** (#29) — needs real legal text.
3. **SPF/DKIM/DMARC** (#7) — until then, transactional mail lands in spam.
4. **PageSpeed on the deployed URL** (#19).
5. **Seat-quota pre-check** (find #3) — small change, avoids a confusing bounce.

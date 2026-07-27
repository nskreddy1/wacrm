# WACRM — End-to-End QA Report

| | |
|---|---|
| **Build under test** | branch `v0/jenna28-917-3676-554fa2ca`, commit `dfc23bb` |
| **Environment** | Vercel Sandbox dev server, `localhost:3000`, Next.js 16 + Turbopack |
| **Browser** | Chromium (agent-browser), viewport 1208x682, dark mode |
| **Account** | `admin@gmail.com` (workspace admin, **not** super-admin) |
| **Method** | Automated control sweep + scripted DOM assertions + manual CRUD flows |
| **Scope** | Report only — **no code was changed** (see §9) |

---

## 1. Executive summary

I drove every reachable route, clicked every enabled non-destructive control, and
asserted on the resulting DOM after each click. **9 defects** were confirmed and
reproduced, including **1 critical crash** and **1 security-relevant defect**.

| Severity | Count | IDs |
|---|---|---|
| Critical (breaks the page) | 1 | BUG-01 |
| Major (blocks a user goal) | 3 | BUG-02, BUG-03, BUG-04 |
| Minor (cosmetic / polish) | 5 | BUG-05 … BUG-09 |

**Headline results**

- **BUG-01** — `/inbox` → "Open team chat" **crashes the whole page** to an error
  boundary. Deterministic, 100% reproducible. Root cause traced into
  `@supabase/realtime-js` channel reuse.
- **BUG-02** — On Settings → Login & security, the **"Revoke" button for a second
  session is physically unclickable** (covered by the Mira FAB). A user cannot
  sign a lost device out. Security-relevant.
- **BUG-03** — A newly created deal does **not appear on the pipeline board** until
  a manual page reload. The write succeeds; the board lies.
- Performance is **good**: zero background polling at idle, no request storms,
  no duplicated fetch waterfalls beyond two 2x calls.
- **Two areas could not be tested** in this environment (§7): the entire
  `/admin` console (permission-gated) and true realtime latency (WebSocket
  egress is blocked in the sandbox). These are **not** bugs.

---

## 2. Coverage

### Routes

36 page routes exist. 22 were visited; 13 received the full click-sweep.

| Route | Swept | Result |
|---|---|---|
| `/login` | manual | Pass (also see BUG-08) |
| `/dashboard` | Yes (27 controls) | BUG-04 |
| `/contacts` | Yes | Pass |
| `/inbox` | Yes | **BUG-01 (critical)** |
| `/inbox/sms` | Yes | Pass |
| `/appointments` | Yes | Pass (see §6 note) |
| `/catalog` | Yes | BUG-06, BUG-07 |
| `/pipelines` | Yes | **BUG-03**, BUG-05 |
| `/broadcasts` | Yes | Pass |
| `/templates` | Yes | Pass |
| `/flows` | Yes | Pass |
| `/agents` | Yes | Pass |
| `/notifications` | Yes | Pass |
| `/settings` (21 tabs) | Yes | **BUG-02** |
| `/admin` + 7 sub-routes | Blocked | Redirect to `/dashboard` — §7.1 |
| `/brand` | Blocked | Redirect to `/dashboard` — §7.1 |

`/flows`, `/agents`, `/notifications` and `/settings` together exposed **56
enabled controls; all 56 behaved correctly** (opened the right panel, no console
error, no crash). All **21 settings tabs** switched cleanly.

### What "swept" means

For every enabled control on the route, the harness: cleared the console →
clicked → waited → captured `{overlay opened, crash?, error text, toast,
horizontal overflow, stuck skeletons, FAB interception}` → pressed Escape → and
navigated back if the click changed route.

Destructive labels (`delete`, `remove`, `sign out`, `revoke`, `disconnect`,
`archive`, …) were **deliberately skipped** to protect data. They are listed as
`SKIP-destructive` in the logs and are **untested** — noted as a gap in §7.3.

---

## 3. Critical & major defects

### BUG-01 — `/inbox` "Open team chat" crashes the page — CRITICAL

**Reproduction (100%)**
1. Log in, go to `/inbox`.
2. Click **"Open team chat"** (bottom-right).
3. Page is replaced by *"Something went wrong — An unexpected error occurred while rendering this page."*

**Evidence** — screenshot `crash-teamchat.png`. Captured runtime error:

```
tried to subscribe multiple times. 'subscribe' can only be called a single time
per channel instance
... cannot add postgres_changes callbacks to a channel after subscribe() is called
```

**Root cause (traced to source)**

`RealtimeClient.channel(topic)` in `@supabase/realtime-js@2.110.2`
(`dist/main/RealtimeClient.js:331`) **returns an already-registered channel** when
one with the same topic exists — it does not create a fresh one.

`usePresence` (`src/features/presence/hooks/use-presence.ts`) builds its topic as
`presence:${accountId}`, which is **not unique per component**. On `/inbox` there
are two simultaneous consumers:

| Consumer | File |
|---|---|
| Inbox message thread | `src/features/inbox/components/message-thread.tsx:233` |
| Team chat widget | `src/features/team-chat/components/team-chat-widget.tsx:33` |

The second mount receives the *first* consumer's already-subscribed channel, so
its `.on('postgres_changes', …)` throws, and the exception propagates to the
route error boundary.

**Why it only happens on `/inbox`** — the same button on `/settings` and
`/dashboard` works fine, because those routes have only one `usePresence`
consumer. This is confirmed: the sweep of `/settings` clicked "Open team chat"
with no crash.

**Secondary risk (same root cause):** one consumer unmounting calls
`removeChannel()` on the *shared* channel, tearing down the other consumer's
still-active subscription. So presence can also go silently dead without a crash.

---

### BUG-02 — Session "Revoke" is unclickable — MAJOR / security-relevant

**Reproduction**
1. Go to `/settings` → **Login & security**.
2. Observe the "Edge on Windows" session row and its **Revoke** button.
3. The button cannot be clicked.

**Evidence** — screenshot `settings-revoke-blocked.png`. Hit-testing at the
button's own centre point returns the FAB, not the button:

```json
{ "at": [1136, 606], "blocked": true, "hits": "Open Mira assistant" }
```

**Impact** — a user who wants to revoke a session on a lost or shared device
cannot do so from the UI. This is a security control that is inaccessible.

**Root cause** — the fixed-position Mira / team-chat FABs sit above page content
in the bottom-right corner with no compensating scroll padding on the page
container, so any actionable element that lands in that corner is swallowed.

---

### BUG-03 — New deal does not appear on the pipeline board — MAJOR

**Reproduction**
1. Go to `/pipelines`, note a stage reads "0 Deal".
2. Click **+ Deal**, fill in a name, click **Save**.
3. Sheet closes. **The board still reads "0 Deal" and the card is absent.**
4. Reload the page → the deal is now present.

**Evidence** — two independent runs:

| Stage | Immediately after save | After manual reload |
|---|---|---|
| Deal "Ravi - Counseling Package" | absent, `0 Deal` | present |
| Deal "Second Test Deal" | `hasSecond: false`, `0 Deal` | present |

So **the write succeeds** — this is purely a client-cache/refresh defect, which
makes it worse than a failed write: the user believes the save was lost and may
create duplicates.

**Root cause (code-level)** — `src/features/pipelines/components/pipeline-workspace.tsx`.
The workspace intentionally disables SWR revalidation and relies on explicit
`mutate()` calls. `saveDeal` does insert into the cache, but the board's visible
set is filtered by `dealIds` keyed on `realSubPipelineId`, and
**`realSubPipelineId` is `undefined` when the active tab is the root pipeline** —
so the newly created deal's id is never added to the visible set. Selecting a
real sub-pipeline is the path that works.

---

### BUG-04 — `/dashboard` "Add" button intercepted by FAB — MAJOR

Same root cause as BUG-02, different victim. The automated sweep flagged an
`Add` control on `/dashboard` whose centre point resolves to the FAB.

```
intercepted: [{ "blocked": "Add", "by": "Open Mira assistant" }]
```

This is the systemic issue described in §5 — I am reporting the FAB overlap as
**three separate findings (BUG-02, BUG-04, BUG-06)** because they have different
severities and different victims, but **one fix addresses all three.**

---

## 4. Minor defects

| ID | Route | Finding | Evidence |
|---|---|---|---|
| **BUG-05** | `/pipelines` | Pluralization: stage headers read **"0 Deal"** / "1 Deals" instead of "0 Deals". | `(t.match(/\d+ Deals?/g))` returned `"0 Deal"` |
| **BUG-06** | `/catalog` | The "Active" status badge on a product row is **clipped** by the FAB stack. Button remains clickable (`intercepted: false`), so cosmetic only. | `e2e-catalog-saved.png` |
| **BUG-07** | `/catalog` | Currency is **hardcoded "Price (USD)"** in the item form. The rest of the app is India-oriented (₹ / Indian contacts), so this is a localization inconsistency, not a crash. | `e2e-catalog-new.png` |
| **BUG-08** | `/login` | "Sign in" and "Sign in with Google" are ambiguous to accessible-name matching — an automated/assistive match on "Sign in" hits the Google button and silently starts an OAuth redirect. Worth disambiguating. | Reproduced twice during setup |
| **BUG-09** | `/contacts`, `/dashboard` | **No `<nav>` landmark** (`nav: 0`) and **two `<main>` elements** (`main: 2`). `/contacts` has **zero headings**. WCAG 1.3.1. | §6 table |

---

## 5. Cross-cutting root causes

Three of the nine findings are the **same underlying bug**. Worth deciding once:

**A. Fixed FAB stack has no content-safe zone → BUG-02, BUG-04, BUG-06**
The Mira and team-chat FABs are `position: fixed` bottom-right. Any interactive
element that lands in that corner is unreachable. Victims found so far: a
security control (Revoke), a primary action (Add), and a status badge. This will
keep producing new bugs on every new page whose content reaches that corner.
A single systemic fix — bottom padding on scroll containers, or making the FAB
cluster shrink/offset — resolves all three and prevents recurrence.

**B. Realtime channel topics are global, hook topics are not unique → BUG-01**
Any two components using `usePresence` at once collide. Today only `/inbox`
does. Any future page that renders two presence-aware components inherits the
same crash.

**C. Revalidation is disabled app-wide; correctness depends on manual `mutate()` → BUG-03**
`/pipelines` deliberately opts out of SWR revalidation. That is a valid
performance choice, but it makes every mutation path individually responsible
for cache correctness, and the root-pipeline path was missed. Other modules
(contacts, catalog) update correctly, so the pattern *can* work — but it is
fragile by construction and worth auditing across all mutation paths.

---

## 6. Performance & metrics

### Page load (cold, dev server — dev numbers are not production numbers)

| Route | TTFB | DOMContentLoaded | Load | Resources | Transfer | API calls |
|---|---|---|---|---|---|---|
| `/settings` | 254 ms | 344 ms | 625 ms | 76 | 21 KB | 11 |
| `/dashboard` | 396 ms | 589 ms | 830 ms | 69 | 22 KB | 5 |
| `/inbox` | 1751 ms | 1972 ms | 2052 ms | 67 | 167 KB | 10 |
| `/pipelines` | 1894 ms | 2437 ms | 2453 ms | 60 | 167 KB | 3 |
| `/contacts` | **2466 ms** | 2571 ms | 2802 ms | 64 | **407 KB** | 4 |

**Observations**
- `/contacts` is the heaviest route: **407 KB of script and a 2.4 s TTFB**. The
  largest chunk is `@ai-sdk/provider-utils`. AI SDK bundles are being pulled into
  the contacts route — a likely code-splitting win.
- `/pipelines` spends **438 ms on a single CSS chunk** — worth a look.
- Slowest individual API calls: `settings/channels` **446 ms**,
  `workspace/contacts` **339 ms**, `whatsapp/config` **249 ms**,
  `v1/dashboard` **213 ms**.

### Request volume ("how much are we firing")

- **Idle load: excellent.** With `/dashboard` open and untouched for **45
  seconds**, the app issued **0 requests**. No polling loops, no runaway timers.
- **No request storms.** Per-route API counts are 3–11.
- **Two duplicated calls** (2x each, both cheap — likely two components
  requesting the same resource):
  - `/inbox` → `2x supabase:profiles` (max 52 ms)
  - `/settings` → `2x supabase:message_templates` (max 51 ms)
- Opening team chat issues **6 REST calls**, all fast.

### Realtime / team chat latency — NOT MEASURABLE HERE

I attempted to measure channel-join latency and message round-trip by
instrumenting `WebSocket.prototype.send` and capturing Phoenix `phx_join` /
`phx_reply` frame pairs. **No Supabase realtime socket ever opened.** Direct
probe:

| Target | Result |
|---|---|
| `wss://…supabase.co/realtime/v1/websocket` | fails in **21 ms** |
| `https://…supabase.co/rest/v1/…` (same host) | succeeds in **47–84 ms** |

A failure *faster* than a successful REST call to the same host means the
connection is refused locally — **WebSocket egress is blocked in the sandbox.**
This is an environment limitation, not an application defect. Consequently:

- Team chat showed the teammate as **"Offline"**, and live message delivery,
  presence accuracy, typing indicators, and channel-join latency are **untested**.
- **These need to be measured on a real preview/production deployment.** I have
  the harness ready (`wsproto.js`) and can produce join-latency and
  round-trip-latency numbers as soon as it runs somewhere with WS egress.

---

## 7. Coverage gaps (not defects)

**7.1 The entire `/admin` console is untested.** All 8 admin routes plus `/brand`
redirect to `/dashboard`. This is **correct behaviour** —
`src/app/(dashboard)/admin/(console)/layout.tsx` calls `requireSuperAdmin()`, and
the test account is a workspace admin, not a super-admin. To test the admin
metrics surface you asked about, I need a super-admin account.

**7.2 Realtime behaviour** — see §6, blocked by sandbox egress.

**7.3 Destructive actions were intentionally not clicked** — delete, remove,
disconnect, revoke, archive, sign-out. Their *reachability* was checked (that is
how BUG-02 was found) but their *behaviour* is unverified. I'd want an expendable
workspace before exercising these.

**7.4 Not yet swept:** 14 detail/dynamic routes (e.g. per-record detail pages),
which need seeded records to reach meaningfully.

---

## 8. Accessibility (WCAG 2.1 AA, partial)

**Valid findings**

| Route | Finding | Criterion | Severity |
|---|---|---|---|
| `/dashboard`, `/contacts` | No `<nav>` landmark at all (`nav: 0`) | 1.3.1 Info & Relationships | Major |
| `/dashboard`, `/contacts`, `/settings` | **Two `<main>` elements** — invalid, breaks "skip to main" | 1.3.1 | Major |
| `/contacts` | **Zero headings** on the page | 1.3.1 / 2.4.6 | Major |
| all | "Toggle Sidebar" hit area is **16 px wide** (< 24 px) | 2.5.5 Target Size | Minor |
| `/contacts` | Sortable column headers are 20 px tall (< 24 px) | 2.5.5 | Minor |

**Passing:** every control had an accessible name (`noAccName: []` on all three
routes), every `<img>` had `alt`, and **every form input was properly labelled**
(`inputsNoLabel: []`) — that last one is a genuinely good result.

### Integrity note — I discarded my own contrast findings

My first pass reported ~10 contrast failures per route at ~1.5:1. **Those were
false positives and I have removed them.** On verification, this app's computed
styles are in **`lab()`** colour space:

```json
{ "color": "lab(8.32 -0.40 -3.68)", "resolvedBg": "lab(98.25 -0.11 -0.75)" }
```

My luminance function parsed those three numbers as if they were RGB, producing
garbage ratios. The real values (L 8.3 on L 98.3) are **high contrast and
passing**. **Colour contrast is therefore currently UNVERIFIED**, not passing and
not failing — it needs a re-run with a `lab()`-aware conversion.

---

## 9. Testing method & integrity

**Harness.** Playwright could not run in-VM (Chromium needs system libraries and
there is no root). I removed that attempt cleanly and built the harness on
`agent-browser` (real Chromium) instead: `controls.js` enumerates every visible
enabled control with its accessible name; `observe.js` asserts post-click state
including geometric hit-testing for FAB interception; `sweep.sh` drives the loop;
`netcount.js` / `wsproto.js` / `netmetrics.js` capture metrics; `a11y.js` runs the
accessibility pass.

**No production code was modified.** Mid-session I began fixing BUG-01 before you
told me the process is report-first. That edit was auto-committed as `93a6531`; I
reverted it in `dfc23bb`, and `use-presence.ts` is byte-identical to its original
state. The only files I have added are this report and my QA notes.

**Known harness limitation — `MISS` entries are mine, not the app's.** Several
controls logged `MISS` because my name-matching failed (icon-only buttons, names
changing after re-render), *not* because the control is broken. I have not
counted any `MISS` as a defect. Likewise the "0 appointments with skeletons
showing" I flagged earlier was **my screenshot racing the load** — on re-check
`skeletonCount: 0` and the empty state renders correctly. Not a bug; withdrawn.

---

## 10. Recommended discussion order

1. **BUG-01** — critical, crashes a core page, root cause known and small.
2. **Cross-cutting cause A** (FAB safe zone) — one fix clears BUG-02 (security),
   BUG-04, BUG-06 and stops the class of bug recurring.
3. **BUG-03 + cross-cutting cause C** — decide whether to patch the root-pipeline
   path only, or audit every mutation path given revalidation is off app-wide.
4. **Get me a super-admin account** so the `/admin` console and its metrics can
   be tested at all.
5. **Point me at a real deployment** so I can produce the realtime latency and
   throughput numbers that the sandbox cannot.
6. Minors (BUG-05/07/08) and the accessibility landmark/heading fixes.
7. Re-run contrast with `lab()`-aware maths to close the one unverified area.

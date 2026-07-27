# End-to-end UI test findings

Manual/automated UI pass acting as a real user.
Environment: dark mode, 1208x682 desktop viewport, logged in as `admin@gmail.com`.

Status legend: **FIXED** = repaired this session · **OPEN** = needs a decision · **INFO** = no action needed

---

## FIXED — Import modal (step 2) overflowed the viewport

**Reported by user.** At 1208x682 the "Default country for phone numbers" card was cut off,
the Live data preview below it was unreachable, and the footer floated on top of the card.

Root cause measured in-browser: the scroll viewport was **992px tall inside a 437px slot**
(`scrollHeight === clientHeight`, `canScroll: false`). The `ScrollArea` primitive's viewport
uses `size-full`, so its `height: 100%` had nothing to resolve against — the parent was
`flex-1` with no explicit height. It expanded to full content height instead of scrolling.

Fix: replaced `ScrollArea` with a plain `overflow-y-auto` container in `import-modal.tsx`.
Verified after: `clientH: 437`, `scrollH: 992`, `canScroll: true`, footer no longer overlaps.

Scoped to the modal rather than patching `scroll-area.tsx`, since that primitive is used in
6 other places and a global change risked regressions.

### Why only this one broke
Audited all other `ScrollArea className="min-h-0 flex-1"` usages. The rest live inside
`Sheet`, which is fixed-positioned with a definite height, so `height: 100%` resolves
correctly. Verified the contact record sheet live: `canScroll: true`, fits viewport exactly.
Dialog was the only broken parent because its height is content-driven.

---

## FIXED — CSV auto-mapping fell back to "Ignore column"

Found while verifying the fix above. Every column defaulted to "Ignore column" instead of
detecting name/phone/email. **This was pre-existing, not caused by the layout change.**

Root cause: `fields` loads over SWR, but `autoMap` runs at file-parse time. Uploading before
that request resolves means it matches nothing. Real users usually don't hit it because the
fetch beats the file picker; automated upload hits it consistently.

Fix: added an effect that re-runs auto-mapping when the field list arrives, preserving any
selection the user already made, keyed on field IDs so it never clobbers manual edits.
Verified after: correctly detects name/phone/email/company/source.

---

## OPEN (blocker) — Floating buttons cover contacts pagination; "Next page" opens team chat

Found during E2E pass on `/contacts`. The two floating action buttons sit on top of the
table footer's pagination controls, so the arrows cannot be clicked.

Proof via `document.elementFromPoint` at each button's own center:

| Control | Center | What actually receives the click |
|---|---|---|
| Next page | 1178, 654 | **"Open team chat"** button |
| Previous page | 1134, 654 | footer overlay (intercepted) |

So clicking "Next page" opens the team chat panel instead of paginating. The
`1–11 of 11` label (x 1055–1104) is also partly hidden behind the Mira button.

Source of the collision:
- `assistant/components/assistant-widget.tsx:86` — `fixed right-20 bottom-4 z-40 size-12`
- `team-chat/components/team-chat-widget.tsx:67` — `fixed right-4 bottom-4 z-40 size-12`
- `contacts/components/contact-workspace.tsx:864` — in-flow `<footer>` with right-aligned
  pagination; `:908` Previous page, `:919` Next page

Together the FABs occupy roughly the rightmost 128px above the footer.

**Impact:** currently masked because there are only 11 contacts and the page size is 20, so
pagination is inactive. With more than one page of contacts this makes paging unusable.

**Scope:** I scanned all 12 main routes for controls intercepted by the FABs — only
`/contacts` is affected, since it is the only page with a right-aligned pagination footer.

**Suggested fix (not applied — flagging for your call):** reserve the FAB gutter on the
footer, e.g. add end padding such as `pe-32` to the `<footer>` in `contact-workspace.tsx`
so its controls clear the floating buttons. Worth deciding whether the gutter should be
global (a shared layout token) rather than per-page, since any future bottom-right control
will hit the same trap.

---

## INFO — Phone normalization verified correct

Confirmed the default-country logic behaves as intended:
- `8328510888` (no country code) → `+18328510888` via default country
- `918328510888` (already has country) → `+918328510888`, keeps its own country
- `15555000001` → `+15555000001`, keeps US `1` rather than gaining `+91`

---

## OPEN (UX friction) — Default phone country is hardcoded to US and never persists

`src/lib/phone/e164.ts:41` — `export const DEFAULT_PHONE_COUNTRY: CountryCode = 'US'`

The import modal seeds its country selector from this constant
(`import-modal.tsx:159`), so the choice is per-session UI state only. Selecting
"India (+91)" for one import does not persist — the next import reopens at US.

The manual Create Contact form has the same US default: I entered an Indian number
`8328510888` and it saved as `+18328510888`, not `+918328510888`.

**Impact:** a workspace whose contacts are mostly non-US has to re-select the country on
every import and every manual phone entry, and a missed selection silently writes a
wrong-country number rather than erroring.

**Suggested fix (not applied):** store the default phone country as a workspace setting and
have both the import modal and the contact phone input read from it. Worth confirming what
you want the workspace default to be.

---

## INFO — Verified working during the E2E pass

- **Contacts filter builder** — added a rule, validation correctly blocked an empty value
  ("Name needs a value", Apply disabled), applying `name contains "Test Contact 1"` returned
  2 rows (Contact 1 and 10 — correct for `contains`), with an active-filter chip and
  accurate "Matching contacts 2" count. Clear all restored the full list.
- **Create Contact validation** — saving empty produced inline per-field errors
  ("Enter the contact's first name.", "Add an email address or phone number.") and kept the
  sheet open rather than silently failing.
- **Create Contact happy path** — created Ravi Kumar, total moved 11 → 12, row rendered
  immediately.
- **Contact record sheet** — opens, scrolls correctly (`canScroll: true`), fits viewport.
- **All three contact view modes** (list / editable sheet / card) — render with no
  horizontal overflow and no error boundaries.
- **Route sweep** — all 14 main routes load clean: no horizontal overflow, no error
  boundaries, no page errors. `/automations` correctly redirects to `/flows`.

---

## INFO — Test data present in the database

The contacts table currently holds 10 rows named `Test Contact 1`–`Test Contact 10`
(phones `+15555000001`–`+15555000010`), total 11 contacts. These came from CSV import
testing, not from real usage. Flagging in case you want them removed.

---

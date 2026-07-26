# Feature: Template Studio (WhatsApp / SMS / Email)

> Naming convention: per-feature design docs live in
> `.agents/context/feature-<kebab-name>.md`. This is the first one.
> Each doc carries the feature's HLD (what/why/flows) and LLD
> (files, types, routes, DB, invariants) so both humans and agents
> can work on the feature without re-deriving the architecture.

Status: shipped (Jul 2026). Owner surface: `/templates` page.
Relevant skills (install under `.agents/skills/`): `twilio-content-template-builder`,
`twilio-whatsapp-send-message`, `twilio-compliance-traffic`,
`twilio-messaging-webhooks`, `twilio-email-send`,
`twilio-email-deliverability-advisor`, `twilio-debugging-observability`.
**Check these before touching template or messaging code.**

---

## 1. HLD — High-level design

### 1.1 What it is

A single studio to author, sync, compliance-check, submit, and track
message templates across three channels (WhatsApp, SMS, Email) and
two WhatsApp providers (Twilio Content API, Meta Cloud API). Approved
WhatsApp templates feed the Broadcasts wizard; SMS/Email templates are
approved-on-save (no external review exists).

### 1.2 Architecture

```
                       /templates (studio UI)
                              │
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
  GET/POST/PUT          POST /api/whatsapp/     POST /api/whatsapp/
  /api/templates        templates/twilio        templates/sync (Meta)
  (save + compliance    (Twilio create/sync/    (Meta Cloud API sync)
   gate, provider       submit via Content API)
   lock)                       │                      │
        │                      ▼                      ▼
        │             content.twilio.com       graph.facebook.com
        │             /v1 create+approval      /{waba_id}/message_templates
        │             /v2 ContentAndApprovals
        ▼
  message_templates (Supabase, RLS per account_id)
        │
        ▼
  Broadcasts wizard step-1 (status = 'APPROVED' only)
```

### 1.3 The two-provider model

One WhatsApp channel, two interchangeable providers. A template row
belongs to exactly ONE provider — the `provider` column — and the DB
unique key is **(account_id, provider, name, language)**. Consequences:

- A Twilio template and a Meta template with the SAME name coexist
  as separate rows. This is intentional: they are different objects
  in different external systems with independent review lifecycles.
- Sync is provider-scoped: Twilio sync only upserts `provider='twilio'`
  rows; Meta sync only `provider='meta'`. One sync can never clobber
  the other provider's rows.
- **Provider lock**: once a row mirrors a provider-side object
  (`twilio_content_sid` or `meta_template_id` set) or has left DRAFT,
  its provider is immutable — UI shows a locked chip, the PUT handler
  returns 409 on attempts to change it. Only fresh app-created drafts
  can pick a provider.

### 1.4 Status lifecycle (source of truth = the provider)

```
DRAFT ──submit──▶ PENDING ("In review", Meta reviewing) ──▶ APPROVED
  ▲                   │                                        │
  └── app-created     └──▶ REJECTED (rejection_reason)    PAUSED/DISABLED
      or Twilio            resubmit needs a NEW name      (quality drops)
      "unsubmitted"
```

Key facts agents get wrong:
- Twilio's green "WhatsApp user initiated" console badge is NOT an
  approval — every template is session-eligible for free. Only
  "business initiated" (Meta review) gates broadcasts.
- Nobody can force-approve. Meta reviews in minutes–48h.
- `received`/`pending` from Twilio → our `PENDING`. `unsubmitted` →
  our `DRAFT`.
- Broadcast step-1 filters `status = 'APPROVED'` — an unapproved
  template physically cannot be broadcast (Twilio would 63016).

### 1.5 Category & cost model (why default = Utility)

Meta bills per delivered business-initiated template message:
Utility ≈ 7× cheaper than Marketing (India: ~₹0.115 vs ~₹0.78), and
Utility is FREE inside an open 24h service window. So the studio
surfaces per-category cost hints and pushes Utility for transactional
content. Meta reviews CONTENT, not the label — promo copy in a
"utility" template gets rejected or force-recategorized.

Sync category inference: Twilio reports a category only after
submission. For unsubmitted templates we infer from the name
(otp/verify → Authentication; promo/offer/opt_in → Marketing;
else Utility). See `inferCategory()`.

### 1.6 Compliance engine (channel-specific, dual-enforced)

Three rule sets in `compliance.ts`, run BOTH live in the editor and
as a save gate in `POST /api/templates` (errors block, warnings
persist to the `compliance` jsonb column):

| Channel  | Regime | Blocking examples |
| --- | --- | --- |
| WhatsApp | Meta template policy | marketing w/o opt-out, variable at start/end, adjacent variables |
| SMS      | TCPA + CTIA | marketing w/o STOP, OTP with URL, public shortener |
| Email    | CAN-SPAM + Gmail/Yahoo bulk-sender | marketing w/o unsubscribe, fake RE:/FWD: subject, OTP with URL |

Email extras (warnings): missing postal address, ALL-CAPS subject,
spam punctuation, SHAFT-adjacent content. Known gap: mailer adapters
don't yet send RFC 8058 one-click `List-Unsubscribe` headers.

---

## 2. LLD — Low-level design

### 2.1 File map

| Concern | File |
| --- | --- |
| Studio UI (rail, editor, preview, provider lock chip) | `src/features/templates/components/template-studio.tsx` |
| Client state / DB row ↔ StudioTemplate mapping | `src/features/templates/hooks/use-studio-templates.ts` |
| Shared studio types (`StudioTemplate`, `providerLocked`) | `src/features/templates/lib/studio-types.ts` |
| Compliance rule sets (WA / SMS / Email) | `src/features/templates/lib/compliance.ts` |
| Save + compliance gate + provider-lock guard | `src/app/api/templates/route.ts` |
| Twilio create/sync/submit | `src/app/api/whatsapp/templates/twilio/route.ts` |
| Twilio Content API client + types | `src/features/whatsapp/lib/twilio-content.ts` |
| Meta Cloud API sync | `src/app/api/whatsapp/templates/sync/route.ts` |
| Meta submit | `src/app/api/whatsapp/templates/submit/route.ts` |
| Twilio credential resolution (encrypted, per-account) | `src/features/channels/lib/twilio-account.ts` |
| Broadcast consumption (APPROVED filter) | `src/features/broadcasts/components/step1-choose-template.tsx` |

### 2.2 DB (`message_templates`, RLS by `account_id`)

Columns that drive this feature:
`provider` ('twilio' | 'meta' | null→meta), `channel`
('whatsapp'|'sms'|'email', NULL = legacy whatsapp),
`status` ('DRAFT'|'PENDING'|'APPROVED'|'REJECTED'|'PAUSED'|'DISABLED'),
`twilio_content_sid` (HX…), `meta_template_id`, `category`,
`compliance` (jsonb audit blob), `rejection_reason`, `submission_error`.

Unique: **(account_id, provider, name, language)**. Legacy
(user_id, name, language) index still exists — never stomp `user_id`
on update (audit column; PUT strips it).

### 2.3 Twilio sync algorithm (the tricky part)

`POST /api/whatsapp/templates/twilio { action: 'sync' }`:

1. One paginated call to `GET content.twilio.com/v2/ContentAndApprovals`
   (approval status inline — never N+1 per-template fetches).
2. **Dedup rank**: Twilio allows many Content SIDs with the same
   friendly_name; our key is (name, language) within the provider.
   Rank duplicates by approval status
   (approved 6 > received/pending 5 > paused 4 > disabled 3 >
   rejected 2 > unsubmitted 1), tie-break newest `date_updated`.
   Without this, an old unsubmitted copy listed last would stomp the
   in-review one back to DRAFT (real bug, Jul 2026).
3. `inferCategory(approval.category, friendly_name)` for category.
4. Upsert on the provider-scoped unique key; count inserted/updated.

Status map: `approved→APPROVED`, `received|pending→PENDING`,
`rejected→REJECTED`, `paused→PAUSED`, `disabled→DISABLED`,
`unsubmitted|draft→DRAFT`.

### 2.4 Provider lock (dual enforcement)

- Derived client-side in `use-studio-templates.ts`:
  `providerLocked = !!twilio_content_sid || !!meta_template_id || status !== 'draft'`.
- UI: locked chip (Lock icon + provider name) replaces the Select in
  `template-studio.tsx`; rail rows show a provider tag
  (Twilio red `#F22F46` / Meta green `#25D366`).
- Server: PUT in `/api/templates` re-reads the row and returns **409**
  if a locked row's provider differs from the payload. Never trust the
  client flag.

### 2.5 Credentials

Twilio creds live encrypted (AES-256-GCM, `ENCRYPTION_KEY`) in
`channel_connections.credentials_encrypted`, shape
`{ value: { account_sid, auth_token, … } }` — note the `value`
nesting. Resolution: `getTwilioAccount()` per account_id. Never log
or return decrypted values.

### 2.6 Invariants (do not break)

1. Broadcasts must only ever see `status='APPROVED'` templates.
2. Sync must never demote a better status with a same-name duplicate
   (the rank in §2.3).
3. Provider is immutable once linked/submitted (§2.4) — enforce
   server-side, not just UI.
4. Compliance errors block saves server-side; the editor check is
   convenience, not the gate.
5. Rejected Meta templates cannot be resubmitted under the same name.
6. WhatsApp channel queries must include `channel IS NULL` legacy rows
   (migration 047).

### 2.7 Extension points

- New channel: add a rule set to `compliance.ts` + a category tier
  map, extend `checkCompliance`'s channel union, add editor wiring.
- New WhatsApp provider: add to `provider` union, provider-scoped
  sync route, extend the lock derivation + rail tag.
- Pending-status refresh: a cron hitting Twilio sync per account would
  auto-flip PENDING→APPROVED without a manual "Sync templates" click
  (not built yet — see roadmap).

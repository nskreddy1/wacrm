# Mautic adoption plan — what to copy, adapt, and refuse

Companion to `report-mautic-platform-audit.md`. That report answered *what Mautic
has that we don't*. This one answers the follow-up: **which of Mautic's designs do
we actually pull into this codebase, and how.**

Source: `github.com/mautic/mautic` @ `704a3fd`, read directly (not from docs).
All file paths below are relative to Mautic's repo root and were verified by reading
the files, so they can be opened side-by-side while implementing.

---

## 0. The honest constraint up front

We cannot copy Mautic's *files*. It is PHP 8 / Symfony / Doctrine ORM / Twig; we are
TypeScript / Next.js 16 / Supabase-Postgres with RLS. There is no file in Mautic that
compiles in our tree.

What is genuinely portable, in descending order of literalness:

1. **Lookup and mapping tables** — pure data, decade-accumulated. Copy near-verbatim
   as TypeScript consts. This is the single highest-value, lowest-risk category and
   it is where most of Mautic's real institutional knowledge lives.
2. **Table designs and state enums** — translate Doctrine `loadMetadata()` into a
   Postgres migration. Mechanical, and the index choices are already battle-tested.
3. **Algorithms and state machines** — reimplement in TS from the PHP logic.
4. **Architectural ideas only** — the shape is right, every line gets rewritten.

Anything Mautic does that is an artifact of 2011 PHP (bitwise permission integers,
IMAP polling, column-per-custom-field) we take the *semantic* from and throw the
*mechanism* away. Section 5 lists what to refuse outright.

The ordering below is driven by the P0s in the platform audit, not by how
interesting the code is.

---

## 1. Tier 1 — copy the design directly (do these first)

### 1.1 `DoNotContact` → per-channel consent ledger

**Mautic:** `app/bundles/LeadBundle/Entity/DoNotContact.php`
(+ `Entity/DoNotContactRepository.php`, `Model/DoNotContact.php`)

The design in four fields:

```php
const IS_CONTACTABLE = 0;   // explicit "contactable" row
const UNSUBSCRIBED   = 1;   // contact opted out themselves
const BOUNCED        = 2;   // opted out by delivery failure
const MANUAL         = 3;   // staff opted them out
// + channel (string), channelId (int, nullable), comments (text), dateAdded
```

Indexes, verbatim from `loadMetadata()`:
`(lead_id, channel, reason)`, `(reason)`, `(date_added)`.

**Why it is good.** Four things our boolean cannot do. It is *per channel*, so email
suppression never silently gags WhatsApp. It records *why*, so a bounce-suppression
can be re-evaluated when a mailbox comes back while a manual suppression stays
untouched. `channelId` records *which* email/campaign caused it — provenance for a
compliance auditor. And it is a row with `dateAdded`, so it is an append-only history
rather than a destructively overwritten flag.

**Our gap.** `contacts.sms_opted_out` / `contacts.email_opted_out` booleans — verified
present in the live schema. There is **no `whatsapp_opted_out` column at all**, and
`/api/whatsapp/broadcast` applies no suppression filter whatsoever. Our primary
channel is our only unprotected one. Reason, provenance and timestamp are absent on
all three.

**Port.** New table, keeping our tenancy rules:

```sql
create table public.contact_do_not_contact (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  channel      text not null check (channel in ('whatsapp','email','sms')),
  reason       smallint not null,           -- 1 unsub / 2 bounced / 3 manual
  source_type  text,                        -- 'broadcast' | 'flow' | 'manual' | 'inbound'
  source_id    uuid,                        -- Mautic's channelId, typed
  comments     text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);
create unique index on contact_do_not_contact (account_id, contact_id, channel)
  where reason is not null;
create index on contact_do_not_contact (account_id, channel, reason);
create index on contact_do_not_contact (account_id, created_at desc);
```

RLS via `is_account_member(account_id)`, matching all 88 existing tables. Enforcement
must live in **one** helper (`src/lib/data/consent.ts`) that every send path calls —
the current bug is precisely that three send routes each hand-rolled their own filter
and one of them forgot. Backfill from the two booleans with `reason = 3 (MANUAL)`,
then keep the columns as generated read-only mirrors for one release so nothing
breaks mid-migration.

Skip Mautic's `IS_CONTACTABLE = 0` rows. It exists so a Doctrine relation can carry an
explicit positive; a partial unique index expresses the same thing without the dead rows.

---

### 1.2 The bounce classification table → the crown jewel

**Mautic:** `app/bundles/EmailBundle/MonitoredEmail/Processor/Bounce/`
— specifically `Mapper/CategoryMapper.php`, `Definition/Category.php`,
`Definition/Type.php`, `DsnParser.php`, `BodyParser.php`.

`Definition/Category.php` enumerates 16 failure categories (`antispam`, `autoreply`,
`concurrent`, `content_reject`, `command_reject`, `internal_error`, `defer`,
`delayed`, `dns_loop`, `dns_unknown`, `full`, `inactive`, `latin_only`, `other`, …).
`Definition/Type.php` gives 8 dispositions (`hard`, `soft`, `blocked`, `autoreply`,
`temporary`, `generic`, `unknown`, `unrecognized`). `CategoryMapper::$mappings` joins
them:

```php
Category::ANTISPAM       => ['permanent' => false, 'bounce_type' => Type::BLOCKED],
Category::COMMAND_REJECT => ['permanent' => true,  'bounce_type' => Type::HARD],
Category::DNS_UNKNOWN    => ['permanent' => true,  'bounce_type' => Type::HARD],
Category::FULL           => ['permanent' => false, 'bounce_type' => Type::SOFT],
Category::INACTIVE       => ['permanent' => true,  'bounce_type' => Type::HARD],
Category::AUTOREPLY      => ['permanent' => false, 'bounce_type' => Type::AUTOREPLY],
// …16 total
```

**Why it is good, and why this specific file matters most.** Every distinction here
was paid for by somebody's deliverability incident. `antispam` is *not permanent* —
reputation recovers, so suppressing forever loses real contacts. A full mailbox is
soft. An `autoreply` is a category of its own so out-of-office replies don't get
counted as engagement or as failure. `command_reject` is permanent because it means
relay-denied, not recipient-unknown. Deriving this table from first principles takes
years; copying it takes an afternoon. **This is the most valuable thing in the
repository for us.**

**Our gap.** No bounce or complaint ingestion anywhere in `src/`. Hard bounces retry
forever, which is exactly what burns sender reputation and WABA quality rating.

**Port.** Copy `$mappings` as a TS const — it is pure data:

```ts
// src/features/channels/lib/bounce-classification.ts
export const BOUNCE_CATEGORIES = {
  antispam:       { permanent: false, type: 'blocked'   },
  command_reject: { permanent: true,  type: 'hard'      },
  autoreply:      { permanent: false, type: 'autoreply' },
  // …port all 16 verbatim
} as const satisfies Record<string, { permanent: boolean; type: BounceType }>
```

Then a `suppress` rule: `permanent === true` writes DNC with `reason = 2 (BOUNCED)`;
soft/temporary increments a counter and only suppresses past a threshold; `autoreply`
never suppresses.

**Deliberately do not port** the transport half — `Fetcher.php`, `Mailbox.php`,
`Organizer/`. That is IMAP polling of a monitored inbox, which made sense before
providers had webhooks. We take classification from provider callbacks (Resend/SES
`bounce`+`complaint`, Twilio status callbacks, WhatsApp delivery failures) and map the
provider's own reason string onto the 16 categories. Keep `DsnParser.php` as a
*reference* for the RFC-3464 status codes if a provider ever hands us a raw DSN.

---

### 1.3 `MessageQueue` → the retry ledger our Flows engine is missing

**Mautic:** `app/bundles/ChannelBundle/Entity/MessageQueue.php`
(+ `Model/MessageQueueModel.php`)

```php
STATUS_PENDING / STATUS_SENT / STATUS_RESCHEDULED / STATUS_CANCELLED
PRIORITY_HIGH = 1, PRIORITY_NORMAL = 2
attempts, maxAttempts, scheduledDate, lastAttempt, dateSent, success, options[]
channel + channelId
```

Indexed on `status`, `scheduled_date`, `priority`, `success`, `(channel, channel_id)`.

**Why it is good.** A send is a *durable row with a lifecycle*, not a function call
that either works or throws. `attempts` vs `maxAttempts` bounds retry. `rescheduled`
is distinct from `pending` so a deliberate deferral (frequency cap hit, quiet hours,
provider 429) is not confused with a first attempt. `success` is separate from
`status` because a message can be `sent` and still have failed downstream.

**Our gap.** The automation audit found `fail()` terminates a run permanently with no
retry and no failure ledger. A provider blip is currently indistinguishable from a
genuine dead end, and unrecoverable either way. Mautic additionally has
`campaign_lead_event_failed_log` + a `resume-stuck` command; the queue table is the
more general fix and subsumes both.

**Port.** `outbound_messages` table mirroring those columns, plus `account_id` and RLS.
`scheduled_date` + `priority` + `status` become the claim query; wrap the claim in
`for update skip locked` so concurrent workers don't double-send — Mautic serializes on
a single cron and doesn't need this, we do. Retry with exponential backoff on
`lastAttempt`. This also finally decouples "flow decided to send" from "provider
accepted it", which is what makes idempotent redelivery possible.

---

### 1.4 `AuditLog` → accountability

**Mautic:** `app/bundles/CoreBundle/Entity/AuditLog.php`

```php
userId, userName, bundle, object, action, details (array), ipAddress, dateAdded
indexes: (object, object_id), (bundle, object, action, object_id), (date_added)
```

**Why it is good.** Note `userName` stored *alongside* `userId` — deliberately
denormalized so the log still reads correctly after the user is deleted. That is the
detail people miss on their first audit-log design and it is exactly what a GDPR
erasure request will otherwise destroy. The `timeline_search` composite index is
shaped for "show me this record's history", which is the only query anyone actually runs.

**Our gap.** No audit log at all. For a multi-tenant CRM where four roles mutate shared
customer data, this is table stakes — and the platform audit flagged no GDPR/DPDP
erasure path while we store message bodies and AI transcripts.

**Port.** `audit_log` table with `account_id`, `actor_id`, `actor_name` (denormalized,
per above), `entity_type`, `entity_id`, `action`, `changes jsonb`, `ip`, `created_at`.
Write from a single helper in `src/lib/data/`. Insert-only: revoke `update`/`delete`
even for service-role, or it is theatre rather than evidence.

---

## 2. Tier 2 — port the pattern, rewrite for our stack

### 2.1 `FrequencyRule` → send caps, quiet hours, preferred channel

**Mautic:** `app/bundles/LeadBundle/Entity/FrequencyRule.php`, table
`lead_frequencyrules`

```php
frequencyNumber (smallint) + frequencyTime (DAY|WEEK|MONTH)
channel, preferredChannel (bool)
pauseFromDate, pauseToDate
```

**Why it is good.** Three separate real-world needs in one small table: "no more than
N messages per period" (fatigue), "don't contact between these dates" (holds,
vacations, quiet hours), and "this contact prefers WhatsApp over email" (channel
routing). All *per contact and per channel*.

**Our gap.** Nothing equivalent. Combined with the missing WhatsApp suppression this
is the other half of the WABA quality-rating exposure — nothing stops a flow plus a
broadcast plus an AI auto-reply all hitting one person the same hour.

**Port.** `contact_frequency_rules` keyed on `(account_id, contact_id, channel)`.
Evaluate in the same `consent.ts` gate as DNC so there is one chokepoint, and on a
cap hit write `status = 'rescheduled'` into `outbound_messages` (§1.3) rather than
dropping the send. Quiet hours must resolve in the **tenant's** timezone — the
automation audit already found we compare schedule times in server-local UTC, and
this would inherit the same bug for free if we're not careful.

### 2.2 Reusable segments with per-filter query builders

**Mautic:** `app/bundles/LeadBundle/Segment/` — `Query/Filter/*QueryBuilder.php`
(9 builders: `BaseFilterQueryBuilder`, `ForeignValueFilterQueryBuilder`,
`ForeignFuncFilterQueryBuilder`, `ComplexRelationValueFilterQueryBuilder`,
`DoNotContactFilterQueryBuilder`, `ChannelClickQueryBuilder`,
`SessionsFilterQueryBuilder`, `IntegrationCampaignFilterQueryBuilder`),
plus `Decorator/` and `ContactSegmentService.php`.

**Why it is good — and the part worth stealing is not the filters.** It is
`ContactSegmentService`: membership is maintained **incrementally**. There are
distinct paths for `getNewLeadListLeads()` (limit default 1000), `hasNewLeadListLeads()`,
and `getOrphanedLeadListLeads()` — contacts that *no longer* qualify — all taking
`$batchLimiters`. Segments are never fully recomputed. That is what lets a segment
over millions of contacts stay live on cheap hardware, and it is the design decision
that matters at scale. One `FilterQueryBuilderInterface` per *filter shape* (not per
field) is the secondary lesson: it keeps SQL generation testable, which is why
there's a matching test file for each.

**Our gap.** A single `is / is_not / contains` filter trapped inside one broadcast.
Not reusable, not composable, not incrementally maintained.

**Port.** `segments` + `segment_contacts` (materialized membership) + a
`SegmentFilter` discriminated union in TS, one builder function per filter shape
emitting parameterized SQL. Add/orphan reconciliation runs on the same tick as the
rest of the scheduler. **Never** interpolate filter values — Mautic's builders all go
through DBAL parameter binding, and that discipline is the whole reason a
user-defined-filter feature isn't an injection hole.

### 2.3 `SyncJudge` → conflict adjudication for two-way sync

**Mautic:** `app/bundles/IntegrationsBundle/Sync/SyncJudge/SyncJudge.php`
+ `Modes/{HardEvidence,BestEvidence,FuzzyEvidence}.php`,
`Exception/ConflictUnresolvedException.php`

```php
if ($left->getNewValue() === $right->getNewValue()) return $left;  // short-circuit
match ($mode) { HARD_EVIDENCE => …, BEST_EVIDENCE => …, default => FuzzyEvidence… }
```

**Why it is good.** Bidirectional sync conflicts are named, tiered, and *allowed to
fail loudly* via `ConflictUnresolvedException` instead of silently last-write-wins.
Hard evidence = both sides have real change timestamps; best = one side does; fuzzy =
neither, so infer. The equality short-circuit before any adjudication is the cheap win.

**Our gap.** `external-sources` has no conflict model. Fine today because sync is
effectively one-way; it becomes a data-corruption bug the moment it isn't.

**Port when we build two-way CRM sync, not before.** Three-mode adjudication + an
explicit unresolved state that surfaces to a human. Worth reading now so the field
metadata needed to adjudicate (per-field `modified_at`) gets recorded from day one —
retrofitting change timestamps later is the expensive part.

### 2.4 `own` vs `other` in the permission model

**Mautic:** `app/bundles/CoreBundle/Security/Permissions/AbstractPermissions.php`

```php
// addStandardPermissions()
'view' => 4, 'edit' => 16, 'create' => 32, 'delete' => 128, 'full' => 1024
// the extended variant
'viewown' => 2, 'viewother' => 4, 'editown' => 8, 'editother' => 16,
'create' => 32, 'deleteown' => 64, 'deleteother' => 128, 'full' => 1024
```

**Why the semantic is good.** `viewown` / `viewother` / `editown` / `editother` /
`deleteown` / `deleteother` — ownership is a first-class dimension of authorization,
orthogonal to the verb. That is the near-universal CRM requirement our four-rung
ladder cannot express: *an agent may edit the contacts assigned to them, and only
those.* Today `agent` is uniform across every row in the account.

**Port the semantic; refuse the mechanism.** The bitwise integers are a 2011
optimization for cramming permissions into one column and have no place here. In our
stack "own" is a predicate on a row, so it belongs in **RLS policies** keyed off
`contacts.assigned_to`/`owner_id`, next to `is_account_member()` — which is already
the enforcement boundary per our security rules. Add `is_account_member_or_owner(...)`
style helpers rather than a permissions bitmask table.

### 2.5 `IpAddress` with cached lookup details

**Mautic:** `app/bundles/CoreBundle/Entity/IpAddress.php` — `ipAddress` + `ipDetails`
(array), indexed on `ip_address`.

Small but worth noting: GeoIP results are cached in-row rather than re-queried, and IPs
are a shared lookup table referenced by other records. If we start recording request
IPs for the audit log (§1.4), do it this way rather than denormalizing geo data onto
every row.

---

## 3. Sequencing

Ordered by exposure, not by effort. Items 1–3 are all compliance-facing and share the
`consent.ts` chokepoint, so they want to land together.

| # | Work | Pulls from | Why now |
|---|------|-----------|---------|
| 1 | `contact_do_not_contact` + single `consent.ts` gate on all send paths | §1.1 | Closes the unfiltered WhatsApp broadcast hole |
| 2 | Bounce/complaint webhook ingest + 16-category classifier | §1.2 | Stops infinite retry on hard bounces |
| 3 | `contact_frequency_rules` (caps + quiet hours, tenant TZ) | §2.1 | Other half of the WABA exposure |
| 4 | `outbound_messages` queue; retire terminal `fail()` | §1.3 | Makes sends retryable and idempotent |
| 5 | `audit_log` (insert-only) + GDPR erasure path | §1.4 | Enterprise + regulatory table stakes |
| 6 | Reusable segments, incremental membership | §2.2 | Unblocks real campaigns |
| 7 | Ownership-aware RLS (`own` vs `other`) | §2.4 | Needed before larger teams |
| 8 | `SyncJudge` adjudication | §2.3 | Only when sync goes two-way |

Note that 1–4 all pass through the same send pipeline. Doing them as one coherent
pass through `consent.ts` + `outbound_messages` is materially less work than four
separate passes, and avoids shipping three more hand-rolled filters.

---

## 4. Cross-cutting lessons (no file to copy)

Patterns visible across bundles that are worth adopting as conventions:

- **Enums over booleans for anything with a reason.** `DoNotContact::$reason`,
  `MessageQueue::STATUS_*`, `Type::HARD` — Mautic reaches for a small int/string enum
  where we habitually reach for a bool. Every one of our booleans that will later need
  a "why" is a future migration.
- **Denormalize what must survive deletion.** `AuditLog::$userName` beside `$userId`.
- **Batch limiters on every bulk path.** `ContactSegmentService` never offers an
  unbounded query. Our `resumeWaitingRuns()` `.limit(50)` is the same instinct applied
  with a badly chosen constant and no continuation.
- **A test file per unit of generated SQL.** Every `*FilterQueryBuilder` has a
  matching `Tests/` file. Cheap insurance for user-defined-filter features.
- **Provenance on every derived record.** `channel` + `channelId` on DNC,
  `(channel, channel_id)` on MessageQueue. Always record what caused a row.

---

## 5. Refuse — and why

Enumerated so nobody re-proposes these after reading the audit.

| Mautic asset | Refuse because |
|---|---|
| `PointBundle` (scoring) | Marketing-funnel construct. Our qualification signal is AI conversation analysis, which is strictly richer. Adding points invents a second, worse truth. |
| `ReportBundle` (~128 files) | Generic user-defined report builder. Enormous surface for a need better met by a handful of purpose-built dashboards. |
| Column-per-custom-field (`lead_fields` DDL-altering) | Actively harmful multi-tenant: schema mutation per tenant field. Use `jsonb` + our existing `module-fields`. |
| Bitwise permission integers | 2011 storage optimization. Take `own`/`other` (§2.4), express it in RLS. |
| `MonitoredEmail/` transport (`Fetcher`, `Mailbox`, `Organizer`) | IMAP polling predates provider webhooks. Keep the classifier (§1.2), drop the mailbox. |
| Twig theme/template system | We have React + our own Template Studio. |
| `CampaignBundle` executioner wholesale | Our Flows engine is *better* on idempotency, webhook security and tenancy. Take only `campaign_lead_event_failed_log` + `resume-stuck`, both subsumed by §1.3. |

---

## 6. Bottom line

The valuable thing in Mautic is not its architecture — ours is more modern on almost
every axis that matters (typed end-to-end, RLS-enforced tenancy, real AI, two-way
conversational inbox). The valuable thing is its **accumulated operational knowledge
about the boring, unglamorous edges of sending messages to real people**: which
bounces are permanent, why a suppression happened, how often one human should be
contacted, and what happens on the fourth failed attempt.

That knowledge is concentrated in perhaps six small files. `CategoryMapper.php`,
`DoNotContact.php`, `MessageQueue.php`, `FrequencyRule.php`, `AuditLog.php`, and
`ContactSegmentService.php` are worth more to this codebase than the other ~3,900 PHP
files combined — and all six are Tier 1 or Tier 2 above.

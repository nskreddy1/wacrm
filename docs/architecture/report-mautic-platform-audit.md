# Report — Mautic whole-platform audit vs. wacrm

Date: 2026-08-20 · Scope: **entire Mautic application**, not just campaign automation.
Companion doc: `report-mautic-automation-audit.md` (deep dive on the campaign/Flows engine only).

## 1. Method

`github.com/mautic/mautic.git` was cloned to `/tmp/mautic-src` (branch `5.x`) and read
directly — bundle inventory, Doctrine entities, console commands, permission classes,
segment query builders, and the integrations sync engine. Our side was read from `src/`,
`supabase/migrations/`, and the generated `database-schema.md`. Every claim below is
grounded in a file that was actually opened; nothing is inferred from Mautic's marketing
docs.

Counting convention: "files" = `.php` files inside the bundle.

## 2. Mautic at a glance

29 core bundles + 12 bundled plugins, ~3,900 PHP files.

| Bundle | Files | What it owns |
| --- | --- | --- |
| CoreBundle | 768 | framework, theming, maintenance/GDPR jobs, IP store |
| LeadBundle | 754 | contacts, companies, segments, custom fields, DNC, frequency rules, import/export, dedupe |
| EmailBundle | 326 | email send, A/B variants, stats, bounce/IMAP monitoring |
| CampaignBundle | 303 | campaign builder + executioner/scheduler |
| IntegrationsBundle | 297 | bidirectional CRM sync with conflict resolution |
| FormBundle | 197 | inbound forms, fields, actions, submissions |
| UserBundle | 138 | users, roles, granular permissions, invites |
| PageBundle | 129 | landing pages, web tracking (`Hit`), redirects, trackables |
| ReportBundle | 128 | user-defined report builder + scheduler |
| SmsBundle | 92 | one-way SMS blast |
| PointBundle | 87 | lead scoring, triggers, score groups |
| PluginBundle | 82 | plugin lifecycle |
| AssetBundle | 70 | gated file downloads |
| ApiBundle | 65 | REST API + OAuth2 clients (61 API controllers repo-wide) |
| WebhookBundle | 59 | outbound webhooks with durable queue + log |
| NotificationBundle | 58 | web/mobile push |
| ChannelBundle | 55 | channel registry, **MessageQueue**, broadcast fan-out |
| DynamicContentBundle | 49 | on-site personalization |
| StageBundle | 36 | linear lifecycle stages |
| Others | ~450 | Config, Category, Dashboard, Stats, Project, Messenger, Install, Cache, Queue, Marketplace |
| Plugins | ~310 | Social, Crm (SF/Dynamics/Hubspot/Zoho), Focus, GrapesJS builder, Clearbit, FullContact, Gmail, Outlook, Zapier |

## 3. The two products are not the same category

This is the single most important framing, and it governs every recommendation below.

**Mautic is a marketing automation platform.** Its centre of gravity is *outbound
email at scale to anonymous-then-identified web traffic*: land a visitor on a page,
track them, capture them with a form, score them, segment them, drip email at them,
and sync the result to someone else's CRM. It has no conversation model, no inbox, no
deals, no AI, and no multi-tenancy.

**wacrm is a conversational AI sales CRM.** Its centre of gravity is *two-way
WhatsApp/email conversations that an AI triages and a salesperson closes*: message
arrives, AI classifies and either auto-replies or hands off, contact becomes a deal,
deal moves through a pipeline, appointment gets booked.

Functional overlap is roughly **35%** — contacts, custom fields, segmentation intent,
broadcast sending, webhooks, and workflow automation. The other 65% on each side does
not exist on the other. So "catch up to Mautic" is the wrong goal; the right goal is
to close the specific gaps that block *our* sales loop or expose us to compliance risk,
and to deliberately skip the rest.

## 4. Domain-by-domain comparison

### 4.1 Contacts / leads

| | Mautic | wacrm |
| --- | --- | --- |
| Core entity | `Lead` + 20 satellite entities | `contacts` + `contact_custom_values` |
| Company/B2B | `Company`, `CompanyLead`, `CompanyChangeLog` | `contacts.company` free text only |
| Change history | `LeadEventLog`, `PointsChangeLog`, `StagesChangeLog`, `CompanyChangeLog` | `audit_events` (generic) |
| Dedupe | `MergeRecord` entity + `DeduplicateCommand` | `lib/dedupe.ts`, import-time only |
| Import/export | `Import` entity, `ImportCommand`, `ContactExportScheduler` | CSV import in UI |
| Devices | `LeadDevice` | — |
| Attribution | `UtmTag` entity | `contacts.source`, `source_detail`, `campaign` |

**Gap that matters:** no **Company** object. Our pipelines sell to a `contact`, so a
five-person buying committee at one account is five unrelated rows. That is a real
B2B sales limitation, not a parity checkbox.

### 4.2 Custom fields

Mautic's `LeadField` supports ~16 typed field types — `text, textarea, select,
multiselect, boolean, date, datetime, email, number, tel, url, lookup, country,
region, timezone, locale` — with per-type validation and each field materialized as a
real column.

Ours: `custom_fields(field_name, field_type default 'text', field_options jsonb)` with
values in `contact_custom_values`. The EAV shape is the right call for multi-tenant
(Mautic's column-per-field design is a known migration hazard), but **`field_type` is
effectively decorative** — there is no typed validation or coercion on write, so a
`date` field will happily store `"next tuesday"`.

### 4.3 Segmentation

Mautic: `LeadList` + `ListLead` with a filter compiler in `LeadBundle/Segment/Query/`
carrying nine specialised builders — `DoNotContactFilterQueryBuilder`,
`ChannelClickQueryBuilder`, `SessionsFilterQueryBuilder`,
`ForeignValueFilterQueryBuilder`, `ComplexRelationValueFilterQueryBuilder`,
`IntegrationCampaignFilterQueryBuilder`, plus date decorators (Day/Week/Month/Year).
Membership is materialized and rebuilt by `UpdateLeadListsCommand`, with
`SegmentCountCacheCommand` for counts.

Ours: `broadcasts.audience_filter` jsonb, driven by `step2-select-audience.tsx`, which
supports `all | tags | custom_field | csv | external`. The `custom_field` branch is a
**single** filter with `is | is_not | contains`.

**Gaps:** no saved reusable segment entity (a filter is trapped inside one broadcast
and cannot be reused by Flows), no AND/OR grouping, no behavioral filters ("opened a
message in last 7 days", "never replied"), no materialized membership or recount.
Segmentation is the connective tissue between contacts and every outbound feature, so
this gap suppresses the value of broadcasts *and* Flows simultaneously.

### 4.4 Consent, suppression, and deliverability — **highest-risk area**

Mautic:
- `DoNotContact` entity, **per channel**, with a reason taxonomy:
  `IS_CONTACTABLE=0, UNSUBSCRIBED=1, BOUNCED=2, MANUAL=3`, plus a free-text comment.
- `FrequencyRule` per contact per channel: `frequencyNumber`, `frequencyTime`
  (DAY/WEEK/MONTH), `preferredChannel`, `pauseFromDate`/`pauseToDate`.
- `EmailBundle/MonitoredEmail/` — a full IMAP pipeline: `Fetcher`, `Mailbox`, and
  processors for `Bounce` (with `BodyParser` + `Definition/Category|Rule|Type`),
  `FeedbackLoop`, `Reply`, `Unsubscription`.
- Maintenance/GDPR commands: `AnonymizeIp`, `RemoveAnonymousContacts`,
  `UpdateDoNotSellList` (CCPA), `CleanupMaintenance`.

Ours: two booleans on `contacts` — `sms_opted_out` and `email_opted_out` (+ `_at`),
added by `051_sms_opt_out.sql` and `20260726090000_email_opt_out.sql`. Both are
correctly present in the live schema (no doc drift).

Verified defects:

1. **`/api/whatsapp/broadcast` applies no opt-out filter at all.** `/api/sms/broadcast`
   filters on `sms_opted_out` (line 152) and `/api/email/broadcast` on
   `email_opted_out` (line 169) — but the WhatsApp route, our *primary channel*, has
   no equivalent. There is also no `whatsapp_opted_out` column to filter on. Meta
   policy requires honouring opt-out, and repeated sends to opted-out users degrade
   the WABA quality rating and can get the number restricted.
2. **The Flows engine never checks consent.** `src/features/flows/lib/engine.ts`
   contains no `opt_out`/`consent` reference, so a Flow send bypasses the suppression
   the broadcast routes enforce. This is the same finding as the automation audit and
   is independent of channel.
3. **No bounce or complaint ingestion anywhere.** Nothing in `src/` processes a
   Resend/SMTP/Twilio bounce or spam-complaint callback into suppression. Hard bounces
   therefore retry forever, which is the fastest route to a poisoned sending domain.
4. **No reason taxonomy.** A boolean cannot distinguish *unsubscribed* (must honour
   forever) from *bounced* (may be transient) from *manual* (support-set). Once these
   are conflated they cannot be separated retroactively.
5. **No data-retention or erasure tooling.** No anonymize/purge job, so a GDPR or
   India DPDP erasure request has no code path — a live exposure given the app already
   stores message bodies and AI transcripts.

### 4.5 Channels, queueing, and throughput

Mautic's `ChannelBundle` has a `MessageQueue` entity — `channel`, `channelId`, `event`,
`lead`, `priority`, `maxAttempts` (default 3), `attempts`, `success`, `status`,
`scheduledDate`, `lastAttempt`, `dateSent`, `processed`, `failed` — drained by
`ProcessMarketingMessagesQueue`, with `SendChannelBroadcast` for fan-out.

Ours: adapters for `meta`, `resend`, `smtp`, `twilio`, `twilio-sms`, `mailtrap` (a
genuinely clean adapter layer), and `broadcast_recipients` rows written directly with
`status/sent_at/delivered_at/read_at/replied_at/error_message`.

**Gaps:** no priority, no retry/attempt ledger, no scheduled per-message dispatch, and
**no frequency capping** — a contact in three Flows plus a broadcast can receive four
messages in a minute with nothing to stop it. `broadcast_recipients` is a per-broadcast
result table, not a cross-channel queue, so throughput and retry cannot be reasoned
about globally.

### 4.6 Inbound capture — the biggest funnel gap

Mautic `FormBundle` (`Form`, `Field`, `Action`, `Submission`) + `PageBundle` (`Page`,
`Hit` with ~25 columns incl. IP/geo/referer/UTM/device, `Redirect`, `Trackable`,
`VideoHit`) + `AssetBundle` (gated `Download`) + `DynamicContentBundle`.

Ours: **nothing.** We have no landing page, no form builder, no web tracking, no
gated-asset capture.

Consequence: wacrm can only *react* to contacts who already messaged us, or to a CSV.
It cannot **originate** a lead. The `contacts.source`/`campaign` columns exist but
nothing populates them from a real acquisition surface. For a product whose stated
V1 loop begins at "lead capture", this is the largest functional hole in the app —
larger than any automation defect.

### 4.7 Automation

Covered in depth in `report-mautic-automation-audit.md`. One-line summary: our Flows
engine beats Mautic on idempotency, webhook security, and tenant isolation, but its
time-driven half is inert in production because `vercel.json` ticks the cron **once
daily** while the engine assumes ~5-minute ticks; plus no retry/failure ledger where
Mautic has `FailedLeadEventLog` and `ResumeStuckCampaign`.

### 4.8 Scoring and lifecycle

Mautic: `PointBundle` (`Point`, `Trigger`, `TriggerEvent`, `LeadPointLog`,
`LeadTriggerLog`, `Group`, `GroupContactScore`, `PointInsight`) and `StageBundle`
(`Stage`, `LeadStageLog`).

Ours: no score field anywhere. For lifecycle we have `pipelines` / `pipeline_stages` /
`deals` / `sub_pipelines` / `deal_items` — which is **better** than Mautic's linear
`Stage` for actual selling, since a deal has value, owner, and items.

Scoring is a genuine absence, but it is a *marketing* prioritisation tool. Our
equivalent lever is the AI assistant classifying intent, which is arguably more useful
and already exists. Low priority.

### 4.9 Reporting

Mautic `ReportBundle`: a user-defined report builder — `source`, `columns`, `filters`,
`tableOrder`, `graphs`, `groupBy`, `aggregators`, plus scheduling
(`isScheduled`, `toAddress`, `scheduleUnit`, `scheduleDay`, `scheduleMonthFrequency`)
and a `Scheduler` entity.

Ours: `dashboards` with fixed widgets (KPI, funnels, volume, team performance,
lead sources) plus a custom widget renderer and `add-widget-dialog`. Good-looking and
purpose-built, but the set of questions is fixed at build time — a user cannot ask a
new one, and nothing can be emailed on a schedule.

### 4.10 Integrations

Mautic `IntegrationsBundle/Sync/` is the most sophisticated subsystem in the codebase:
`SyncJudge` (+ `Modes`) for **conflict resolution** when both sides changed a field,
`SyncProcess/Direction`, `DAO/Mapping`, `ValueNormalizer`, `VariableExpresser`,
`Notification/Handler`, and internal/external data exchanges — i.e. real bidirectional
sync. Plus CRM plugins for Salesforce, Dynamics, HubSpot, Zoho.

Ours: `src/features/integrations/lib/` (`execute`, `run`, `statement`, `bindings`,
`context`) plus `external-sources` — an outbound operation runner. Useful, but there is
no field mapping layer, no conflict resolution, and no inbound sync. We also ship an
**MCP server**, which Mautic has no analogue for.

### 4.11 Users, roles, and permissions

Mautic: `UserBundle` with `Role`, `Permission`, `UserInvite`, `UserToken`, and **15+
per-bundle permission classes** (`AbstractPermissions` + `Campaign/Lead/Email/Form/
Page/Report/Asset/Api/...Permissions`) expressing `view|edit|create|delete|publish`
crossed with `own|others`.

Ours: a 4-role ladder (owner → admin → agent → viewer) enforced at the **RLS layer**
via `is_account_member(account_id, roles[])` on all 88 tables — architecturally the
safer design, since the database is the boundary rather than the controller.

Gap: no object-level or own-vs-others granularity. "Agents may only see contacts
assigned to them" is not expressible today, and it is a routine enterprise
requirement.

### 4.12 API and webhooks

| | Mautic | wacrm |
| --- | --- | --- |
| REST surface | 61 API controllers, near-total entity coverage | 27 `/api/v1` routes |
| Auth | OAuth2 clients + basic | `api_keys` (SHA-256 hashed) |
| Webhook durability | `WebhookQueue` + `Log` + retry | `webhook_endpoints`; **no delivery log / retry table** |
| Webhook security | weaker | HMAC signing (`sign.ts`) + **SSRF guard** (`ssrf.ts`) |

We are ahead on webhook *security* and behind on webhook *durability* — a failed
delivery is not recorded or retried.

## 5. Where wacrm is decisively ahead

These are not parity items; they are things Mautic cannot do at all.

1. **AI-native throughout.** RAG knowledge base (`chunk`, `embeddings`,
   `knowledge`), auto-reply with deterministic precedence, sticky handoff +
   `handoff-watchdog`, `persona`, multi-provider engines (OpenAI/Anthropic/Gemini +
   LangChain), `model-catalog`, `crm-context`, usage metering. Mautic has **zero** AI.
2. **Two-way conversational inbox.** Realtime WhatsApp threads with reactions, quick
   replies, templates, media, 24-hour-window handling. Mautic's `SmsBundle` is a
   one-way blast; there is no conversation entity anywhere in it.
3. **Real multi-tenancy.** `account_id` + RLS on all 88 tables with `SECURITY DEFINER`
   helpers. Mautic has no tenant concept — one install, one org.
4. **An actual sales CRM.** Pipelines, deals, sub-pipelines, deal items, tasks,
   appointments, catalog. Mautic stops at `Stage` and points.
5. **Team collaboration + support desk.** `team_chat`, `presence`, read cursors,
   `support_tickets`, `ai_support_requests`. No Mautic equivalent.
6. **SaaS platform ops.** `plans`, `usage_counters`, `account_limit_overrides`,
   `platform_settings`, `audit_events`, provider policies.
7. **MCP server** — the CRM is addressable by agents.
8. **Engineering hygiene.** Typed TS end to end, 913 tests, enforced import
   boundaries, generated schema docs. Mautic is a 3,900-file PHP monolith.

## 6. Gaps we should deliberately NOT close

Porting these would cost months and contradict the product thesis:

- `PointBundle` scoring wholesale — the AI already ranks intent better.
- `ReportBundle`'s 128-file report engine — build 3–4 saved-query views instead.
- `AssetBundle`, `DynamicContentBundle`, `MarketplaceBundle`, `PluginBundle`,
  `ProjectBundle`, `StageBundle`.
- Mautic's column-per-custom-field design — actively worse for multi-tenant.
- Its IP-geolocation/MaxMind stack and Twig theme builder.
- Its `Hit`-based full web-analytics warehouse (a lightweight capture surface is
  worth far more to us than a rebuilt analytics product).

## 7. Findings ledger

Ranked by risk, with the specific evidence.

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| 1 | **P0** | WhatsApp broadcast sends to opted-out contacts — no filter, and no `whatsapp_opted_out` column exists | `api/whatsapp/broadcast/route.ts` vs. sms:152 / email:169 |
| 2 | **P0** | Flows engine bypasses all consent checks on every channel | `flows/lib/engine.ts` — no `opt_out` reference |
| 3 | **P0** | Scheduled Flows/waits inert: daily cron vs. ~5-min engine assumption | `vercel.json`; automation audit |
| 4 | **P0** | No bounce/complaint ingestion → hard bounces retry forever | no handler in `src/` |
| 5 | **P0** | No GDPR/DPDP retention or erasure path | no purge/anonymize job |
| 6 | **P1** | No message queue: no retry, priority, or frequency capping | `broadcast_recipients` only |
| 7 | **P1** | No inbound capture surface (forms/landing pages) — cannot originate a lead | no equivalent of Form/PageBundle |
| 8 | **P1** | Consent is a boolean; no unsubscribed/bounced/manual taxonomy | `contacts.*_opted_out` |
| 9 | **P1** | No reusable segments; filters trapped per-broadcast, single condition, no AND/OR | `step2-select-audience.tsx` |
| 10 | **P2** | No Company/B2B object — buying committees fragment | `contacts.company` text |
| 11 | **P2** | `custom_fields.field_type` unvalidated on write | `custom_fields` + `contact_custom_values` |
| 12 | **P2** | Webhook deliveries not logged or retried | `webhook_endpoints`; no delivery table |
| 13 | **P2** | No own-vs-others permission granularity | 4-role enum |
| 14 | **P3** | No A/B testing on templates or broadcasts | Mautic `variantSettings` |
| 15 | **P3** | Reporting fixed at build time; nothing schedulable | `features/dashboards` |
| 16 | **P3** | No bidirectional sync / field mapping / conflict resolution | `integrations/lib` |

## 8. Recommended sequence

**Sprint 1 — stop the bleeding (P0 compliance + correctness).**
Add `whatsapp_opted_out`; introduce one `consent` gate module and call it from *every*
send path including the Flows engine; fix the cron cadence per the automation audit;
ingest Resend/Twilio bounce + complaint callbacks into suppression; ship an account
purge/anonymize job. Nothing here is large — the risk is that each is individually
easy to keep postponing.

**Sprint 2 — durable sending.**
A real `message_queue` table (priority, attempts, max_attempts, scheduled_at,
last_error) draining on the same tick as Flows; per-contact-per-channel frequency
caps; webhook delivery log with retry. This also retires finding #6's throughput
blind spot.

**Sprint 3 — segments as a first-class object.**
`segments` + `segment_members` with AND/OR groups, a handful of behavioral filters,
materialized membership with recount. Then repoint broadcasts *and* Flow entry at it.
This is the highest-leverage feature work in the list because two subsystems
immediately get better.

**Sprint 4 — inbound capture.**
A minimal hosted form + landing page that writes `contacts` with real
`source`/`campaign` attribution and can trigger a Flow. Deliberately scoped as a
capture surface, not an analytics product.

Consent taxonomy (#8) folds into Sprint 1; Company (#10) and typed custom fields (#11)
are natural Sprint 5 candidates. Findings #14–16 should stay parked until a customer
actually asks.

## 9. Verdict

Our application is **not behind Mautic** — it is a different, more modern product that
is ahead on AI, conversation, tenancy, and sales mechanics, and behind on the boring
infrastructure that makes outbound messaging safe and scalable: consent enforcement,
suppression, queueing, and segmentation. Mautic's value to us is as a **specification
for that infrastructure**, written by a project that learned it the hard way over a
decade — not as a feature list to match.

The urgent items are all in §7 rows 1–5, and they are urgent because they are
regulatory and reputational rather than functional: nothing in the UI looks broken
today while we message people who asked us to stop.

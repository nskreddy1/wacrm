# Automation Engine Audit — wacrm Flows vs. Mautic Campaigns

**Date:** 2026-08-20
**Reference:** `github.com/mautic/mautic` (cloned to `/tmp/mautic-src`, `CampaignBundle` + `LeadBundle` + `PointBundle`)
**Subject:** `src/features/flows/**`, `src/app/api/flows/**`, `supabase/migrations/010_flows.sql`, `20260724230000_workflows_unification.sql`, `vercel.json`

---

## 1. Executive summary

Mautic's campaign engine is a **batch, contact-set executioner**: a scheduler
resolves *when* each event is due per contact, an executioner walks batches of
contacts through the event tree, and every attempt is logged with a
retry/failure ledger. Our Flows engine is a **conversation-driven state
machine**: it suspends at nodes that need customer input and is woken by an
inbound webhook.

Those are legitimately different designs, and for the WhatsApp-first use case
ours is the better fit. The problem is that the Workflows unification bolted
*time-driven* automation (wait nodes, scheduled triggers) onto a
conversation-driven runner **without adding the scheduling infrastructure that
makes time-driven automation work**. The result is a set of features that exist
in the UI and the schema but do not reliably execute in production.

**Verdict: the conversation half of the engine is sound; the time-driven half is
not production-functional.** Five findings are release-blocking.

| Area | Mautic | wacrm Flows | Status |
| --- | --- | --- | --- |
| Node graph + validation | Event tree, `decisionPath` | `flow_nodes` + `validateFlowForActivation` (reachability, ref resolution) | Comparable |
| Idempotency / concurrency | DB-level, per event log | `meta_message_id` dedupe, optimistic `current_node_key` UPDATE, partial unique index | **Stronger than Mautic** |
| Credential handling on outbound HTTP | Basic | SSRF guard, `base_url` scoping, GCM-encrypted secrets, header-spoof stripping | **Stronger than Mautic** |
| Time-driven scheduling | `Scheduler/Mode/Interval` + `mautic:campaigns:trigger` (minutely) | Vercel cron, **once daily** | **Broken** |
| Failure retry | `campaign_lead_event_failed_log` + reschedule + `resume-stuck` | `fail()` → run ends, no retry | **Missing** |
| Audience / segmentation | `ContactSegmentService`, 30+ filter types | Hardcoded "conversation in last 24h", cap 50 | **Missing** |
| Concurrent membership | Contact in N campaigns | 1 active run per contact, enforced by unique index | **Regression risk** |
| Negative / inactive path | `InactiveExecutioner`, decision non-action branch | Only global `fallback_policy` | **Missing** |
| Per-node analytics | `campaign_summary` per event | `flows.execution_count` only | **Missing** |
| Scoring / points | `PointBundle` (groups, triggers, insights) | None | Not planned |
| Report builder | `ReportBundle` + scheduler | None | Not planned |

---

## 2. Release-blocking findings

### F-1 — Cron cadence is 24h; the engine assumes minutes (CRITICAL)

`vercel.json`:

```json
{ "crons": [{ "path": "/api/flows/cron", "schedule": "0 0 * * *" }] }
```

The route's own docstring says *"A 5-minute interval is more than enough… once
per hour would also be acceptable"*. It is configured for **once per day at
00:00 UTC**. Three separate failures fall out of this:

1. **Wait nodes fire up to 24 hours late.** A `wait` node parks the run with
   `status='waiting'` and `wake_at`; `resumeWaitingRuns()` only runs on a tick.
   A "wait 10 minutes then follow up" node can deliver ~23h50m late.
2. **Scheduled triggers effectively never fire.** `startScheduledFlows()` gates
   on `SCHEDULE_WINDOW_MIN = 10` around the flow's configured `HH:mm`. With a
   single 00:00 tick, only flows configured for 23:50–00:10 ever match. Every
   other scheduled flow is silently inert — active, saved, and never executing.
3. **Global throughput ceiling of 50 wakes/day.** `resumeWaitingRuns()` uses
   `.limit(50)`. Once per day × 50 = 50 resumed runs per day **across all
   tenants**. Beyond that, waiting runs accumulate unboundedly.

Mautic's equivalent (`mautic:campaigns:trigger`) is documented to run every
minute for exactly this reason.

**Fix:** `"schedule": "*/5 * * * *"`, and make `resumeWaitingRuns` loop until the
due set is drained (or raise the limit and page by `wake_at`).

### F-2 — Cron secret is not provisioned (CRITICAL)

`authorizeCronRequest` reads `AUTOMATION_CRON_SECRET` and `CRON_SECRET`.
**Neither is present in the project's environment variables.** Depending on the
branch taken in `cron-auth.ts` this either rejects every Vercel cron invocation
(automation dead) or accepts unauthenticated invocations (anyone can drive the
engine). Either way it must be resolved before the cadence fix in F-1 has any
effect. Verify `cron-auth.ts` fails closed, then set the secret.

### F-3 — Scheduled-trigger time is server-local, not tenant-local (CRITICAL)

```ts
const nowMin = now.getHours() * 60 + now.getMinutes();
```

`getHours()` is the **runtime's** timezone (UTC on Vercel). A tenant in IST who
schedules a 09:00 nudge gets it at 14:30 local. Mautic solves this deliberately:
`Interval::getGroupExecutionDateWithTimeZone()` resolves each *contact's*
timezone, with `getDefaultTimezone()` as fallback, and additionally supports
`triggerRestrictedStartHour` / `StopHour` / `DaysOfWeek` so a campaign never
messages someone at 3am.

**Fix:** store an IANA timezone on the account (or contact), compare in that
zone, and add quiet-hours / allowed-weekday restrictions — this is also a
WhatsApp policy concern, not just a UX nicety.

### F-4 — No failure retry and no failure ledger (CRITICAL)

`executeActionNode` returns `fail(reason, detail)` for every error path —
`send_webhook_connection`, `wait_park_failed`, template lookup failure, and so
on — and the caller **ends the run**. A single transient 502 from a customer's
webhook, or one Meta API blip, permanently kills that contact's journey with no
retry and no operator-visible queue.

Mautic carries a dedicated table (`campaign_lead_event_failed_log`, with
`reason`), reschedules failed events, and ships
`mautic:campaigns:resume-stuck` to recover contacts wedged mid-campaign.

**Fix:** distinguish *transient* from *terminal* failures; on transient, park the
run with `wake_at = now + backoff` and an `attempt_count`; add a
`flow_run_failures` table and surface it in the UI.

### F-5 — One active run per contact blocks all other workflows (CRITICAL)

```sql
CREATE UNIQUE INDEX idx_one_active_run_per_contact
  ON flow_runs(user_id, contact_id) WHERE status = 'active';
```

This is excellent concurrency protection for a *conversation* flow — two
simultaneous button taps cannot double-advance. But now that time-driven
automations live in the same table, it means **a contact parked in a 3-day
nurture wait cannot enter any other workflow**, and an inbound keyword flow
cannot start. In Mautic a contact is a member of arbitrarily many campaigns
concurrently (`campaign_leads` membership rows).

**Fix:** scope the exclusivity to what actually needs it — e.g. make the index
`(account_id, contact_id) WHERE status='active' AND awaits_reply = true`, so only
one flow at a time owns the *conversation*, while background/time-driven runs
proceed in parallel.

---

## 3. High-priority gaps

### F-6 — No negative ("inactive") decision path

Mautic's decisions have two outgoing paths: the contact *did* the thing, or a
grace period elapsed and they *didn't* — the latter driven by
`InactiveExecutioner` and `Event::$decisionPath`. Our engine has only a global
per-flow `fallback_policy` (`on_unknown_reply`, `max_reprompts`,
`on_timeout_hours`, `on_exhaust`). You cannot express "if they don't click
within 2 hours, send a reminder; if they don't click within 2 days, mark cold"
— which is the single most common real-world drip pattern.

### F-7 — Scheduled audience is hardcoded, capped, and unsegmentable

`startScheduledFlows` targets "contacts with conversation activity in the last
24h" with `SCHEDULE_AUDIENCE_CAP = 50`. Mautic's entire `LeadBundle/Segment`
subsystem (`ContactSegmentService`, `ContactSegmentFilterFactory`, 30+ operators
compiled to SQL) exists to answer this. Even a v1 needs tag/field/stage/deal
filters as trigger audience, and the 50-contact cap needs to become paged
batching rather than silent truncation.

### F-8 — No per-node execution stats

`flows.execution_count` and `last_executed_at` are the only metrics. Mautic keeps
a `campaign_summary` row per event per day (triggered / scheduled / failed /
non-action). Without per-node counters an operator cannot see *where* a flow
leaks — which is most of the value of a builder.

### F-9 — No throttling or batching

`startScheduledFlows` iterates and sends inline inside a serverless request. No
concurrency bound, no per-account send-rate limit, no resumable cursor. Mautic
formalizes this with `ContactLimiter` (batch size, min/max contact ID, thread
slicing) plus `MaxAllowedRecordsReachedInSingleProcessEvent`. At 50 contacts the
current shape survives; at 5,000 it will exceed the function timeout mid-batch
with no record of where it stopped.

### F-10 — No goto/jump node, so no loops or re-entry

Mautic has `campaign.jump_to_event`. Our validator enforces reachability from
entry but there is no way to route backwards, so "retry the menu", "loop until
valid", and "re-enter after 30 days" are all inexpressible. Related: no campaign
membership model, so no "removed from flow / re-added" semantics and no
rotation.

### F-11 — Opt-out is not consulted by the engine

`grep -rn "opt_out|dnc" src/features/flows/lib/` returns **nothing**, despite
`051_sms_opt_out.sql` and `20260726090000_email_opt_out.sql` existing in the
schema. Mautic gates every channel send on `DoNotContact`. As written, a
scheduled flow will message a contact who has opted out. This is a compliance
exposure, not a feature gap.

---

## 4. Where we are ahead of Mautic

Worth stating plainly, because these should not be regressed while fixing the above:

- **Idempotency design.** Provider-message-ID dedupe + optimistic
  `current_node_key` precondition + partial unique index is a cleaner
  concurrency story than Mautic's log-table checks.
- **Outbound HTTP security.** The `send_webhook` node has an SSRF guard,
  enforces `base_url` as an allow-list prefix, decrypts GCM-stored secrets with
  an explicit `secret_format` column, and strips case-variant header spoofing.
  Mautic's webhook action has none of this.
- **Tenant isolation.** `is_account_member()`-based RLS across `flows`,
  `flow_nodes`, `flow_runs` with service-role-only writes is stricter than
  Mautic's single-tenant permission model.
- **Activation validation.** `validateFlowForActivation` blocks activation on
  unresolved node references and unreachable nodes; Mautic lets you publish a
  broken campaign.
- **Conversation-native primitives.** `send_buttons` / `send_list` /
  `collect_input` / `handoff` with reprompt policy have no Mautic equivalent —
  Mautic is email-first and has no notion of an interactive reply graph.

---

## 5. Recommended sequence

**Sprint 1 — make time-driven automation actually run (F-1, F-2, F-3)**
Change the cron to `*/5 * * * *`; provision `CRON_SECRET` and confirm
`cron-auth.ts` fails closed; drain the waiting queue in a loop instead of
`limit(50)`; add `accounts.timezone` and evaluate schedule windows in it.
*Nothing else on this list matters until flows fire on time.*

**Sprint 2 — durability (F-4, F-11)**
Transient-vs-terminal failure classification, exponential backoff via `wake_at`,
`flow_run_failures` table + UI, and an opt-out/DNC check in front of every send
node.

**Sprint 3 — expressiveness (F-5, F-6)**
Re-scope the active-run unique index to conversation-owning runs; add a
timed negative branch per decision node (`on_no_reply_after` → `next_node_key`).

**Sprint 4 — scale and insight (F-7, F-8, F-9)**
Segment-based trigger audiences reusing the existing tag/field filter helpers;
per-node daily counters; paged batching with a resumable cursor and per-account
send-rate limits.

**Not recommended to port:** `PointBundle` scoring and `ReportBundle`'s report
builder. Both are large surfaces aimed at email marketing funnels and are
orthogonal to a WhatsApp-first CRM; the existing dashboard plus per-node stats
from F-8 covers the real reporting need.

---

## 6. Method note

Mautic was cloned and read directly (`CampaignBundle/Entity/Event.php`,
`Executioner/Scheduler/Mode/Interval.php`, `Entity/FailedLeadEventLog.php`,
`Command/ResumeStuckCampaignCommand.php`, `LeadBundle/Segment/*`,
`PointBundle/Entity/*`) rather than from documentation. It is **not** vendored
into this repository and nothing from it was copied — Mautic is GPL-3.0 and our
codebase is not, so it was used strictly as a behavioural reference for this
audit.

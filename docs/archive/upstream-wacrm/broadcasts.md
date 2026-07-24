# Broadcasts (upstream snapshot)

> Source: https://wacrm.tech/docs/broadcasts
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

Broadcasts sends a single approved template message to a large group of contacts. Pick a template, choose an audience, fill in the variables, schedule a send time, watch the per-recipient delivery roll up.

Use it for product announcements, restock notifications, holiday hours, abandoned-cart nudges — anything that's the same message to many people.

## The 4-step wizard

Hit New broadcast on the list page. A 4-step wizard walks you through:

### Step 1 — Choose template

Picks the WhatsApp template body to send. The list shows approved templates only — drafts and rejected ones are filtered out because Meta won't accept them.

If your template list is empty or stale, sync from Settings → Templates — the sync pulls your latest WABA templates from the Cloud API.

The selected template's body is previewed in the wizard with `{{1}}`, `{{2}}` placeholders intact.

### Step 2 — Select audience

Four ways to pick recipients:

| Mode | What it does |
| --- | --- |
| All contacts | Every contact in your tenant. |
| By tag(s) | One or more tags. AND logic — a contact must have all selected tags to be included. |
| By contact field | Filter on `name` / `email` / `company` with operators `is`, `is not`, `contains`. |
| CSV upload | `.csv` file with a `phone` column (and optional `name`). Phones not in your tenant are skipped — the broadcast only sends to contacts you've already added. |

The wizard shows the estimated recipient count under the picker so you don't accidentally blast 12,000 people instead of 12.

### Step 3 — Personalise

For each `{{1}}`, `{{2}}`, ... placeholder in the template body, pick how to fill it:

- Literal text — same value for every recipient ("Spring sale").
- Contact field — `{{name}}` per recipient, etc. The wizard shows a side-by-side preview using a sampled contact so you can sanity-check before sending.

Templates with header media (image / video / document) also let you upload the asset here. Meta requires the asset to have been sent through your phone number before — the wizard uploads on your behalf.

### Step 4 — Schedule & send

Two radio options:

- Send now — broadcast moves to `sending` immediately.
- Schedule — date + time picker. The broadcast sits in `scheduled` status until the time hits, then transitions to `sending`.

Hit Send broadcast to commit. The wizard closes and you land back on the list page with the new broadcast row visible.

Scheduled sends require the same `/api/automations/cron` drain as Automation Waits — the broadcast row is parked in `broadcast_pending_executions` and the cron fires it at the right time.

## List page

Shows every broadcast you've sent or scheduled. Columns:

| Column | Notes |
| --- | --- |
| Name | What you called it. Click to open the detail view. |
| Template | Which Meta template was used. |
| Recipients | Total count. |
| Delivery | `delivered_count / total_recipients` as a percentage. |
| Read | `read_count / delivered_count` — Meta's read-receipt deliveries. |
| Status | Badge + colour. Pulses while `sending`. |
| Date | When it sent (or is scheduled to send). |

If any broadcast is `sending`, an indeterminate progress bar shows at the top of the list and the page polls every 5 seconds for status updates. Polling pauses when the tab is hidden.

## Statuses

| Status | Means | Next transition |
| --- | --- | --- |
| Draft | Saved from the wizard but never sent. Editable. | → Scheduled or Sending on send. |
| Scheduled | Queued for a future send time. | → Sending when the cron fires. |
| Sending | Actively dispatching to recipients. | → Sent when all recipients have a terminal status. |
| Sent | Every recipient is delivered, read, replied, or failed. | Terminal. |
| Failed | The broadcast itself errored (e.g. template revoked). Individual failed recipients don't bubble up here — just total broadcast failures. | Terminal. |

## Detail view

Click a broadcast name to see:

- Recipient table — every contact, their delivery status, timestamps for each stage (sent → delivered → read → replied), WhatsApp message id.
- Stats — full breakdown of the aggregate counts.
- Filter by recipient status: show me only `failed` so I can retry, or only `replied` to follow up.

Each recipient row links back to the contact + conversation, so a broadcast becomes a launchpad into 1:1 chats with people who replied.

## How delivery tracking works

When a broadcast sends, the engine writes a `broadcast_recipients` row per recipient up front (status: `pending`). For each, it calls the Meta Cloud API, and stores Meta's returned message id on the recipient row.

Then, as Meta sends webhook callbacks (`sent`, `delivered`, `read`, or a customer reply), the webhook handler matches on `message_id` and updates the matching recipient row — and the broadcast's aggregate counter columns in one atomic UPDATE (migration 005 made the counters incremental, not full recomputation).

A customer's reply to a broadcast message also flips the recipient's status to `replied` and routes the inbound to the inbox like any other message.

## Contact deletion behaviour

If you delete a contact who received a broadcast:

- `broadcast_recipients.contact_id` is set to NULL.
- The recipient row survives — aggregate counts are preserved.
- The detail view renders that row as "Unknown contact" with the original phone number.

Mirrors the same "history shouldn't vanish" principle as Pipelines.

## Limits & notes

- Templates only. Broadcasts must use a Meta-approved template — Meta forbids free-form bulk sends. Use the template manager to draft and submit; approval typically takes a few hours.
- Meta's per-phone-number rate cap is the practical ceiling. Cloud API is 80 msg/sec out of the box, ramps to 1000+/sec after quality-rating signals. wacrm doesn't throttle below Meta's cap — it dispatches as fast as the API allows.
- The wizard's CSV upload only adds recipients, not contacts. Phones not already in your tenant are dropped. Use Contacts → Import first if you need to bulk-add new numbers.
- No A/B testing. One template per broadcast. Split your audience and send two broadcasts if you need to compare.
- Editing a sending broadcast isn't supported. Cancel and resend — there's no in-flight pause.
- Quality rating. Bulk broadcasts to disengaged recipients can drag your phone number's quality rating in Meta's eyes, which caps your daily send volume. Tag-segment instead of blasting all contacts.

## Where to file bugs

github.com/ArnasDon/wacrm/issues, label `broadcasts`.

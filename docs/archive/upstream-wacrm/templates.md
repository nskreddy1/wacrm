# Templates (upstream snapshot)

> Source: https://wacrm.tech/docs/templates
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

Templates are the pre-approved messages WhatsApp lets you send outside the 24-hour customer-service window. wacrm builds them, submits them to Meta for approval, tracks their status in real time, and sends them — all without leaving the app.

Templates feed three other surfaces: the composer's template picker in the Inbox, send-template steps in Automations, and the whole Broadcasts module.

New in 0.2.x: templates used to be read-only — you authored them in Meta's WhatsApp Manager and synced them in. You can now create, edit, resubmit, and delete them directly in wacrm, with status updates arriving by webhook. The one exception is Authentication templates — see Limits & notes.

## Where to find it

Settings → Templates. The tab lists every template on your WhatsApp Business Account (WABA), with two actions in the header:

- New Template — opens the builder to author and submit a new template.
- Sync from Meta — pulls the current state of every template from Meta. Use it to import templates created elsewhere, or as a fallback if a webhook status update was missed.

## The builder

New Template (or Edit / Resubmit on an existing row) opens a single dialog that maps 1:1 to Meta's template structure.

### Name, category, language

- Name — lowercase letters, digits and underscores only (`order_confirmation`). Fixed once the template exists on Meta — in edit mode the field is locked, because changing it would be a brand-new template as far as Meta is concerned.
- Category — Marketing or Utility. (Authentication is not yet supported in the builder.) Category sets the pricing tier and the message-policy rules Meta enforces at review.
- Language — locale code (`en_US`, `pt_BR`, …). Also locked in edit mode. Note `en` and `en_US` are different templates to Meta — match exactly what you send with.

### Header (optional)

Pick one format:

| Format           | What you provide                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| None             | No header.                                                                                                         |
| Text             | A short heading (≤ 60 chars). May contain one `{{1}}` variable — if it does, you supply a sample value for review. |
| Image            | Upload a JPEG/PNG (≤ 5 MB) or paste a public HTTPS URL to a sample.                                                |
| Video / Document | A public HTTPS URL to a sample asset.                                                                              |

For an image header you can now upload the file directly in the builder (it's stored in your account's media bucket and previewed inline), or paste a public link. Either way, on submit the app uploads the image to Meta's Resumable Upload API and attaches the returned handle as the review sample — Meta does not accept a plain URL for an image-header template, so this step is required.

Image-header templates need `META_APP_ID` set — it's what the Resumable Upload uses. Without it, image-header submission returns a clear error; text/body-only templates are unaffected.

For video/document headers, paste a public HTTPS URL — Meta fetches it once during review, so it needs to stay live for ~24 hours. The builder shows per-format guidance (recommended dimensions, file size, and type) inline.

### Body

The message itself (≤ 1024 chars). Use `{{1}}`, `{{2}}`, … for variables — they must be contiguous starting at `{{1}}` (`{{1}}` then `{{3}}` is rejected). As you type, the builder detects each variable and shows a sample value input for it.

Sample values are required — Meta reads them during review to understand what real content looks like. A template with variables but no samples will be rejected.

### Footer (optional)

A short line under the body (≤ 60 chars). No variables allowed — Meta's rule, not ours.

### Buttons (optional)

Up to 10 buttons. Four types:

| Type        | What it does                                  | Notes                                                                                             |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Quick Reply | Sends a canned reply back to you when tapped. | Must come before any action buttons.                                                              |
| URL         | Opens a link.                                 | Max 2. The URL may end in `{{1}}` for a per-message suffix — if it does, supply an example value. |
| Phone       | Dials a number.                               | Max 1.                                                                                            |
| Copy Code   | Copies a code (coupon, OTP) to the clipboard. | Max 1. Needs an example code.                                                                     |

The builder enforces Meta's button rules as you go — quick-reply buttons grouped first, per-type caps, required examples — so you hit fewer rejections.

## Submitting & approval

Submit for Approval sends the template to Meta. It lands in Pending while Meta reviews — typically within 24 hours. You don't need to keep the page open: when Meta decides, a webhook flips the status automatically.

If something is wrong with the submission (a missing PIN-level config, a rate limit, an invalid field), the template is still saved locally with the error attached, so you can fix it and resubmit without re-typing everything.

## Statuses

wacrm stores Meta's status verbatim, so what you see matches the WhatsApp Manager exactly.

| Status           | Means                                                    | What you can do                                    |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------- |
| Draft            | Saved locally, never submitted (or a submission failed). | Edit and submit.                                   |
| Pending          | Submitted, awaiting Meta's review.                       | Wait. No edits while pending.                      |
| Approved         | Live — usable in inbox, broadcasts, automations.         | Edit (re-triggers review), delete.                 |
| Rejected         | Meta declined it. The reason is shown on the card.       | Fix and resubmit.                                  |
| Paused           | Meta paused it for poor quality. Recoverable.            | Fix and resubmit.                                  |
| Disabled         | Meta disabled it (severe quality / policy).              | Delete; the name is reserved by Meta for ~30 days. |
| In Appeal        | An appeal is in progress on Meta's side.                 | Wait.                                              |
| Pending Deletion | Queued for removal.                                      | —                                                  |

Approved templates also show a quality score chip — green, yellow, or red — reflecting how recipients have engaged. A sliding score is Meta's early warning before a Pause.

## Lifecycle actions

Each row exposes the actions valid for its status:

- Edit (Approved) — opens the builder pre-filled. Saving submits the changes to Meta, which re-reviews them — the status returns to Pending until approved. Name and language stay locked.
- Resubmit (Rejected / Paused) — same builder, for fixing what Meta flagged and sending it back.
- Delete — removes the template from Meta and locally, after a confirmation step. Deletion is scoped to the exact language variant, so deleting the `en_US` copy of a template leaves its `pt_BR` sibling untouched.

## Real-time status

Once your webhook is wired up, template status changes arrive without clicking Sync from Meta. wacrm listens for three Meta webhook fields:

- `message_template_status_update` — Approved / Rejected / Paused / etc. Carries the rejection reason on a decline.
- `message_template_quality_update` — the green / yellow / red quality score.
- `message_template_components_update` — Meta auto-modified the template (usually a category reclassification); wacrm logs it and points you to Sync from Meta to pull the new shape.

Make sure all three are subscribed in your Meta app's webhook configuration. Sync from Meta remains the manual fallback if a webhook is ever missed.

## Sending a template

Templates are sent — not authored — from these surfaces:

- Inbox — the composer's template picker. Pick an approved template; the picker prompts for any body variables, a header text variable, and URL-button values, with a live preview of the rendered message and the final button URL.
- Broadcasts — step 1 of the wizard. Only approved templates appear.
- Automations — the send-template step.

Media headers and button values travel with the send, so an approved template with an image header and a tracking-URL button reaches the recipient fully assembled.

## Why only approved templates appear in pickers

The inbox picker and the broadcast wizard filter to `status = APPROVED`. Drafts, pending, and rejected templates are hidden because Meta refuses them at send time — better to keep them out of the picker than to let a send fail on dispatch.

## Limits & notes

- Authentication templates aren't built in-app yet. They have a fixed body + one-time-passcode button shape that needs a dedicated builder. For now, create them in Meta WhatsApp Manager and Sync from Meta to use them.
- Image headers support direct upload (JPEG/PNG, ≤ 5 MB) or a public URL; submission needs `META_APP_ID`. Video/document headers are still URL-only.
- Name + language are immutable after submission. To change either, create a new template.
- Editing an approved template costs an approval cycle. Meta re-reviews every edit, so the template is unavailable for sending while it's back in Pending. Meta also caps edits (roughly 10 per month).
- A disabled template's name is reserved by Meta for ~30 days before it can be reused.
- Sync has a ceiling. A very large WABA (2000+ templates) syncs in batches; the UI tells you when more remain and to sync again.

## Where to file bugs

github.com/ArnasDon/wacrm/issues, label `templates`.

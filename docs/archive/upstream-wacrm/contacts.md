# Contacts (upstream snapshot)

> Source: https://wacrm.tech/docs/contacts
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

The Contacts view is the address book for your WhatsApp business. Every inbound from a new phone number creates a contact row; you can also create them manually or import in bulk via CSV.

## Layout

A paginated table — 25 contacts per page — with the columns:

| Column | Notes |
| --- | --- |
| Name | Free-text. Auto-filled from WhatsApp's profile name if available; you can override. |
| Phone | E.164 (`+44…`). Required, unique per tenant. |
| Email | Optional. Useful for downstream CRM sync. |
| Company | Optional. |
| Tags | Up to 3 chips visible inline; an overflow counter ("+ 2 more") if there are extras. |
| Created | When the row appeared in your tenant. |

The header has a search box (filters across name / phone / email via `ilike`) and an Add contact button. Each row has a kebab menu with Edit and Delete.

Click a row to open the detail view — a slide-in sheet with the full record, every conversation with this contact, and active deals.

## Adding contacts

### Manually

Add contact → fill the form (phone is the only required field) → Save. The contact appears at the top of the list. If the same phone number already exists in your tenant, the API returns a constraint error.

### From the inbox

Whenever an inbound message arrives from a phone number you've never messaged before, the webhook creates a contact row automatically. WhatsApp's profile name (if shared) seeds the `name` field; you can edit it later.

### CSV import

Import opens a modal with a file picker. The CSV needs two columns: `phone` and `name`. Optional columns: `email`, `company`, `tags` (comma-separated tag names; tags must already exist).

The importer creates new contacts for phones not yet in your tenant and skips duplicates. A summary at the end of the import shows how many rows were created, updated, and skipped.

Tip: WhatsApp accepts E.164 with no spaces or dashes. The importer normalises common formats (`+44 7700 900123` → `+447700900123`) but rejects rows missing the country prefix.

## Tags

Tags live in their own table (`tags`) and are user-scoped — every member of your tenant sees the same tag library. Each tag has a name and a color (hex). Tag a contact from:

- The detail view (multi-select picker)
- The inbox sidebar (chip row)
- A Flow `set_tag` node
- An Automation `add_tag` / `remove_tag` step

Tags are managed in Settings → Tags: create, rename, recolour, delete. Editing a tag's colour updates every contact rendering that tag — the data model is one tag row + a `contact_tags` junction, not a per-contact copy.

## Filtering by tag

The contacts page doesn't have a built-in tag filter in 0.2.0. The workaround:

For an ad-hoc list, query Supabase directly:

```
select c.* from contacts c
  join contact_tags ct on ct.contact_id = c.id
  join tags t on t.id = ct.tag_id
 where t.name = 'VIP';
```

- Inbox filters conversations by tag (open the contact sidebar → click a tag).
- Broadcasts can audience-target by tag — useful for "everyone tagged `VIP`" sends.

Bulk-action tag filtering is on the v0.3 list.

## Contact detail view

Click a contact row → a right-side sheet slides in with:

- Header: name, phone, avatar (initials fallback), tag chips, the Edit button.
- Activity: a chronological feed of every conversation, deal movement, and tag change for this contact.
- Active deals: cards for any deal in `open` status linking through to Pipelines.
- Conversations: every thread with this contact (latest first), click to deep-link into the inbox.

Edit is in-place: each field becomes editable on click, blur saves.

## Deleting a contact

The kebab menu → Delete prompts for confirmation. Hard-deletes the `contacts` row. By design — for GDPR / "right to be forgotten" compliance — conversations and deals are NOT cascaded. Instead:

- `messages` / `conversations` rows keep their `contact_id` pointer; the inbox renders these as "Unknown contact".
- `deals.contact_id` is set to NULL (migration 004); the deal survives so revenue history isn't lost. Re-attach by editing the deal.
- `broadcast_recipients.contact_id` is set to NULL; aggregate send/delivered counts on the broadcast are preserved.

If you need a full purge (including history), do it in SQL with explicit `DELETE` cascades against your own retention policy.

## Custom fields

Not in 0.2.0 — `contacts` has a fixed column set (name / email / phone / company / avatar_url). For ad-hoc fields, use tags as a categorisation hack, or extend the table with your own migration. The automations engine's `update_contact_field` step also assumes the fixed schema; adding a new column will need a matching engine update.

## Limits & notes

- One phone number → one contact row per tenant. WhatsApp's Cloud API doesn't support multi-tenant identity on a number, so this constraint mirrors the source.
- No multi-tenant contact sharing. Each user's contacts are isolated via RLS.
- No "merge contacts" UI — if you import a duplicate via CSV + manual entry, you'll need to merge in SQL (re-point `messages.conversation_id` → keep one contact → delete the other).
- Search is unindexed full-table ilike. Fine up to a few thousand contacts; past ~10k consider a Postgres trigram index on `contacts.name`, `contacts.phone`, `contacts.email`.

## Where to file bugs

github.com/ArnasDon/wacrm/issues, label `contacts`.

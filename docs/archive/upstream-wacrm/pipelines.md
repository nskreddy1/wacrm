# Pipelines (upstream snapshot)

> Source: https://wacrm.tech/docs/pipelines
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

Pipelines is the sales side of `wacrm`. A Kanban board of deals moving through stages — drag to reorder, click a card to edit, multiple pipelines if your business splits sales into distinct funnels (e.g. "Wholesale" and "Retail").

## Layout

| Pane | What it shows |
| --- | --- |
| Top bar | Pipeline selector dropdown (swap between funnels), Manage pipelines entry, Add deal button. |
| Analytics strip | Quick numbers: total pipeline value, count of deals per stage, won %. |
| Board | One column per stage, left-to-right matching the configured order. Deal cards stack inside. |

Each column header is colour-coded per its stage colour (blue, yellow, orange, purple, green — pick what makes sense for your funnel). The "+" in a column header adds a deal directly into that stage.

## The data model

- Pipelines — top-level container. A user can have many.
- Stages — ordered columns within a pipeline. Each stage has a name, a colour, and a position. A new pipeline seeds five default stages: New Lead, Qualified, Proposal Sent, Negotiation, Won. Edit / reorder / delete via Manage pipelines.
- Deals — the cards. Belong to a pipeline + stage + (optionally) a contact + (optionally) an assignee.

A deal has:

| Field | Use |
| --- | --- |
| Title | Short name visible on the card. |
| Value | Numeric. New deals default to your account's currency (set in Settings → Deals); override per deal. |
| Contact | The customer this deal is about. Nullable — see "Contact deletion" below. |
| Conversation | The thread that spawned the deal, when applicable. Useful for one-click jump back to the chat. |
| Assignee | The team member responsible. Pick from your tenant's user list. |
| Expected close date | Optional forecasting field. |
| Notes | Free-form. |
| Status | `open` / `won` / `lost`. Independent of stage — see below. |

## Status vs stage

A subtle but important distinction:

- Stage = where the deal sits on the board (Proposal Sent, Negotiation, etc.). Drag-drop moves it.
- Status = the deal's terminal state (`open`, `won`, `lost`). Set from the deal form. Won/lost deals stay on the board but are visually de-emphasised.

This means a deal can be in the Proposal Sent stage with status `won` — you closed early without dragging through every column. Analytics use status for the won-percentage roll-up, not which stage a card is in.

## Working with deals

### Create

- Add deal in the top bar → form opens with stage defaulted to the first stage.
- + in a column header → form opens with that column pre-picked.
- From the inbox contact sidebar → + Deal quickly creates a deal with the customer + conversation already attached.

### Edit

Click a card. The deal form opens as a side sheet — edit any field, blur or hit Save. The board updates in real time.

### Move stages

Drag a card from one column to another. The UI updates optimistically; the database UPDATE fires after the drop. If the UPDATE fails the card snaps back and shows a toast.

### Close out

In the deal form, switch Status to `won` or `lost`. The card stays where it is but the badge changes; analytics tick over.

### Delete

Kebab on the card → Delete. Hard-delete. No archive. (Deleted deals can't be recovered.)

## Multiple pipelines

Useful when your business has truly separate funnels — e.g. Wholesale with stages `Discovery → Sample → Quote → Order` sitting alongside Retail with stages `Browse → Cart → Checkout → Won`. Each pipeline has its own stage configuration.

Manage pipelines opens a panel with the list of existing pipelines:

- Rename — inline edit on each row.
- Reorder stages — drag stages within a pipeline.
- Add stage — pick name + colour + position.
- Delete stage — only if no deals reference it. Move them first.
- Delete pipeline — only if it's empty.

The pipeline selector in the top bar persists in `localStorage`, so you land back on your last-used pipeline after a refresh.

## Contact deletion behaviour

If a contact gets deleted (or merged) while they have open deals:

- The deal's `contact_id` is set to NULL — the row survives.
- The card renders as "Unknown contact" with a dimmed avatar.
- You can re-attach by editing the deal and picking a contact.

This is deliberate (migration 004 changed the FK from CASCADE to SET NULL): revenue history shouldn't disappear because someone hit "delete contact".

## Analytics

The strip above the board shows:

- Total value — sum of `value` across all `open` deals in the current pipeline.
- Deals per stage — count per column.
- Won % — `won / (won + lost)` over the trailing 90 days.

Totals are formatted in your account's default currency (set in Settings → Deals) and are not converted between currencies — wacrm assumes one currency per account. If a pipeline mixes currencies, the raw `value` numbers are summed as-is, so keep a pipeline to a single currency for the total to be meaningful.

These are computed client-side from the loaded deals — no heavyweight analytics service. For deeper reporting (forecast accuracy, cycle time, cohort win rates), query Supabase directly.

## Limits & notes

- No per-deal probability or forecast logic. `value` is the literal user input; the analytics strip doesn't multiply by a probability factor.
- No deal age / "stuck deal" warnings. Mentally check the `updated_at` if you want to surface stale ones in SQL.
- Drag-drop only on desktop. Touch reorder via long-press is on the v0.3 list.
- Pipelines are account-scoped via RLS. Every member of your account sees the same pipelines and deals. Editing the pipeline structure (stages, names) is admin+; moving and editing deals is agent+. Viewers are read-only. See Members for the full role matrix.
- First-visit seed. Opening Pipelines for the first time creates a default "Sales Pipeline" automatically so you have something to drag onto. Delete and recreate via Manage pipelines if you want a different name.

## Where to file bugs

github.com/ArnasDon/wacrm/issues, label `pipelines`.

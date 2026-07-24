# Settings (upstream snapshot)

> Source: https://wacrm.tech/docs/settings
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

The Settings surface configures your account, your WhatsApp connection, your message templates, your tag library, your deal defaults, how the UI looks, and who's on your team. Seven tabs, URL-routed via `?tab=<name>` so deep links work.

## Tabs

| Tab             | What it controls                                                        |
| --------------- | ----------------------------------------------------------------------- |
| Profile         | Your name, email, password, active sessions.                            |
| WhatsApp Config | Phone number, access token, webhook URL.                                |
| Templates       | Build, submit, edit, and delete WhatsApp message templates.             |
| Tags            | The shared tag library used across Contacts, Inbox, Flows, Automations. |
| Deals           | The account's default deal currency.                                    |
| Appearance      | Color theme picker (5 themes).                                          |
| Members         | Invite teammates, assign roles, transfer ownership.                     |

## Profile

Three sub-sections on this tab.

### Personal info

Edit your full name and email. Email is read-only after the initial signup — it's tied to your Supabase Auth identity; changing it would require a separate verification flow.

### Password

Three fields: current password, new password, confirm new password. Current is verified server-side via Supabase Auth; the form returns a generic "incorrect password" error rather than distinguishing between "wrong current" and "session expired" to avoid leaking which one it was.

After a successful change you stay signed in on the current session; other active sessions are not revoked. To force log out elsewhere, use the Sessions sub-section below.

### Active sessions

Lists every signed-in browser / device for your account: device fingerprint, last-seen IP (best-effort, can be a proxy address), last-seen time, current-session indicator.

Log out revokes that session. The browser holding it gets kicked to `/login` on next interaction.

## WhatsApp Config

The connection between wacrm and the Meta Cloud API. Without this filled in, nothing sends or receives.

### Fields

- Phone Number ID — Meta-assigned. Copy from the Meta for Developers app → WhatsApp → API setup.
- WhatsApp Business Account ID — also from the Meta dashboard.
- Access Token — masked in the UI (`••••••••`). Click Edit to paste a new one, save, done. The token is encrypted at rest via AES-256-GCM.
- Verify Token — auto-generated. Used by Meta's webhook handshake.
- Webhook URL — auto-generated from your deploy URL. Copy and paste into Meta's webhook config.

### Test connection

The Test connection button hits Meta's Graph API to verify the access token + phone number ID actually work. Result chips:

- Connected — Meta accepted the auth; you're ready to send.
- Failed — error tooltip shows Meta's response. Common causes: expired token, wrong phone number ID, app in dev mode hitting a non-allowlisted recipient.

The chip also lives in the page header so you don't have to come back to Settings to check status.

### Token rotation

If you're rotating tokens (Meta forces this every 60-90 days for unverified apps): paste the new token, save, test. Old conversations and templates carry over — only the token is swapped.

## Templates

The Templates tab is where you build, submit, edit, and delete WhatsApp message templates — and watch their Meta approval status update in real time. See the Templates guide for the full detail.

Quick orientation:

- New Template opens the builder and submits to Meta for approval.
- Sync from Meta imports templates created elsewhere and reconciles status if a webhook was missed.
- Only Approved templates appear in the Inbox picker and Broadcasts wizard.

## Tags

The shared tag library. Tags are account-scoped (every member of the account sees the same tags) and have:

- Name — free-text, unique per tenant.
- Color — hex string. Used everywhere the tag renders.

### Creating

- New tag → form with name + colour picker → Save. Appears in the list immediately.

### Editing

Click any tag row → inline edit on name and colour. Saving updates the row, and every place that tag renders picks up the new colour on next render — because tags are stored once and joined to contacts via `contact_tags`, not copied per contact.

### Deleting

Confirm → hard-delete. The tag is removed from every contact it was applied to (junction rows go with it). Audit logs that mention the tag survive but render it as a plain string.

### Where tags appear

| Surface     | What tags do there                                                       |
| ----------- | ------------------------------------------------------------------------ |
| Contacts    | Chips on contact rows + detail view.                                     |
| Inbox       | Filter conversations by tag (sidebar).                                   |
| Broadcasts  | Audience targeting in step 2.                                            |
| Flows       | `condition` node (test for tag presence), `set_tag` node (add / remove). |
| Automations | `add_tag` / `remove_tag` steps; `tag_added` trigger.                     |

## Deals

The Deals tab sets your account's default currency — the one new deals start in and that every aggregated total is shown in. Pick from the dropdown and Save.

Where it applies:

- New deals default to this currency in the deal form (you can still override per deal).
- Pipeline-stage totals, the dashboard Open Deals Value card, and the Pipeline Value donut format their sums in it.
- Automation-created deals (the `create_deal` step) inherit it.

Where it doesn't:

- Existing deals keep the currency they were saved with. Changing the default never rewrites past deals.
- Totals are shown in the default currency without exchange-rate conversion — wacrm assumes one currency per account.

### Who can change it

The default currency is an account-wide setting, so it's admin and owner only — agents and viewers see the current choice but the control is read-only. (Enforced by row-level security, not just the UI.)

### Self-hosting note

The setting is stored on the account row (`accounts.default_currency`, added by migration `021`). A fresh install defaults every account to USD.

## Appearance

5 dark color themes, swap any time. Click a card → applied instantly across the entire app, persisted to this device.

| Theme            | Vibe                                                            |
| ---------------- | --------------------------------------------------------------- |
| Violet (default) | The original — confident, slightly playful.                     |
| Emerald          | Growth-coded. Nods at messaging without copying WhatsApp green. |
| Cobalt           | Clean B2B-SaaS blue. Calm and product-y.                        |
| Amber            | Warm and friendly. Good for SMB teams.                          |
| Rose             | Bold and modern. D2C, creator-economy, lifestyle.               |

### How the picker works

Every theme is a block of CSS variables (`--primary`, `--background`, `--sidebar`, etc.) scoped under `html[data-theme="<name>"]`. The picker sets `document.documentElement.dataset.theme` and writes the choice to `localStorage`. An inline boot script in the root layout replays the choice before React hydrates, so there's no flash of the default Violet when you reload the page.

### What changes

Across the whole UI: primary buttons, hover states, active nav rows, badges, focus rings, validation chips, dialog highlights. Some semantic colours (success green, warning amber, error red) stay constant regardless of theme.

### Persistence

`localStorage` only. The choice is device-scoped — your laptop and your phone can run different themes. There's no account-level sync.

### Cross-tab sync

If you change the theme in tab A, tab B picks it up via the `storage` event without a refresh.

### Adding a 6th theme

Two-file change: append a new `html[data-theme="<name>"]` block in `src/app/globals.css` (use Violet as the shape reference), and add an entry in `src/lib/themes.ts`. The picker UI, boot script, and provider auto-discover it.

## Limits & notes

- Team management lives in its own tab. Inviting teammates, roles, and ownership transfer are handled in the Members tab. Invites are link-only (no email delivery).
- Authentication templates can't be built in-app yet — create them in Meta WhatsApp Manager and sync.
- Tag colour palette isn't preset. Pick any hex.
- Session list uses Supabase Auth Admin API. Sessions show as long as Supabase considers them active — typically 1 hour from last refresh.
- Profile photo upload isn't wired up in 0.2.0 — the avatar field shows initials.

## Where to file bugs

github.com/ArnasDon/wacrm/issues, label `settings`.

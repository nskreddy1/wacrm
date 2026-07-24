# Members (upstream snapshot)

> Source: https://wacrm.tech/docs/members
> Retrieved: 2026-07-13
> Status: Upstream reference snapshot. This repository's code and migrations are authoritative when they differ. See `docs/architecture-delta.md`.

---

The Members surface turns a solo wacrm install into a shared team workspace. Invite teammates by link, give each one a role that controls what they can do, hand off ownership, and remove people when they leave — all from Settings → Members.

Under the hood every wacrm install is account-scoped: your data belongs to an account, not to your user row, and every member of that account works against the same inbox, contacts, pipelines, templates, and flows. A brand-new signup gets a personal account with exactly one member (you, as owner), so if you never invite anyone the app behaves like the single-user CRM it always was.

Multi-user requires migrations `017`–`020`. If you're self-hosting and upgrading from an earlier version, apply them before deploying. They're idempotent and backfill every existing user as the sole owner of their own account with no data loss.

## Roles

Four roles, in a flat privilege ladder. Each one inherits everything the role below it can do.

| Role | Can do |
| --- | --- |
| Owner | Everything. Exactly one per account. Plus the two owner-only powers: transfer ownership and delete the account. |
| Admin | Manage members (invite / remove / change roles) and edit account-wide settings — WhatsApp config, templates, pipelines, tags, custom fields, the account name. |
| Agent | Operational work: send messages, create/edit contacts, move deals, run broadcasts, build automations and flows. Cannot touch account settings or members. |
| Viewer | Read-only across the whole app. Sees everything, changes nothing. |

### Permission matrix

| Capability | Viewer | Agent | Admin | Owner |
| --- | --- | --- | --- | --- |
| View all data (inbox, contacts, pipelines, …) | ✅ | ✅ | ✅ | ✅ |
| Send messages, edit contacts/deals/broadcasts/automations/flows | — | ✅ | ✅ | ✅ |
| Edit account settings (WhatsApp config, templates, pipelines, tags, account name) | — | — | ✅ | ✅ |
| Manage members (invite, remove, change roles) | — | — | ✅ | ✅ |
| Transfer ownership | — | — | — | ✅ |
| Delete the account | — | — | — | ✅ |

Per-user settings — your own name, avatar, and password — are always editable regardless of role. They're yours, not the account's.

### How roles show up in the app

Roles aren't just a settings-page concept; the rest of the UI respects them. Actions a member can't perform are shown but disabled, with a tooltip explaining why, rather than hidden — so the app never feels silently broken to someone looking at a feature they don't have permission for. A viewer sees the inbox composer greyed out; an agent sees the "New template" and "Add pipeline" buttons disabled.

## Inviting a teammate

Invites are link-only — there's no email delivery. You generate a share link and send it however you like (Slack, WhatsApp, carrier pigeon). Admin or owner only.

1. Settings → Members → Invite member.
2. Pick the role the invitee will get, an optional expiry (in days), and an optional label to remind yourself who it's for.
3. wacrm returns a one-time share link. Copy it now — the token is shown exactly once. Only a SHA-256 hash is stored on the server, so a leaked database never exposes a usable invite link, but it also means we can't show you the link again. Lost it? Revoke and re-issue.

Outstanding invites appear under Pending invitations, where an admin can revoke any that haven't been accepted yet.

## Accepting an invite

The recipient opens the link, which lands on a public `/join/<token>` page. Before they commit, the page shows who's inviting them and into what — "You're being invited to Acme Co as Agent" — plus whether the link is still valid (revoked and expired links say so instead).

To accept they need a wacrm login (they sign up or log in first). Redeeming moves their profile into your account and cleans up the empty personal account they were assigned at signup.

One guardrail: if the person accepting already has their own data in their current account (contacts, conversations, deals, …), redeem is refused with a clear error rather than silently abandoning that data. Invites are for bringing fresh teammates onto your account, not for merging two populated accounts.

## Managing members

The members list shows everyone on the account with their role and join date. What's visible depends on your role: admins and owners see email addresses; agents and viewers see name, avatar, role, and joined date only.

- Change a role — admins+ pick a new role from the dropdown next to a member. Note you can't promote someone to owner or demote the current owner this way; ownership changes go through transfer (below).
- Remove a member — admins+ can remove anyone below them. The removed person keeps their login and is moved to a fresh personal account (same as a brand-new signup) — removal revokes their access to your account, it doesn't delete their user.

## Transferring ownership

Owner only. Every account has exactly one owner, so handing it over is an atomic swap: you pick a member, and in one operation they become owner and you drop to admin. Use this before you leave the team, or to move the "buck-stops-here" role to whoever actually runs the account.

## Notes & limits

- Invites are link-only. wacrm doesn't send invitation emails — it hands you a link to distribute. This keeps the template zero-config (no transactional-email provider to wire up).
- One owner at a time. There's no co-owner concept; use admins for shared management and reserve owner for the single accountable person.
- Tenancy is enforced in the database, not just the UI. Every domain table's row-level security checks account membership via a `SECURITY DEFINER` helper, and the member/invite operations run through RPCs that re-check the caller's role server-side. A hidden button is a convenience; the real boundary is in Postgres.

## Where to file bugs

github.com/ArnasDon/wacrm/issues, label `members`.

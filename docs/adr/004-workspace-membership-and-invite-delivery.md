# ADR-004: Multi-workspace membership and invite delivery

**Status:** Proposed
**Date:** 2026-08-13
**Deciders:** Project owner
**Relates to:** ADR-001 (workspace modules — enforcement layers), ADR-003 (found the `/api/v1` session-route gap), `AGENTS.md` V1/V2 boundary

## Context

The product's reason for multi-tenancy is stated by the owner: **agencies and
companies where several people work the same pipelines and appointments.**
Today that exact scenario is broken.

### What works today (verified against the tree)

- Invite creation is admin-gated (`settings:manage`), the role is constrained
  by a DB CHECK (`role <> 'owner'`), tokens are stored **SHA-256-hashed** with
  an expiry and single-use `accepted_at` (migration 017).
- Invite **email sending already exists**: `src/lib/email/mailer.ts` sends via
  admin-configured SMTP / Resend / MSG91, credentials AES-256-GCM encrypted at
  rest, configured in Settings → Email delivery. The copy-link UI is the
  fallback when no channel is configured — the first half of the reported
  issue is a *configuration visibility* problem, not a missing feature.

### What is broken (root cause)

Membership is a **single `profiles.account_id` column**. One login belongs to
exactly one workspace, ever. Consequently `redeem_invitation(p_token_hash)`
(migration 019) must *move* the user, and it refuses to do even that when the
invitee owns an account containing data — the UI dead-ends with "sign up with
a different email."

**Concrete failure:** an agency lead invites a teammate who already signed up
on his own. The teammate cannot join. The only workaround is a second email
address and a duplicated identity — the exact pattern Slack is criticized
for, and the opposite of how Notion, Linear, and every modern B2B tool work.

### Research summary

| Product | Identity model | Existing user accepts invite |
| --- | --- | --- |
| Slack | Account *per workspace* (email reused) | New separate account each time — widely criticized |
| Notion | One identity, N workspaces | Joins; keeps own workspaces; switcher |
| Linear | One identity, N workspaces | Joins; keeps own workspaces; switcher |
| WorkOS / Better Auth / Clerk reference architectures | One identity + `members` join table | Insert membership row; never move or merge data |

Industry consensus (WorkOS multi-tenancy guides, Better Auth organization
plugin, Clerk organizations): **membership is a join table; joining never
merges or moves tenant data; the active tenant is server state re-verified on
every request.**

## Decision

Adopt the **one-identity / N-memberships** model (Notion/Linear pattern):

1. **D1 — `account_members` join table** `(account_id, user_id, role, status,
   invited_by, created_at)` with `UNIQUE(account_id, user_id)`. Backfill one
   row per existing profile from `profiles.account_id`. `profiles.account_id`
   is kept and reinterpreted as "active workspace pointer" — no destructive
   migration, honoring the AGENTS.md V2 promise.
2. **D2 — `is_account_member()` rewrite** to consult `account_members`. This
   single SECURITY DEFINER function is the seam ~250 RLS policies funnel
   through; the policies themselves do not change.
3. **D3 — `redeem_invitation` rewrite**: INSERT a membership row instead of
   moving `profiles.account_id`. The invitee keeps their own workspace and
   gains the agency's. The "existing data" refusal is deleted — it exists only
   because moving was destructive; joining is not.
4. **D4 — Active-workspace switching**: `POST /api/account/switch` updates
   `profiles.account_id` **only after** verifying an `account_members` row
   exists for the session user (server-side; the target account id is never
   trusted from the client without this check). Sidebar-top switcher UI,
   hidden when the user has exactly one membership.
5. **D5 — Invite delivery hardening**: make the email path primary in the UI
   (status of the configured channel shown before invite creation; admin
   pointed to Settings → Email delivery when unconfigured). Copy-link is not
   an automatic fallback — it is a separate delivery mode an admin activates
   deliberately (see D7).
6. **D6 — Delivery fallback chain and shared-sender separation.** Answers two
   operational questions: *what if a workspace never configures SMTP?* and
   *if one platform sender serves all workspaces, how do tenants stay
   separated?*

   **Resolution order** (first configured wins; `mailer.ts` already implements
   1→2, this decision makes it a contract):

   1. **Workspace settings** (`account_email_settings`, credentials
      AES-256-GCM encrypted) — mail goes out under the tenant's own verified
      `from_email`. Their domain, their reputation, their choice.
   2. **Platform sender** (`RESEND_API_KEY` env, ops-level) — mail goes out
      **only under the platform's own domain**. The workspace's name appears
      in the From *display name* and the inviter's address goes in
      `Reply-To`: `From: "Acme Agency (via WACRM)" <invites@platform-domain>`,
      `Reply-To: inviter@acme.com`. The tenant's domain must NEVER appear in
      the From address on the shared sender — DMARC alignment requires the
      From domain to match the SPF/DKIM-authenticated domain, so
      tenant-domain From would both fail DMARC at the receiver *and* let any
      workspace impersonate any other by typing a rival's address into
      `from_email`. Display-name + Reply-To is the standard shared-sender
      pattern (GitHub, Linear, and Notion invites all arrive "via" the
      platform domain).
   3. **Neither configured** — in `'email'` mode (D7) invite creation
      *blocks* with a clear pointer to Settings → Email delivery; it never
      silently degrades to a link. Workspaces that genuinely cannot run SMTP
      switch to `'link'` mode deliberately via the D7 toggle. Silent
      non-delivery is a bug, not a fallback.

   Per-tenant sending subdomains with individual DKIM keys (the full
   isolation pattern for high-volume senders) are **rejected for now**:
   invites are low-volume transactional mail, and the platform-domain-only
   rule already removes the spoofing surface. Revisit only if workspaces
   start sending customer-facing campaign mail through the platform sender —
   broadcasts already go through WhatsApp, not email, so this is not
   expected.

7. **D7 — Admin-controlled delivery mode toggle.** Delivery is not an
   implicit fallback chain from the inviter's point of view — it is an
   explicit, admin-owned workspace setting with exactly two modes, and
   **inviting users see only the active mode**:

   - `invite_delivery_mode = 'email'` — the invite sheet sends mail through
     the D6 chain (workspace SMTP first, platform sender second). No link is
     shown to the inviter at all; the join URL exists only inside the email.
     If *neither* sender is configured, the invite sheet does not silently
     degrade — it blocks with "Email delivery is not configured" and a link
     to Settings → Email delivery (admins) or "ask your admin" (non-admins).
   - `invite_delivery_mode = 'link'` — no email is attempted. The invite
     sheet generates the invitation, stores it exactly as today (SHA-256
     token hash, single-use, 7-day expiry, bound to `invited_email`), and
     presents the join link once for the inviter to deliver out-of-band.

   Rules that make this enterprise-grade rather than a footgun:

   - The toggle lives in Settings → user controls, **admin/owner only** —
     agents and viewers never see or change it. Column on
     `account_email_settings` (or a workspace-settings row), default
     `'email'`: the secure, auditable channel is the default and `'link'` is
     the deliberate opt-out for workspaces without SMTP.
   - Mode is enforced **server-side in the invite-creation route**, not in
     the UI: in `'email'` mode the response never includes the join URL; in
     `'link'` mode the route skips the mailer entirely. Hiding the link
     client-side while still returning it in JSON would defeat the toggle.
   - **F1 still binds in link mode**: `invited_email` remains mandatory and
     redemption still requires the session's verified email to match. The
     link is transport, not authentication — whoever the URL leaks to, only
     the invited mailbox owner can redeem it.
   - Mode changes are audit-logged (who flipped it, when), and invitations
     record which mode delivered them (`delivered_via: 'email' | 'link'`)
     so an admin reviewing membership can see how each member arrived.

## Options considered

### Option A — Slack model: one account per workspace per email

| Dimension | Assessment |
| --- | --- |
| Complexity | Low (status quo + better messaging) |
| Data risk | None |
| UX | Poor — duplicated identities, N logins |

Rejected: this is the model users complain about, and it directly contradicts
the agency use case (one person, several client workspaces).

### Option B — Merge invitee's data into the host workspace

| Dimension | Assessment |
| --- | --- |
| Complexity | High (17+ tables, FK graphs, dedup) |
| Data risk | **Severe** — irreversible, cross-tenant contamination |
| UX | Superficially attractive, catastrophic when wrong |

Rejected: no surveyed production system merges on join. If a real
consolidation need appears later, it should be an explicit, owner-initiated
export/import — never a side effect of accepting an invite.

### Option C — Join table + active-workspace pointer (chosen)

| Dimension | Assessment |
| --- | --- |
| Complexity | Medium — one migration, one RPC rewrite, one route, one UI control |
| Data risk | Low — additive schema, backfill is one INSERT…SELECT |
| Scalability | Standard pattern; indexes on `(user_id)` and `(account_id, user_id)` |
| Blast radius | Contained by design: RLS policies unchanged, `AccountContext` shape unchanged |

## Security review (sharp-edges analysis)

Threats probed with the scoundrel / lazy-developer / confused-developer
model. Findings **F1–F8** are binding on the implementation:

- **F1 — Bearer-token invites (Critical).** `invited_email` is *nullable*: a
  NULL-email invite is redeemable by anyone holding the link (leaked via
  chat forward, referrer, shoulder-surf). Redemption MUST require
  `invited_email IS NOT NULL` and a **case-insensitive match against the
  session's verified email** (`auth.users.email` where `email_confirmed_at IS
  NOT NULL` — never a client-supplied string). Existing NULL-email invites are
  expired by the migration.
- **F2 — Acceptance must be an explicit POST.** Auto-joining on GET of
  `/join/<token>` enables CSRF-style drive-by joins and link-preview bots
  consuming single-use tokens. The GET renders a confirmation showing
  workspace name + role; redemption happens on POST only.
- **F3 — Role ceiling.** DB CHECK `role <> 'owner'` already exists — keep it,
  and additionally enforce in the create route that the inviter cannot grant a
  role above their own (admin invites admin/agent/viewer; owner-only transfer
  stays a separate, existing RPC).
- **F4 — Switch is an auth-state change.** The switch endpoint re-verifies
  membership inside the same SECURITY DEFINER RPC that flips the pointer (no
  TOCTOU between check and write), and returns 404 (not 403) for
  non-membership so workspace ids cannot be probed — mirroring the catalog
  tools' existence-check pattern.
- **F5 — Removal must revoke everything.** Removing a member deletes the
  `account_members` row AND resets `profiles.account_id` to the user's own
  workspace if it currently points at the removing account — otherwise the
  removed user keeps a dangling active pointer. Same on role demotion:
  pending invites created by that user for roles above their new role are
  expired.
- **F6 — Last-owner invariant.** `account_members` must never allow the only
  `owner` row of an account to be deleted or demoted (guard inside the
  RPCs; the UI disabling a button is not the boundary — per AGENTS.md).
- **F7 — SMTP credentials.** Already AES-256-GCM at rest; the settings route
  must remain admin-gated, never echo secrets back to the client after save
  (write-only fields), and the mailer must not log credentials or full
  recipient lists. A send failure after the invitation row is created
  surfaces an explicit error with a re-send action — it never silently
  degrades to a link (D7: the delivery mode is an admin decision, not a
  runtime fallback).
- **F8 — Shared-sender tenant impersonation.** On the platform fallback (D6
  step 2), the From *address* is hard-coded to the platform domain in the
  mailer — it must never be interpolated from `account_email_settings.
  from_email` or any tenant-supplied value. A scoundrel tenant setting
  `from_email = billing@rival-agency.com` would otherwise send
  platform-authenticated mail as their rival. Tenant identity travels only in
  the From display name (sanitized: strip `<`, `>`, `"`, CR/LF to block
  header injection) and in `Reply-To`. Tenant-controlled From addresses are
  legitimate ONLY on path 1, where the tenant's own credentials authenticate
  the send.

Residual risk accepted: invite links still transit email; mitigated by expiry
(existing `expires_at`), single-use (`accepted_at`), hashing at rest, and F1's
email binding which makes an intercepted link useless to a non-invitee.

## Consequences

- **Easier:** agencies share pipelines/appointments with one identity per
  person; ADR-001's module gating later applies per-account cleanly.
- **Harder:** every future feature touching "the user's account" must be
  written against *membership*, not the profile pointer; `AGENTS.md` V1/V2
  boundary text must be updated (V2's data model arrives; the URL contract is
  unchanged — feature URLs stay clean, switching changes only server context,
  exactly as AGENTS.md specified for V2).
- **Revisit:** per-workspace notification preferences; the ADR-003 finding
  that session `/api/v1` routes bypass `requirePermission` becomes *more*
  important once users hold multiple roles (tracked as ADR-001 item 6a).

## Action items

1. [ ] Implementation per `docs/superpowers/plans/2026-08-13-adr-004-workspace-membership.md`
2. [ ] Update `AGENTS.md` V1/V2 boundary when D1–D4 land
3. [ ] Re-run the ADR-001 item 6a decision once memberships exist

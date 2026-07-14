Context (what exists today)

DB: Supabase, 41 migrations applied. Multi-tenant via accounts + profiles (account_role: owner/admin/agent/viewer), RLS everywhere via is_account_member().
Signup flow: handle_new_user() trigger on auth.users (migration 017) creates an accounts row + profiles row. Nothing else is seeded — new accounts start with zero pipelines, tags, or quick replies.
Pipelines: pipelines / pipeline_stages / deals are account-scoped, plus pipeline_saved_views, sub_pipelines (migration 037). No template/catalog concept exists; "Sales Pipeline" only exists as hardcoded demo data in the SQLite dev repository.
Tags & custom_fields: legacy user-scoped (user_id), not account-scoped (migration 001). quick_replies are account-scoped (migration 035).
Sidebar (src/components/layout/sidebar.tsx): hardcodes "Sam Silva", "sam@relaycrm.demo", "Acme Support", and a fake badge: "18" on Inbox, even though useAuth() already exposes real profile + account and /api/v1/workspace/inbox/summary exists for unread counts.

Goal
Enterprise-grade, dynamic template catalog stored in the DB (not hardcoded), so every new account is automatically provisioned with default pipelines, tags, and quick replies the moment it is created — and new templates can be added later without code changes. Plus a one-shot idempotent script to backfill existing accounts, and a sidebar that shows real data.
Part 1 — DB architecture: template catalog + provisioning engine
New migration supabase/migrations/042_workspace_provisioning.sql:
1a. workspace_templates (global catalog — the dynamic part)
workspace_templates
  id            UUID PK
  slug          TEXT UNIQUE            -- 'sales-pipeline', 'customer-support', 'default-tags', 'starter-quick-replies'
  kind          TEXT CHECK IN ('pipeline','tags','quick_replies')   -- extensible; add kinds later
  name          TEXT
  description   TEXT
  definition    JSONB                  -- full payload (stages w/ colors, tag list, reply list)
  version       INTEGER DEFAULT 1      -- bump when a template changes
  is_default    BOOLEAN DEFAULT FALSE  -- auto-provision to every new account
  is_active     BOOLEAN DEFAULT TRUE
  created_at / updated_at


RLS: SELECT for any authenticated user (so a future "Browse templates" UI can read the catalog); writes only via service role. No per-account rows — this is a platform-level catalog.
Adding a future template (e.g. "Recruiting") = one INSERT, zero code changes.

1b. account_provisioned_templates (idempotency + audit log)
account_provisioned_templates
  account_id   UUID FK accounts
  template_id  UUID FK workspace_templates
  version      INTEGER          -- version that was applied
  provisioned_at TIMESTAMPTZ
  PRIMARY KEY (account_id, template_id)

Guarantees a template is applied at most once per account, even if the trigger and the backfill script both run. RLS: members can read their own rows; writes via the SECURITY DEFINER function only.
1c. provision_account_defaults(p_account_id, p_owner_user_id) function
SECURITY DEFINER plpgsql function that:

Loops over workspace_templates WHERE is_default AND is_active, skipping any already in account_provisioned_templates.
Materializes by kind:

pipeline → insert pipelines row + pipeline_stages from definition->'stages' (name, color, position).
tags → insert tags rows for p_owner_user_id (tags are user-scoped today; seed against the owner).
quick_replies → insert account-scoped quick_replies (author = owner).


Records each application in account_provisioned_templates.
Wrapped so a failure in one template logs a WARNING and continues — provisioning must never block signup.

1d. Wire into signup
Replace handle_new_user() (same pattern as 017) to call provision_account_defaults(v_account_id, NEW.id) after creating the account + profile. Kept inside the existing EXCEPTION WHEN OTHERS safety net.
1e. Seed catalog rows (in the same migration)

Sales Pipeline (default): New Lead → Qualified → Proposal Sent → Negotiation → Won, with stage colors.
Customer Support (default): New Ticket → In Progress → Waiting on Customer → Resolved.
Default tags (default): New Lead, Hot Lead, VIP, Follow Up, Customer — with colors.
Starter quick replies (default): Greeting, Away message, Thanks/closing — plain-text kind='text'.

Apply via the existing scripts/push-supabase-schema.mjs flow (migration tracked in wacrm_internal.schema_migrations).
Part 2 — Backfill script for existing accounts
New scripts/provision-default-workspaces.mjs (follows the style of seed-test-data.mjs, uses POSTGRES_URL from .env.development.local):

Finds every account and calls provision_account_defaults(account_id, owner_user_id).
Fully idempotent (the log table makes re-runs no-ops), --dry-run flag prints what would be provisioned.
Prints a summary: accounts scanned / templates applied / skipped.
Run it once after the migration is pushed; safe to re-run any time (e.g. after adding a new default template with a new slug).

Part 3 — App-side: use the catalog dynamically

src/lib/pipelines/supabase-pipeline-repository.ts: when creating a pipeline from the UI, optionally accept a templateSlug so "New pipeline" can offer catalog templates (read from workspace_templates). Minimal change: a small listPipelineTemplates() read.
Keep the SQLite demo repository as-is (dev/demo only).

Part 4 — Sidebar: real data + polish
Edit src/components/layout/sidebar.tsx (desktop + mobile panels):

Brand block: replace "Acme Support" with account.name from useAuth() (skeleton while loading).
Account menu: replace "Sam Silva" / "sam@relaycrm.demo" / "SS" initials with profile.full_name, profile.email, computed initials, and the real role label (accountRole), "Sign out" (drop the word "demo").
Inbox badge: replace hardcoded "18" with real unread count from /api/v1/workspace/inbox/summary via SWR (hide badge when 0; refresh on interval/focus).
Grouping polish: split nav into labeled groups (visible when expanded): Engage (Pipelines, Inbox, Contacts, Bookings), Automate (Broadcasts, Automations, Flows, AI agents), Insights (Dashboard). Keep the current visual style, colors, and collapse behavior.

Files to create / change
FileActionsupabase/migrations/042_workspace_provisioning.sqlNEW — catalog, log table, function, trigger update, seed rowsscripts/provision-default-workspaces.mjsNEW — idempotent backfill for existing accountssrc/components/layout/sidebar.tsxEDIT — real user/account/unread data + grouped navsrc/lib/pipelines/supabase-pipeline-repository.tsEDIT — listPipelineTemplates() read (small)
Verification

Push migration, confirm catalog rows exist and handle_new_user calls the provisioner.
Create a fresh test user → verify the account automatically has 2 pipelines (with stages), 5 tags, 3 quick replies, and 4 rows in the provisioning log.
Run backfill script twice → second run applies 0 (idempotent).
Load the app → sidebar shows real name/account/role and real unread count.
npm run lint / existing tests still pass.

Scalability assessment — is this architecture enough for large scale?
Verdict: yes, the core architecture holds. No rewrite needed to go from demo → real organizations. The changes in this plan are additive and designed for that path. Here is the honest breakdown:
What already scales (keep as-is)
CapabilityWhy it's already enterprise-shapedMulti-tenancyEvery table is account_id-scoped with RLS via is_account_member(). An "organization" IS an account — the model doesn't change.Teams / membersprofiles.account_role (owner/admin/agent/viewer), account_invitations, member RPCs (018/019), presence (024) already exist. Inviting 50 agents works today.ExtensibilityAPI keys (026), webhooks (028), notifications (027), omnichannel foundation (038-041) — the integration surface for orgs exists.This plan's provisioningCatalog is data-driven (JSONB templates, versioned, idempotent log). Adding templates, per-plan defaults, or industry packs later = INSERTs, not migrations.
What needs evolution at large scale (small, incremental changes — not a redesign)

tags + custom_fields are user-scoped (migration 001 legacy). Fine for solo use; wrong for orgs (each agent sees different tags). Fix = one migration adding account_id + backfill. Flagged as the #1 tech-debt item; this plan seeds tags against the owner so the future migration is trivial.
Roles are a fixed enum. Big orgs eventually want custom roles/permissions. The fix is an additive role_permissions table layered on the existing enum — no breaking change.
Provisioning inside the signup trigger is perfect up to thousands of signups/day. At very high volume, move the provision_account_defaults() call from the trigger into a queue/background job — the function itself doesn't change, only who calls it. This is exactly why the logic lives in one SQL function instead of scattered app code.
Message/conversation volume: at millions of rows, add table partitioning on messages by month + read replicas. Supabase supports both; schema unchanged.
Org-of-orgs (parent company → sub-workspaces): if ever needed, add a nullable accounts.parent_account_id. The org/[accountId] routing already anticipates account switching.
Billing/seats: no billing tables exist yet. When monetizing, add subscriptions/plans tables + is_default_for_plan on workspace_templates (catalog already versioned for this).

Why v1 (this plan) is the right size

Small scale (demo): works immediately — every signup gets a working workspace.
Mid scale (teams of 5-100): already covered by existing members/roles/RLS + this plan.
Large scale (big companies): the 6 items above are each an isolated, additive change. Nothing in this plan has to be undone — the template catalog, provisioning log, and SECURITY DEFINER function are exactly the primitives an enterprise version reuses.

Out of scope (future, enabled by this design)

Admin UI to manage the template catalog.
Template versioning upgrades pushed to existing accounts.
Migrating tags/custom_fields from user-scoped to account-scoped (bigger refactor; noted as tech debt — see assessment above).
Queue-based provisioning, custom roles, partitioning, billing (see assessment above).
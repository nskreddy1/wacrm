# Phase 5 — Enterprise Scale Items (FUTURE)

The core architecture (account-scoped multi-tenancy + RLS, roles, invitations,
API keys, webhooks) holds to large-organization scale WITHOUT a rewrite. These
six items are each isolated, additive changes to pick up when the trigger
condition arrives.

| # | Item | Trigger condition | Change |
|---|---|---|---|
| 1 | Account-scoped `tags` + `custom_fields` | First multi-agent org complains agents see different tags | One migration: enforce `account_id` scoping in RLS (column already exists from 017 for tags; add for custom_fields) + backfill. Highest-priority tech debt. |
| 2 | Custom roles / permissions | An org asks for finer-grained permissions than owner/admin/agent/viewer | Additive `role_permissions` table layered over the existing enum. No breaking change. |
| 3 | Queue-based provisioning | Thousands of signups/day make the signup trigger too heavy | Move the `provision_account_defaults()` CALL from the trigger to a background job. The function itself is unchanged — this is why it lives in one SQL function. |
| 4 | Message partitioning + read replicas | `messages` reaches millions of rows | Partition `messages` by month; add Supabase read replicas. Schema unchanged. |
| 5 | Org-of-orgs (sub-workspaces) | A parent company wants multiple workspaces under one umbrella | Nullable `accounts.parent_account_id`; the `org/[accountId]` routing already anticipates account switching. |
| 6 | Billing / seats / plans | Monetization | `subscriptions` + `plans` tables; `is_default_for_plan` on `workspace_templates` (catalog is already versioned for per-plan defaults). |

## Also enabled by phase 1's design (whenever wanted)

- Admin UI to manage the template catalog (`workspace_templates` is already
  readable by authenticated users).
- Template versioning upgrades pushed to existing accounts (the
  `account_provisioned_templates.version` column records what was applied).
- Industry template packs (Recruiting, Onboarding, Real Estate...) — INSERTs only.

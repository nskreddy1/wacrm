# Phase 1 — Workspace Defaults Provisioning (DONE)

Every new account is automatically provisioned with default pipelines, tags,
and quick replies the moment it is created. Templates live in a dynamic DB
catalog — adding future templates requires zero code changes.

## What was built

- `supabase/migrations/042_workspace_provisioning.sql`
  - `workspace_templates` — platform-level template catalog (JSONB definitions,
    versioned, `is_default` flag). RLS: authenticated read; service-role write.
  - `account_provisioned_templates` — per-account idempotency + audit log
    (PK `(account_id, template_id)` guarantees at-most-once application).
  - `provision_account_defaults(p_account_id, p_owner_user_id)` — SECURITY
    DEFINER function; loops default templates, materializes by `kind`
    (`pipeline` → pipelines + stages, `tags` → tags, `quick_replies` →
    quick_replies). Per-template failures WARN and continue; never blocks signup.
  - `handle_new_user()` replaced (same pattern as 017) to call the provisioner
    after creating account + profile.
  - Seeded defaults: Sales Pipeline (5 stages), Customer Support (4 stages),
    5 starter tags, 3 starter quick replies.
- `scripts/provision-default-workspaces.mjs` — idempotent backfill for existing
  accounts. `--dry-run` supported. Safe to re-run any time (e.g. after adding a
  new default template).

## How to add a new template later (no code changes)

```sql
INSERT INTO workspace_templates (slug, kind, name, description, definition, is_default)
VALUES ('recruiting-pipeline', 'pipeline', 'Recruiting',
        'Track candidates from application to hire.',
        '{"stages":[{"name":"Applied","color":"#3b82f6"},{"name":"Screening","color":"#8b5cf6"},{"name":"Interview","color":"#f59e0b"},{"name":"Offer","color":"#10b981"},{"name":"Hired","color":"#22c55e"}]}',
        true);
-- then: node scripts/provision-default-workspaces.mjs   (backfills existing accounts)
```

## Known follow-ups

- `tags` are still user-scoped (seeded against the account owner) — migrating
  to account scope is phase 5 item #1.
- A "Browse templates" UI reading the catalog (`listPipelineTemplates()`) is a
  small phase 2+ add.

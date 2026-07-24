# Upstream wacrm.tech documentation snapshots

This directory preserves the public documentation of the upstream `wacrm` project (https://wacrm.tech/docs) as local Markdown snapshots, so the inherited behavior can always be distinguished from this fork's enterprise V1 decisions.

## Authority order — read this first

When a snapshot disagrees with the repository, the repository wins:

1. **Live database schema and `supabase/migrations/`** — the actual data model.
2. **Repository source code** (`src/`) — the actual behavior.
3. **Local architecture docs** — `docs/architecture-delta.md` and `docs/enterprise-v1-architecture.md`.
4. **These upstream snapshots** — historical/upstream reference only.

Do not treat any statement in this directory as a fact about this fork without verifying it against the code. Known divergences are catalogued in `docs/architecture-delta.md`.

## Snapshot index

| File                       | Source URL                                    | Retrieved  | Section   |
| -------------------------- | --------------------------------------------- | ---------- | --------- |
| `architecture.md`          | https://wacrm.tech/docs/architecture          | 2026-07-13 | Reference |
| `supabase-setup.md`        | https://wacrm.tech/docs/supabase-setup        | 2026-07-13 | Setup     |
| `environment-variables.md` | https://wacrm.tech/docs/environment-variables | 2026-07-13 | Setup     |
| `deployment-hostinger.md`  | https://wacrm.tech/docs/deployment-hostinger  | 2026-07-13 | Deploy    |
| `inbox.md`                 | https://wacrm.tech/docs/inbox                 | 2026-07-13 | Features  |
| `contacts.md`              | https://wacrm.tech/docs/contacts              | 2026-07-13 | Features  |
| `pipelines.md`             | https://wacrm.tech/docs/pipelines             | 2026-07-13 | Features  |
| `templates.md`             | https://wacrm.tech/docs/templates             | 2026-07-13 | Features  |
| `broadcasts.md`            | https://wacrm.tech/docs/broadcasts            | 2026-07-13 | Features  |
| `ai-assistant.md`          | https://wacrm.tech/docs/ai-assistant          | 2026-07-13 | Features  |
| `settings.md`              | https://wacrm.tech/docs/settings              | 2026-07-13 | Features  |
| `members.md`               | https://wacrm.tech/docs/members               | 2026-07-13 | Features  |
| `public-api.md`            | https://wacrm.tech/docs/public-api            | 2026-07-13 | Reference |
| `changelog.md`             | https://wacrm.tech/docs/changelog             | 2026-07-13 | Reference |

## Notes

- Snapshots preserve upstream wording and attribution; they are not rewritten to describe this fork.
- The local `docs/public-api.md` at the repository root of `docs/` is the richer, authoritative API reference for this fork; `public-api.md` here is the shorter upstream version kept for comparison.
- Upstream issues live at github.com/ArnasDon/wacrm/issues; issues with this fork belong in this repository's tracker.

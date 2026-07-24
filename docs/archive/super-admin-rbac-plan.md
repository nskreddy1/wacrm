# Enterprise Super Admin + Per-Org Feature Control (RBAC Extension)

> Status: **Planned — not implemented.** Saved for future use. No code or database changes have been made yet.

## Context

wacrm already has a solid two-level RBAC system:

- **Org level (exists):** `accounts` table (= client organization) with members in `profiles` (`account_id`, `account_role`: `owner > admin > agent > viewer`), enforced via `requireRole()` (`src/lib/auth/account.ts`), `<RequireRole>` UI guard, `useCan()` hook, role-filtered nav (`src/lib/navigation/config.ts`), and Supabase RLS (`is_account_member`).
- **Platform level (partial):** env-allowlist super admin (`src/lib/auth/super-admin.ts`, `SUPER_ADMIN_EMAILS`), `platform_settings` table (service-role only), and one interim API (`/api/admin/platform-settings`).

**Goal:** Build the enterprise layer on top: a Super Admin console where the platform operator can (1) see all client organizations, (2) hide/show feature pages per org, (3) suspend/activate orgs, and (4) create new client orgs and invite their owner. Each org owner then manages n members via the existing role system — no changes needed there.

Super admins stay identified by the `SUPER_ADMIN_EMAILS` env allowlist (decided).

## Architecture

```
SUPER ADMIN (env allowlist)          — platform operator, sees /admin console
  └── ORGANIZATION (accounts row)    — client org: disabled_features, status
        └── owner                    — the client; invites & manages members
              └── admin / agent / viewer  — n employees (existing RBAC, unchanged)
```

Feature gating is enforced at 3 layers (fail closed):

1. **Nav** — disabled features filtered out of the sidebar (server-side, in the navigation API).
2. **API** — `requireRole()` extended to also check org status + feature access for the route's feature.
3. **Page** — dashboard layout/pages redirect when the feature is disabled or org suspended.

## Implementation Steps

### 1. Migration `047_org_administration.sql`

Extend `accounts`:

```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  -- NULL = all features enabled (default). A JSONB array of disabled
  -- feature keys, e.g. '["flows","agents"]'. Storing DISABLED keys means
  -- new features ship enabled for everyone with no backfill.
  ADD COLUMN IF NOT EXISTS disabled_features JSONB NOT NULL DEFAULT '[]'::jsonb;
```

Also add an `admin_audit_log` table (id, actor_email, action, target_account_id, detail JSONB, created_at) — RLS enabled with no policies (service-role only), same pattern as `platform_settings`.

No new RLS policies needed on `accounts` for members (they already read their own account); all super-admin access goes through the service-role client after the allowlist gate.

### 2. Feature registry — `src/lib/features/registry.ts` (new)

Single source of truth mapping feature keys to nav items and route prefixes:

```ts
export const FEATURES = {
  pipelines:   { label: "Pipelines",   navKey: "pipelines",   routes: ["/api/v1/pipelines", ...] },
  inbox:       { label: "Inbox", ... },        // NOT toggleable (core)
  contacts:    { ... },                         // core
  bookings:    { label: "Bookings", ... },
  broadcasts:  { label: "Broadcasts", ... },
  automations: { label: "Automations", ... },
  flows:       { label: "Flows", ... },
  agents:      { label: "AI agents", ... },
  dashboard:   { label: "Dashboard", ... },
} as const
export type FeatureKey = keyof typeof FEATURES
```

Toggleable set: `bookings, broadcasts, automations, flows, agents, pipelines, dashboard`. `inbox` + `contacts` + `settings` stay always-on (core CRM).

Helper: `isFeatureEnabled(disabledFeatures: string[], key: FeatureKey)`.

### 3. Extend account context — `src/lib/auth/account.ts`

- `AccountContext` gains `status: 'active' | 'suspended'` and `disabledFeatures: string[]` (selected in the existing accounts point lookup — no extra round trip).
- `getCurrentAccount()` throws `ForbiddenError("Organization suspended")` when `status = 'suspended'` (super admins bypass nothing here — they use `/admin`, not the workspace).
- New `requireFeature(key: FeatureKey, min: AccountRole)` = `requireRole(min)` + feature check → `ForbiddenError("Feature not enabled for this organization")`.
- New `src/lib/auth/super-admin-context.ts`: `requireSuperAdmin()` promoted from the interim inline helper in the platform-settings route into a reusable module (returns `{ user, email }` or throws), used by all `/api/admin/*` routes.

### 4. Feature-aware navigation — `src/lib/navigation/config.ts` + nav API

- `NavItemConfig` gains optional `feature?: FeatureKey`.
- `navigationForRole(role, disabledFeatures)` filters by role AND feature.
- `/api/v1/workspace/navigation` passes `context.disabledFeatures` (already in context, zero extra queries).
- `use-navigation.ts` fallback unchanged (viewer-safe subset already conservative).

### 5. Route + page enforcement

- Swap `requireRole(...)` → `requireFeature("flows", ...)` etc. in the API routes of toggleable features (broadcasts, automations, flows, agents, bookings, pipelines).
- Dashboard layout (`src/app/(dashboard)/layout.tsx`): when org is suspended, render an "Organization suspended — contact support" screen instead of children.
- Each toggleable page's server component checks the feature and `redirect("/inbox")` if disabled (thin guard; API is the real enforcement).

### 6. Super Admin APIs — `src/app/api/admin/orgs/*` (new)

All gated by `requireSuperAdmin()`, using the service-role client, writing to `admin_audit_log`:

- `GET /api/admin/orgs` — list orgs: name, owner email, member count, status, disabled features, created_at (one aggregate query).
- `GET /api/admin/orgs/[id]` — detail incl. members list.
- `PATCH /api/admin/orgs/[id]` — update `status` and/or `disabled_features`.
- `POST /api/admin/orgs` — create org + owner invitation:
  - Insert `accounts` row… but `owner_user_id` is NOT NULL, so: create the owner auth user via `supabaseAdmin.auth.admin.createUser({ email, email_confirm: false })` (or `inviteUserByEmail` if SMTP configured — fall back to returning a one-time signup/invite link generated with `auth.admin.generateLink`), then insert the account with that user as owner and upsert their profile (`account_id`, `account_role='owner'`).
  - Returns the invite link once (same "shown exactly once" convention as `account_invitations`).

### 7. Super Admin console UI — `src/app/admin/*` (new, outside `(dashboard)`)

Own minimal layout (no workspace sidebar), server-gated: layout calls the super-admin check and 404s/redirects non-admins so the console is invisible to regular users.

- `/admin` — org list table: name, owner, members, status badge, features summary, created; search + "New organization" button.
- `/admin/orgs/[id]` — org detail: feature toggle switches (per toggleable feature), suspend/activate button with confirm dialog, members list (read-only), recent audit entries.
- "New organization" dialog: org name + owner email → shows the invite link on success with copy button.
- Reuse existing shadcn components (table, switch, badge, dialog) and the app's current visual language.
- Existing `/api/admin/platform-settings` (AI engine flag) gets a small card on `/admin` too, so the console becomes the single operator surface.

### 8. Docs/env

- Add `SUPER_ADMIN_EMAILS` to `.env.example` (if present) with a comment.

## What does NOT change

- Existing owner/admin/agent/viewer roles, `<RequireRole>`, `useCan`, invitations flow — org owners keep managing their n members exactly as today.
- RLS member policies — feature gating is app-layer (nav + API + page); data isolation stays RLS.

## Key files

| File                                             | Change                                            |
| ------------------------------------------------ | ------------------------------------------------- |
| `supabase/migrations/047_org_administration.sql` | new — status, disabled_features, audit log        |
| `src/lib/features/registry.ts`                   | new — feature keys                                |
| `src/lib/auth/account.ts`                        | extend context; `requireFeature`; suspended check |
| `src/lib/auth/super-admin-context.ts`            | new — reusable `requireSuperAdmin()`              |
| `src/lib/navigation/config.ts`                   | feature-aware filtering                           |
| `src/app/api/v1/workspace/navigation/route.ts`   | pass disabledFeatures                             |
| `src/app/api/admin/orgs/**`                      | new — list/detail/patch/create                    |
| `src/app/admin/**`                               | new — console UI                                  |
| Toggleable feature API routes + pages            | swap to `requireFeature`                          |

## Order of execution

1. Migration → 2. registry + auth extensions → 3. nav filtering → 4. admin APIs → 5. admin console UI → 6. route/page enforcement sweep → 7. verify build.

# Workspace Membership (ADR-004) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one login belong to several workspaces so agency teams share pipelines and appointments — invite → accept → switch — without moving or merging any data.

**Architecture:** Additive `account_members` join table backfilled from `profiles.account_id`, which is kept as the "active workspace" pointer. All ~250 RLS policies stay untouched because they funnel through the single SECURITY DEFINER function `is_account_member()`, which is rewritten against the join table. Redemption inserts membership; switching flips the pointer inside one RPC that re-verifies membership.

**Tech Stack:** Postgres/Supabase (idempotent SQL migrations), Next.js 16 route handlers, Vitest, existing `getCurrentAccount()` BFF auth.

## Global Constraints

- Migrations are **idempotent**, new-file-only (never edit an existing migration), timestamped `20260813...` per current convention.
- Security decisions **F1–F8 in ADR-004 are binding**; do not relax them for convenience.
- `AccountContext` (`src/features/auth/lib/account.ts:89`) keeps its shape: `accountId` remains the *active* workspace id. Downstream code must not break.
- Role ladder `owner > admin > agent > viewer` (`account_role_enum`); invites can never grant `owner` (existing DB CHECK).
- Every task: `pnpm typecheck && pnpm test` green before commit. Feature branch, no pushes to main.
- UI text: workspace switcher copy uses "Workspace", not "Account".

## File Structure

- Create: `supabase/migrations/20260813120000_account_members.sql` (Task 1)
- Create: `supabase/migrations/20260813121000_membership_functions.sql` (Tasks 2–4)
- Modify: `src/features/auth/lib/account.ts` (Task 5 — memberships list)
- Create: `src/app/api/account/switch/route.ts` (Task 5)
- Modify: `src/app/join/[token]/page.tsx` + `src/app/api/invitations/[token]/redeem/route.ts` (Task 6)
- Create: `src/components/layout/workspace-switcher.tsx`; Modify: sidebar layout component (Task 7)
- Create: `supabase/migrations/20260813122000_invite_delivery_mode.sql`; Modify: `src/app/api/account/invitations/route.ts`, `src/features/settings/components/invite-user-sheet.tsx`, email-settings tab (Task 8)
- Modify: `AGENTS.md`, `docs/adr/004-*.md` status (Task 9)

---

### Task 1: `account_members` join table + backfill

**Files:**
- Create: `supabase/migrations/20260813120000_account_members.sql`

**Interfaces:**
- Produces: table `account_members(account_id uuid, user_id uuid, role account_role_enum, status text, invited_by uuid, created_at timestamptz)`, `UNIQUE(account_id, user_id)`; used by every later task.

**DONE — applied to dev, with 5 corrections the draft SQL above did not survive.**
The SQL in this task was written before the live schema was inspected. As
executed it differs, and the migration file is authoritative over this block:

1. `status` — draft used `CHECK (status IN ('active','suspended'))` and backfilled
   a literal `'active'`. Live `profiles.status` is `active|inactive|deleted`, so
   the draft would have **reactivated deactivated members** and used a
   vocabulary that doesn't exist elsewhere. Now mirrors profiles and carries
   status across.
2. `role` — draft inserted `p.account_role` directly. COALESCEd to `'viewer'`
   (least privilege) so the NOT NULL column can't fail on older databases.
3. **Owners** — draft backfilled only from `profiles`. `accounts.owner_user_id`
   is the authoritative owner, so an owner recorded lower in profiles would have
   been **locked out of their own workspace**. Owners are now backfilled from
   that column and promoted.
4. **RLS recursion** — the draft policy sub-queries `account_members` from a
   policy *on* `account_members`; Postgres aborts with `infinite recursion
   detected in policy for relation`. Delegates to the existing SECURITY DEFINER
   `is_account_member()` instead, matching the other 201 policies.
5. `uuid_generate_v4()` → `gen_random_uuid()` (pgcrypto is present, uuid-ossp is
   not guaranteed).

**Verified on dev** (all probes inside rolled-back transactions): F6 blocks
demote/deactivate/delete of a last owner yet still allows demotion once a second
owner exists; RLS SELECT neither recurses nor leaks across workspaces; both
migrations replay cleanly; invariants "no ownerless account", "no profile without
membership", "no status mismatch", "no live NULL-email invite" all 0.

**Two schema facts discovered here that later tasks depend on:**
- `account_role_enum` sort order is `owner=1, admin=2, agent=3, viewer=4`, so
  "at least admin" is `role <= 'admin'`. Task 2 must not invert this.
- `idx_accounts_one_per_owner` is `UNIQUE(accounts.owner_user_id)` — a user may
  be a *member* of many workspaces but may **own** only one. V2's switcher is
  unaffected; "user owns two workspaces" would require dropping that index.

- [x] **Task 1b (unplanned, required): create membership on signup**
  — `supabase/migrations/20260813121000_handle_new_user_membership.sql`

`handle_new_user()` predates `account_members`: it writes `profiles` and
`accounts` but no membership row. Since Task 2 repoints `is_account_member()` at
`account_members`, without this every **new signup** would authenticate and then
be denied by all ~201 account-scoped policies. Existing users were already
backfilled, so this would have shipped looking healthy and broken only new
signups. Covers both trigger paths (fresh signup → `owner`; verified-domain
auto-join → the account's `default_member_role`), copying the rest of the body
verbatim to avoid regressing onboarding/domain-claim logic.

- [ ] **Step 1: Write the migration**

```sql
-- 20260813120000_account_members.sql
-- ADR-004 D1: membership join table. Additive; profiles.account_id becomes
-- the "active workspace" pointer and is NOT dropped.

CREATE TABLE IF NOT EXISTS account_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role account_role_enum NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_members_user ON account_members(user_id);

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

-- Members may read the roster of accounts they belong to; writes go
-- exclusively through SECURITY DEFINER RPCs (Tasks 2-4), so no INSERT/UPDATE/
-- DELETE policies are created.
DROP POLICY IF EXISTS account_members_select ON account_members;
CREATE POLICY account_members_select ON account_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM account_members me
      WHERE me.account_id = account_members.account_id
        AND me.user_id = auth.uid() AND me.status = 'active'
    )
  );

-- Backfill: one membership per existing profile pointer (idempotent).
INSERT INTO account_members (account_id, user_id, role, status)
SELECT p.account_id, p.user_id, p.account_role, 'active'
FROM profiles p
WHERE p.account_id IS NOT NULL
ON CONFLICT (account_id, user_id) DO NOTHING;

-- ADR-004 F6: the last owner of an account can never be deleted or demoted.
CREATE OR REPLACE FUNCTION public.guard_last_owner()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.role = 'owner')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role <> 'owner') THEN
    IF NOT EXISTS (
      SELECT 1 FROM account_members
      WHERE account_id = OLD.account_id AND role = 'owner'
        AND status = 'active' AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'cannot remove the last owner of account %', OLD.account_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_guard_last_owner ON account_members;
CREATE TRIGGER trg_guard_last_owner
  BEFORE UPDATE OR DELETE ON account_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_last_owner();

-- ADR-004 F1: NULL-email invites are bearer tokens. Expire them.
UPDATE account_invitations SET expires_at = NOW()
WHERE invited_email IS NULL AND accepted_at IS NULL AND expires_at > NOW();
```

- [ ] **Step 2: Apply and verify idempotency** — apply the migration to the dev database twice (per repo convention: Supabase MCP `execute_sql`, or `psql $POSTGRES_URL_NON_POOLING -f`). Second run must be error-free.
- [ ] **Step 3: Verify backfill**: `SELECT count(*) FROM profiles WHERE account_id IS NOT NULL` equals `SELECT count(*) FROM account_members;`. Verify guard: demoting the sole owner of any account raises `check_violation`.
- [ ] **Step 4: Commit** `feat(db): account_members join table with backfill and last-owner guard (ADR-004 D1, F1, F6)`

### Task 2: Rewrite `is_account_member()` against the join table

**Files:**
- Create: `supabase/migrations/20260813121000_membership_functions.sql` (this task appends section 1)

**Interfaces:**
- Consumes: `account_members` (Task 1).
- Produces: same signature as today — `is_account_member(target_account_id uuid, min_role account_role_enum DEFAULT 'viewer') RETURNS boolean` — so all ~250 RLS policies keep working unchanged.

- [ ] **Step 1: Write the replacement** (same file, section 1):

```sql
-- Section 1 (ADR-004 D2): membership check now reads account_members.
-- Signature is IDENTICAL to the previous version so no policy changes.
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid,
  min_role account_role_enum DEFAULT 'viewer'::account_role_enum
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM account_members m
    WHERE m.account_id = target_account_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND m.role <= min_role  -- enum order: owner < admin < agent < viewer
  );
$$;
```

**CAUTION:** verify enum comparison direction first: run `SELECT 'owner'::account_role_enum < 'viewer'::account_role_enum;`. The existing function body (migration `20260724180000_fix_is_account_member_role.sql`) is the authority — copy its exact role-comparison expression and only swap the table it reads from `profiles` to `account_members`. Do not invent a new comparison.

- [ ] **Step 2: Apply; smoke-test RLS** — as a normal user session, `SELECT count(*) FROM contacts;` must return the same count before and after this migration (backfill guarantees equivalence).
- [ ] **Step 3: Commit** `feat(db): is_account_member reads account_members (ADR-004 D2)`

### Task 3: Rewrite `redeem_invitation` — join, never move

**Files:**
- Modify: `supabase/migrations/20260813121000_membership_functions.sql` (append section 2)

**Interfaces:**
- Produces: `redeem_invitation(p_token_hash text) RETURNS uuid` (same signature; returns joined account_id). Behavior change: INSERTs membership; leaves the caller's own workspace intact.

- [ ] **Step 1: Write the replacement** (append):

```sql
-- Section 2 (ADR-004 D3 + F1 + F2): joining adds membership. The old
-- "sign up with a different email" refusal is deleted - it existed only
-- because moving profiles.account_id was destructive.
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users
  WHERE id = auth.uid() AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'invitation_email_unverified' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_inv FROM account_invitations
  WHERE token_hash = p_token_hash
    AND accepted_at IS NULL AND expires_at > NOW()
  FOR UPDATE;                       -- single-use under concurrency
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_invalid' USING ERRCODE = 'P0001';
  END IF;

  -- F1: invite is bound to the invited address; NULL-email invites are dead.
  IF v_inv.invited_email IS NULL
     OR lower(v_inv.invited_email) <> lower(v_email) THEN
    RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO account_members (account_id, user_id, role, invited_by)
  VALUES (v_inv.account_id, auth.uid(), v_inv.role, v_inv.created_by_user_id)
  ON CONFLICT (account_id, user_id) DO NOTHING;  -- already a member: idempotent

  UPDATE account_invitations
  SET accepted_at = NOW(), accepted_by_user_id = auth.uid()
  WHERE id = v_inv.id;

  -- Convenience, not security: point the newcomer at the workspace they
  -- just joined. Their own workspace remains theirs.
  UPDATE profiles SET account_id = v_inv.account_id, account_role = v_inv.role
  WHERE user_id = auth.uid();

  RETURN v_inv.account_id;
END $$;
```

**CAUTION:** before writing, read the current body in migration 019 for the exact `profiles` column names it updates (`account_role` vs a `workspace_role_id`) and mirror them; the 20260723150000 migration added `workspace_role_id` to invitations — if the current redeem copies it to profiles, preserve that line.

- [ ] **Step 2: Apply; test matrix in SQL** — as user with existing data + matching verified email: succeeds, `account_members` gains a row, user's own account untouched. Mismatched email: `invitation_email_mismatch`. Second redemption: `invitation_invalid`.
- [ ] **Step 3: Commit** `feat(db): redeem_invitation inserts membership, binds to verified email (ADR-004 D3, F1)`

### Task 4: `switch_active_account` RPC (F4 — check and write in one statement)

**Files:**
- Modify: `supabase/migrations/20260813121000_membership_functions.sql` (append section 3)

**Interfaces:**
- Produces: `switch_active_account(p_account_id uuid) RETURNS boolean` — true if switched, false if not a member (route maps false → 404, F4).

- [ ] **Step 1: Write** (append):

```sql
-- Section 3 (ADR-004 D4 + F4): membership check and pointer flip are one
-- UPDATE - no TOCTOU window.
CREATE OR REPLACE FUNCTION public.switch_active_account(p_account_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role account_role_enum;
BEGIN
  UPDATE profiles p
  SET account_id = m.account_id, account_role = m.role
  FROM account_members m
  WHERE p.user_id = auth.uid()
    AND m.user_id = auth.uid()
    AND m.account_id = p_account_id
    AND m.status = 'active'
  RETURNING m.role INTO v_role;
  RETURN v_role IS NOT NULL;
END $$;

-- ADR-004 F5: removing a member also repoints their active pointer home.
CREATE OR REPLACE FUNCTION public.repoint_on_member_removal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE profiles p SET account_id = own.account_id, account_role = own.role
  FROM account_members own
  WHERE p.user_id = OLD.user_id
    AND p.account_id = OLD.account_id        -- only if pointing at the account they lost
    AND own.user_id = OLD.user_id
    AND own.account_id <> OLD.account_id
    AND own.status = 'active';
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_repoint_on_member_removal ON account_members;
CREATE TRIGGER trg_repoint_on_member_removal
  AFTER DELETE ON account_members
  FOR EACH ROW EXECUTE FUNCTION public.repoint_on_member_removal();
```

- [ ] **Step 2: Apply; verify** — switch to member account: true + pointer flips. Switch to non-member uuid: false, pointer unchanged. Delete a membership: pointer repoints to remaining membership.
- [ ] **Step 3: Commit** `feat(db): switch_active_account and removal repoint (ADR-004 D4, F4, F5)`

### Task 5: BFF — memberships in `AccountContext` + switch route

**Files:**
- Modify: `src/features/auth/lib/account.ts`
- Create: `src/app/api/account/switch/route.ts`
- Test: `src/features/auth/lib/account.memberships.test.ts`

**Interfaces:**
- Consumes: RPCs from Tasks 2–4.
- Produces: `AccountContext.memberships: Array<{ accountId: string; accountName: string; role: AccountRole }>` (additive field); `POST /api/account/switch` body `{ accountId: string }` → `200 {ok:true}` | `404` | `401`.

- [ ] **Step 1: Failing test** for the route's decision logic (reuse the recording double from `src/lib/test/supabase-recorder.ts` for query-shape assertions, mirroring `src/features/assistant/lib/tools.catalog.test.ts`): non-member switch responds 404 and performs no profile write; member switch calls `rpc('switch_active_account', { p_account_id })`.
- [ ] **Step 2: Run test — expect FAIL** (`pnpm exec vitest run src/features/auth/lib/account.memberships.test.ts`).
- [ ] **Step 3: Implement.** In `account.ts`, inside `getCurrentAccount()` after the existing profile fetch, add one query `from('account_members').select('account_id, role, accounts(name)').eq('user_id', userId).eq('status','active')` and map to `memberships`. Route handler:

```ts
// src/app/api/account/switch/route.ts
import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/features/auth/lib/account';
import { z } from 'zod';

const bodySchema = z.object({ accountId: z.string().uuid() });

export async function POST(request: Request) {
  const ctx = await getCurrentAccount();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { data: switched, error } = await ctx.supabase.rpc('switch_active_account', {
    p_account_id: parsed.data.accountId,
  });
  if (error) return NextResponse.json({ error: 'switch_failed' }, { status: 500 });
  if (!switched) return NextResponse.json({ error: 'not_found' }, { status: 404 }); // F4: 404, not 403
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests — PASS**; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(account): memberships in context + switch endpoint (ADR-004 D4)`

### Task 6: Join page — explicit accept, dead ends removed

**Files:**
- Modify: `src/app/join/[token]/page.tsx`, `src/app/api/invitations/[token]/redeem/route.ts`

**Interfaces:**
- Consumes: `redeem_invitation` (Task 3).
- Produces: GET shows workspace name + role + Accept button (F2 — never auto-redeems); POST redeems and redirects to `/dashboard`.

- [ ] **Step 1:** Read both files fully. Remove the "existing data" refusal branch and its "sign up with a different email" copy. Map RPC errors to UI states: `invitation_email_mismatch` → "This invite was sent to a different email address. Sign in with the invited address." · `invitation_invalid` → "This invite has expired or was already used. Ask for a new one." · `invitation_email_unverified` → "Verify your email address first."
- [ ] **Step 2:** Confirm redemption only happens on the POST route (never in the page's server component). If today's page auto-redeems on load, move that call behind the Accept button's form action.
- [ ] **Step 3:** Browser-verify with agent-browser: invited existing user accepts → lands on `/dashboard` inside the host workspace → own workspace still listed in memberships. Restore any test data.
- [ ] **Step 4: Commit** `feat(join): explicit accept, existing users join without losing their workspace (ADR-004 D3, F2)`

### Task 7: Sidebar workspace switcher

**Files:**
- Create: `src/components/layout/workspace-switcher.tsx`
- Modify: the sidebar component in `src/components/layout/` (locate the top slot; render switcher above nav)

**Interfaces:**
- Consumes: `AccountContext.memberships` (Task 5) passed from the layout RSC; `POST /api/account/switch`.
- Produces: dropdown listing memberships, active one checked; hidden entirely when `memberships.length <= 1`.

- [ ] **Step 1:** Build with existing shadcn `DropdownMenu` + sidebar patterns (match the design tokens already in the sidebar; no new colors). Current workspace name + chevron as trigger; items show workspace name + the member's role in that workspace; on select, POST switch then `router.refresh()` — server context changes, URL does not (AGENTS.md contract).
- [ ] **Step 2:** Handle the 404 path: toast "You no longer have access to that workspace" and `router.refresh()` to re-pull memberships.
- [ ] **Step 3:** Browser-verify: user with 2 memberships sees switcher, switches, `/pipelines` shows the other workspace's deals; user with 1 membership sees no switcher. Screenshot to `/tmp/agent-browser/adr004-switcher.png`.
- [ ] **Step 4: Commit** `feat(layout): sidebar workspace switcher (ADR-004 D4)`

### Task 8: Invite delivery — admin-controlled mode toggle (D5, D6, D7, F7, F8)

Delivery is an explicit workspace setting with two modes, owned by
admin/owner. Inviting users see only the active mode — never both.

**Files:**
- Create: `supabase/migrations/20260813122000_invite_delivery_mode.sql` (timestamped, per the same convention as Tasks 1–4)
- Modify: `src/app/api/account/invitations/route.ts` (server-side mode enforcement)
- Modify: `src/features/settings/components/invite-user-sheet.tsx` (render per mode)
- Modify: the email-settings tab in `src/features/settings/components/` (admin toggle — find it with `grep -rln "email" src/features/settings/components/`)
- Test: `src/features/auth/lib/invitations.delivery.test.ts`

**Interfaces:**
- Consumes: `getCurrentAccount()` (role for admin gating), `sendMail` from `src/lib/email/mailer.ts`, and the EXISTING invite-creation route `src/app/api/account/invitations/route.ts` (Task 3 changed redemption only; creation is untouched until this task).
- Produces: `invite_delivery_mode` column read by the invite route; creation response shape `{ invitation, joinUrl: string | null, deliveredVia: 'email' | 'link' }` — `joinUrl` is non-null ONLY in link mode.

- [ ] **Step 1: Migration** — additive, idempotent:

```sql
-- 20260813122000_invite_delivery_mode.sql (ADR-004 D7)
ALTER TABLE public.account_email_settings
  ADD COLUMN IF NOT EXISTS invite_delivery_mode text NOT NULL DEFAULT 'email'
  CHECK (invite_delivery_mode IN ('email', 'link'));

ALTER TABLE public.account_invitations
  ADD COLUMN IF NOT EXISTS delivered_via text
  CHECK (delivered_via IN ('email', 'link'));
```

CAUTION: confirm the settings table name from the migration that created it
(`grep -rln "email_settings" supabase/migrations/`) — if per-workspace email
settings live elsewhere, put the column on that table instead. Default
`'email'`: the auditable channel is the default; `'link'` is the deliberate
opt-out (D7).

- [ ] **Step 2: Failing tests** for the route contract:

```ts
// invitations.delivery.test.ts
it("email mode: response contains NO joinUrl", async () => {
  const res = await createInvitation(ctxWithMode("email"), payload)
  expect(res.joinUrl).toBeNull()
  expect(res.deliveredVia).toBe("email")
})
it("email mode with no sender configured: 409, no invitation row created", async () => {
  await expect(createInvitation(ctxWithMode("email", { sender: null }), payload))
    .rejects.toMatchObject({ status: 409 })
})
it("link mode: joinUrl returned once, mailer never called", async () => {
  const res = await createInvitation(ctxWithMode("link"), payload)
  expect(res.joinUrl).toMatch(/\/join\//)
  expect(mailerSpy).not.toHaveBeenCalled()
})
it("mode toggle rejected for role=agent", async () => {
  await expect(updateDeliveryMode(ctxWithRole("agent"), "link"))
    .rejects.toMatchObject({ status: 403 })
})
```

- [ ] **Step 3: Enforce server-side in the invite-creation route.** Read the mode inside the route; in `'email'` mode strip the join URL from the response entirely and send via the D6 chain (workspace SMTP → platform sender; on the platform sender the From address is the hard-coded platform domain, tenant name only in the sanitized display name, inviter in Reply-To — F8). If neither sender is configured, return 409 `"Email delivery is not configured"` — do not create the invitation, do not degrade to link. In `'link'` mode skip the mailer and return the URL. Record `delivered_via` on the invitation row either way. `invited_email` stays mandatory in BOTH modes (F1 — the link is transport, not authentication).
- [ ] **Step 4:** Run tests → green.
- [ ] **Step 5: Admin toggle UI** in the email-settings tab: a two-option radio ("Send invites by email" / "Generate invite links"), visible and mutable only for owner/admin — enforce the role server-side in the settings route, not just by hiding the control. Log mode changes to the existing audit path if one exists (`grep -rn "audit" src/lib/ src/features/settings/`).
- [ ] **Step 6: Invite sheet renders per mode.** Email mode: email field required, "Invite will be emailed to {email}", no link ever shown; unconfigured-sender error surfaces the 409 with a Settings link (admins) or "ask your admin" (non-admins). Link mode: after creation show the join URL once with a copy button and the note "Only {email} will be able to use this link". On mailer send failure AFTER creation (email mode), show the error honestly and offer re-send — never silently swallow (F7).
- [ ] **Step 7:** Browser-verify all three states (email-configured, email-unconfigured 409, link mode); screenshot each to `/tmp/agent-browser/adr004-invite-{state}.png`.
- [ ] **Step 8: Commit** `feat(settings): admin-controlled invite delivery mode (ADR-004 D7)`

### Task 9: Validation sweep + docs closeout

**Files:**
- Modify: `AGENTS.md` (V1/V2 boundary), `docs/adr/004-workspace-membership-and-invite-delivery.md` (status → Accepted)
- Test: extend `src/features/auth/lib/account.memberships.test.ts`

- [ ] **Step 1: Adversarial tests** (each maps to an ADR-004 finding): F1 mismatch rejection; F4 non-member switch → 404 + no write (mutation-test: comment the membership join out of the RPC test double expectation and confirm the test fails); F6 last-owner demotion raises.
- [ ] **Step 2: Full gate** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all green, zero new problems in touched files.
- [ ] **Step 3: End-to-end browser pass** — full loop: admin invites (email visible) → existing user accepts → switcher shows both → shared pipeline visible to both → member removed → their pointer repoints home, invite links dead. Restore all data.
- [ ] **Step 4:** Update `AGENTS.md` V1/V2 boundary ("multi-membership shipped via ADR-004; feature URLs unchanged"); flip ADR-004 to Accepted with a completion record (gate output + browser evidence, matching the ADR-003 closeout pattern).
- [ ] **Step 5: Commit** `docs: close out ADR-004 (membership shipped)`

---

## Self-review notes

- **Spec coverage:** D1→T1, D2→T2, D3→T3+T6, D4→T4+T5+T7, D5+D6+D7→T8; F1→T1+T3+T8 (email required in both delivery modes), F2→T6, F3 existing CHECK + create-route assert (role ceiling already enforced by DB CHECK — verify in T9 tests), F4→T4+T5, F5→T4, F6→T1, F7→T8 Step 6, F8→T8 Step 3 (platform From hard-coded, display name sanitized).
- **Known uncertainty flagged inline:** enum comparison direction (T2) and the exact profiles role columns (T3) must be read from the authoritative migrations before writing — both marked CAUTION with the authoritative file named.
- **Rollback:** every migration is additive; `is_account_member` can be restored from `20260724180000` verbatim if Stage 1 misbehaves — policies never changed.

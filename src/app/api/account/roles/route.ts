// ============================================================
// /api/account/roles
//
//   GET — list this workspace's hierarchy roles.
//
// Roles are the Bigin/Zoho "where do you SIT" axis (reporting
// lines / record visibility), as opposed to profiles which are the
// "what can you DO" axis. The Users table needs the names to render
// its Role column and to offer assignment, so — exactly like
// /api/account/profiles GET — this is open to every active member
// while mutations live in the Roles tab behind members:manage.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/features/auth/lib/account';

// system_key ships to the client so the UI can show a seeded role's tier
// ("L1") beside the job title. The ladder position stays legible even
// though `name` is now a free-text label an admin may rename.
const ROLE_SELECT =
  'id, name, description, parent_role_id, system_key, created_at';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('workspace_roles')
      .select(ROLE_SELECT)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[GET /api/account/roles] error:', error);
      return NextResponse.json(
        { error: 'Failed to load roles' },
        { status: 500 }
      );
    }

    // Member counts per role, from the authoritative per-account grant.
    const { data: counts } = await ctx.supabase
      .from('account_members')
      .select('workspace_role_id')
      .eq('account_id', ctx.accountId)
      .neq('status', 'deleted')
      .not('workspace_role_id', 'is', null);

    const countByRole = new Map<string, number>();
    for (const row of counts ?? []) {
      const id = row.workspace_role_id as string;
      countByRole.set(id, (countByRole.get(id) ?? 0) + 1);
    }

    return NextResponse.json({
      data: (data ?? []).map((r) => ({
        ...r,
        member_count: countByRole.get(r.id) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

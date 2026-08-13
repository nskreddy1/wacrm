// ============================================================
// POST /api/account/switch
//
// Re-points the caller's active workspace at another account they are
// an ACTIVE member of. Body: { accountId: string }.
//
// Authorisation lives in the database, not here. The endpoint calls
// `switch_active_account(uuid)` (migration 20260813132000), which
// verifies membership and writes the pointer in ONE statement, so
// there is no window between "check" and "write" for a concurrent
// removal to slip through. It returns:
//
//   true   -> switched
//   false  -> caller is not an active member (or the account does not
//             exist). Both map to 404, deliberately indistinguishable
//             so this endpoint cannot be used to enumerate which
//             account ids exist.
//
// Note this requires no workspace PERMISSION: choosing which of your
// own workspaces to look at is not a privileged action inside either
// one. It does require an authenticated, active session — so a
// deactivated member cannot switch their way out of a 403.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/features/auth/lib/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { logAuditEvent } from '@/lib/audit-events';

/** RFC 4122 canonical form. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    // getCurrentAccount (not requirePermission): switching is not gated
    // on a workspace permission, but it IS gated on having a live,
    // non-deactivated context — this throws 401/403 otherwise.
    const ctx = await getCurrentAccount();

    const limit = await checkRateLimit(
      `account-switch:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const accountId =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>).accountId
        : undefined;

    // Validate the shape before it reaches Postgres: a non-uuid would
    // otherwise surface as a 22P02 cast error (a 500-shaped failure) for
    // what is really a client mistake.
    if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) {
      return NextResponse.json(
        { error: 'accountId must be a valid uuid' },
        { status: 400 }
      );
    }

    // No-op fast path. Saves a write and keeps the audit log free of
    // self-switch noise from a double-clicked menu item.
    if (accountId === ctx.accountId) {
      return NextResponse.json({ ok: true, accountId, switched: false });
    }

    // Audit BEFORE the switch, against the account being LEFT: once the
    // pointer moves, this caller's RLS no longer permits writing to that
    // account's audit log, so a post-switch write would silently drop.
    await logAuditEvent(ctx.supabase, {
      accountId: ctx.accountId,
      actorId: ctx.userId,
      action: 'account.switched',
      entity: `account:${accountId}`,
      meta: { from_account_id: ctx.accountId, to_account_id: accountId },
    });

    const { data, error } = await ctx.supabase.rpc('switch_active_account', {
      p_account_id: accountId,
    });

    if (error) {
      console.error('[account/switch] RPC error:', error);
      return NextResponse.json(
        { error: 'Failed to switch workspace' },
        { status: 500 }
      );
    }

    // false = not an active member, or no such account. Same 404 for
    // both: distinguishing them would leak account existence.
    if (data !== true) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, accountId, switched: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

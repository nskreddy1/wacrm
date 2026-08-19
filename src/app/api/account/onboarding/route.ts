// ============================================================
// POST /api/account/onboarding — advance / finish the first-run
// wizard for the caller's OWN workspace.
//
// Security posture:
//   - requireRole('admin'): only the owner (or an admin) may rename
//     the workspace or mark onboarding done. The tenant is taken
//     from the SESSION, never from the request body, so a caller
//     can only ever touch their own account row.
//   - Writes go through the service client but are scoped by the
//     session's accountId — same pattern as the settings routes.
//   - Completion is idempotent: finishing twice keeps the FIRST
//     timestamp (it is a fact about when onboarding ended, not a
//     "last clicked" time).
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logAuditEvent } from '@/lib/audit-events';
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit';

const MAX_NAME_LEN = 120;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = await checkRateLimit(
      `account:onboarding:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      workspace_name?: unknown;
      complete?: unknown;
    } | null;
    if (!body || (body.workspace_name === undefined && body.complete === undefined)) {
      return NextResponse.json(
        { error: 'Provide workspace_name and/or complete' },
        { status: 400 }
      );
    }

    const patch: Record<string, string> = {};

    if (body.workspace_name !== undefined) {
      if (typeof body.workspace_name !== 'string') {
        return NextResponse.json(
          { error: 'workspace_name must be a string' },
          { status: 400 }
        );
      }
      const name = body.workspace_name.trim();
      if (name.length < 2 || name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          {
            error: `Workspace name must be between 2 and ${MAX_NAME_LEN} characters`,
          },
          { status: 400 }
        );
      }
      patch.name = name;
    }

    const admin = supabaseAdmin();

    if (Object.keys(patch).length > 0) {
      const { error } = await admin
        .from('accounts')
        .update(patch)
        .eq('id', ctx.accountId);
      if (error) {
        console.error('[onboarding] rename failed:', error.message);
        return NextResponse.json(
          { error: 'Could not update the workspace name' },
          { status: 500 }
        );
      }
    }

    if (body.complete === true) {
      // Idempotent: only stamp accounts that have not finished yet.
      const { error } = await admin
        .from('accounts')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', ctx.accountId)
        .is('onboarding_completed_at', null);
      if (error) {
        console.error('[onboarding] completion failed:', error.message);
        return NextResponse.json(
          { error: 'Could not finish onboarding' },
          { status: 500 }
        );
      }
    }

    await logAuditEvent(ctx.supabase, {
      accountId: ctx.accountId,
      actorId: ctx.userId,
      action:
        body.complete === true ? 'onboarding.completed' : 'onboarding.updated',
      entity: `account:${ctx.accountId}`,
      meta: patch.name ? { renamed: true } : undefined,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

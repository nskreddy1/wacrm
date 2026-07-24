// ============================================================
// /api/account/profiles/[profileId]
//
//   PATCH  — rename / redescribe / re-permission a custom profile.
//   DELETE — remove a custom profile with no assigned members.
//
// System profiles (Administrator, Standard) are immutable — both
// here (clear 400s) and at the DB (RLS policies exclude
// is_system rows from UPDATE/DELETE).
// ============================================================

import { NextResponse } from 'next/server';

import {
  requirePermission,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { isPermissionSlug } from '@/features/auth/lib/permissions';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const MAX_NAME_LEN = 80;
const MAX_DESCRIPTION_LEN = 500;

const PROFILE_SELECT =
  'id, name, description, permissions, is_system, created_at, updated_at';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const ctx = await requirePermission('members:manage');
    const { profileId } = await params;

    const limit = checkRateLimit(
      `admin:profileUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: existing } = await ctx.supabase
      .from('workspace_profiles')
      .select('id, is_system')
      .eq('id', profileId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    if (existing.is_system) {
      return NextResponse.json(
        { error: 'System profiles cannot be modified' },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      description?: unknown;
      permissions?: unknown;
    } | null;

    const patch: Record<string, unknown> = {
      updated_by_user_id: ctx.userId,
      updated_at: new Date().toISOString(),
    };

    if (body?.name !== undefined) {
      const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
      if (nameRaw === '' || nameRaw.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `'name' is required (max ${MAX_NAME_LEN} characters)` },
          { status: 400 }
        );
      }
      patch.name = nameRaw;
    }

    if (body?.description !== undefined) {
      if (body.description === null) {
        patch.description = null;
      } else if (typeof body.description === 'string') {
        const trimmed = body.description.trim();
        if (trimmed.length > MAX_DESCRIPTION_LEN) {
          return NextResponse.json(
            {
              error: `'description' must be ${MAX_DESCRIPTION_LEN} characters or fewer`,
            },
            { status: 400 }
          );
        }
        patch.description = trimmed === '' ? null : trimmed;
      }
    }

    if (body?.permissions !== undefined) {
      if (!Array.isArray(body.permissions)) {
        return NextResponse.json(
          { error: "'permissions' must be an array of permission slugs" },
          { status: 400 }
        );
      }
      const permissions = [...new Set(body.permissions)];
      for (const slug of permissions) {
        if (typeof slug !== 'string' || !isPermissionSlug(slug)) {
          return NextResponse.json(
            { error: `Unknown permission slug: ${String(slug)}` },
            { status: 400 }
          );
        }
      }
      patch.permissions = permissions;
    }

    const { data, error } = await ctx.supabase
      .from('workspace_profiles')
      .update(patch)
      .eq('id', profileId)
      .eq('account_id', ctx.accountId)
      .select(PROFILE_SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A profile with that name already exists' },
          { status: 409 }
        );
      }
      console.error('[PATCH /api/account/profiles/:id] error:', error);
      return NextResponse.json(
        { error: 'Failed to update profile' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const ctx = await requirePermission('members:manage');
    const { profileId } = await params;

    const limit = checkRateLimit(
      `admin:profileDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { data: existing } = await ctx.supabase
      .from('workspace_profiles')
      .select('id, is_system, name')
      .eq('id', profileId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    if (existing.is_system) {
      return NextResponse.json(
        { error: 'System profiles cannot be deleted' },
        { status: 400 }
      );
    }

    // Refuse deletion while members are still assigned — the admin
    // must reassign them first, mirroring Zoho's behavior. The DB
    // FK is ON DELETE RESTRICT so this is also enforced below us.
    const { count } = await ctx.supabase
      .from('profiles')
      .select('user_id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('workspace_profile_id', profileId);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `"${existing.name}" is assigned to ${count} member${count === 1 ? '' : 's'}. Reassign them to another profile first.`,
        },
        { status: 409 }
      );
    }

    const { error } = await ctx.supabase
      .from('workspace_profiles')
      .delete()
      .eq('id', profileId)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[DELETE /api/account/profiles/:id] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete profile' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { toErrorResponse } from '@/features/auth/lib/account';
import { platformAdmin } from '@/lib/supabase/admin';
import { logPlatformAudit } from '@/features/admin/lib/platform/audit';
import { sanitizePlanPatch } from '@/features/admin/lib/platform/plan-validation';

// ============================================================
// /api/admin/plans/[id] — edit or retire a single tier.
// Same gate + audit trail as the collection route.
// ============================================================

/**
 * PATCH /api/admin/plans/[id]
 *
 * Partial update of any editable field. Setting `is_default: true`
 * atomically clears the flag from the previous default first (the
 * partial unique index `plans_single_default` enforces this at the
 * DB level regardless).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let actorId: string;
  try {
    const ctx = await requireSuperAdmin();
    actorId = ctx.userId;
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = sanitizePlanPatch(body);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (Object.keys(result.patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields in body' }, {
      status: 400,
    });
  }

  const db = platformAdmin();

  const { data: before, error: loadError } = await db
    .from('plans')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (loadError) {
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }

  // Guard rails around the default flag:
  //  * becoming default requires the plan to be active;
  //  * the current default cannot simply drop the flag (or deactivate)
  //    without another plan taking it over — new signups need a tier.
  if (result.patch.is_default === true) {
    if (result.patch.is_active === false || before.is_active === false) {
      return NextResponse.json(
        { error: 'An inactive plan cannot be the default' },
        { status: 400 }
      );
    }
    await db.from('plans').update({ is_default: false }).eq('is_default', true);
  } else if (
    before.is_default &&
    (result.patch.is_default === false || result.patch.is_active === false)
  ) {
    return NextResponse.json(
      {
        error:
          'This is the default plan for new accounts. Make another plan the default first.',
      },
      { status: 400 }
    );
  }

  const { data, error } = await db
    .from('plans')
    .update(result.patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[admin/plans PATCH] failed:', error);
    return NextResponse.json({ error: 'Failed to update plan' }, {
      status: 500,
    });
  }

  await logPlatformAudit(db, {
    actorId,
    action: 'plan.updated',
    entity: `plan:${id}`,
    before: Object.fromEntries(
      Object.keys(result.patch).map((k) => [k, (before as Record<string, unknown>)[k]])
    ),
    after: result.patch,
  });

  return NextResponse.json({ plan: data });
}

/**
 * DELETE /api/admin/plans/[id]
 *
 * Hard-deletes a tier — only allowed when zero accounts sit on it
 * and it is not the default. For tiers with tenants, deactivate
 * instead (PATCH is_active: false) so existing accounts keep their
 * limits.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let actorId: string;
  try {
    const ctx = await requireSuperAdmin();
    actorId = ctx.userId;
  } catch (err) {
    return toErrorResponse(err);
  }

  const { id } = await params;
  const db = platformAdmin();

  const { data: plan } = await db
    .from('plans')
    .select('id, is_default, display_name')
    .eq('id', id)
    .maybeSingle();
  if (!plan) {
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  }
  if (plan.is_default) {
    return NextResponse.json(
      { error: 'The default plan cannot be deleted' },
      { status: 400 }
    );
  }

  const { count } = await db
    .from('accounts')
    .select('*', { count: 'exact', head: true })
    .eq('plan_id', id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `${count} account(s) are on this plan. Move them or deactivate the plan instead.`,
      },
      { status: 409 }
    );
  }

  const { error } = await db.from('plans').delete().eq('id', id);
  if (error) {
    console.error('[admin/plans DELETE] failed:', error);
    return NextResponse.json({ error: 'Failed to delete plan' }, {
      status: 500,
    });
  }

  await logPlatformAudit(db, {
    actorId,
    action: 'plan.deleted',
    entity: `plan:${id}`,
    before: { display_name: plan.display_name },
  });

  return NextResponse.json({ ok: true });
}

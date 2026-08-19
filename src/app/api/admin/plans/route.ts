import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { toErrorResponse } from '@/features/auth/lib/account';
import { platformAdmin } from '@/lib/supabase/admin';
import { logPlatformAudit } from '@/features/admin/lib/platform/audit';
import { sanitizePlanPatch } from '@/features/admin/lib/platform/plan-validation';

// ============================================================
// /api/admin/plans — super-admin plan catalog management.
//
// Everything about a tier is customizable from here: display name,
// description, pricing (minor units), currency, marketing feature
// list, badge, availability, default flag, sort order, and every
// quota limit column the quota engine reads. Gated by
// requireSuperAdmin(); the plans table has no RLS write policies,
// so this service-role path is the only writer.
// ============================================================

/**
 * GET /api/admin/plans
 *
 * Full catalog (active AND inactive) plus how many accounts sit on
 * each tier, so the operator can see the blast radius of any edit.
 */
export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const db = platformAdmin();
  const [{ data: plans, error }, { data: counts, error: countError }] =
    await Promise.all([
      db.from('plans').select('*').order('sort_order'),
      db.from('accounts').select('plan_id'),
    ]);

  if (error || countError) {
    console.error('[admin/plans GET] failed:', error ?? countError);
    return NextResponse.json(
      { error: 'Failed to load plans' },
      { status: 500 }
    );
  }

  const accountCounts: Record<string, number> = {};
  for (const row of counts ?? []) {
    const id = (row as { plan_id: string }).plan_id;
    accountCounts[id] = (accountCounts[id] ?? 0) + 1;
  }

  return NextResponse.json({ plans: plans ?? [], accountCounts });
}

/**
 * POST /api/admin/plans
 *
 * Creates a brand-new tier. Body: `{ id, display_name, ...any
 * editable field }`. The id is a permanent slug (lowercase, digits,
 * hyphens) — it lands in accounts.plan_id foreign keys, so it can
 * never be renamed, only the display_name can.
 */
export async function POST(request: Request) {
  let actorId: string;
  try {
    const ctx = await requireSuperAdmin();
    actorId = ctx.userId;
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = body.id;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(id)) {
    return NextResponse.json(
      {
        error:
          'id must be a 3-40 char slug of lowercase letters, digits and hyphens',
      },
      { status: 400 }
    );
  }
  if (typeof body.display_name !== 'string' || !body.display_name.trim()) {
    return NextResponse.json(
      { error: 'display_name is required' },
      { status: 400 }
    );
  }

  const result = sanitizePlanPatch(body);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  // New tiers may not claim the default flag on creation — flip it
  // via PATCH afterwards so the swap logic handles the previous
  // default atomically.
  delete result.patch.is_default;

  const db = platformAdmin();
  const { data, error } = await db
    .from('plans')
    .insert({ id, ...result.patch })
    .select()
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    return NextResponse.json(
      {
        error:
          status === 409 ? `Plan '${id}' already exists` : 'Failed to create plan',
      },
      { status }
    );
  }

  await logPlatformAudit(db, {
    actorId,
    action: 'plan.created',
    entity: `plan:${id}`,
    after: result.patch,
  });

  return NextResponse.json({ plan: data }, { status: 201 });
}

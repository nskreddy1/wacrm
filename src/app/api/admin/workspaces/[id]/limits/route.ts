// ============================================================
// /api/admin/workspaces/[id]/limits — per-tenant plan assignment
// and limit overrides for the super-admin console.
//
// This is how platform admins grant UNLIMITED access:
//   * whole account:  { unlimited_all: true }
//   * one feature:    { overrides: { monthly_messages: -1 } }
//   * hard cap:       { overrides: { max_contacts: 50000 } }
//   * clear override: { overrides: { max_contacts: null } }
// Sentinel semantics live in src/lib/quotas (UNLIMITED_SENTINEL).
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/features/auth/lib/account';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { platformAdmin } from '@/features/admin/lib/platform/admin-client';
import { logPlatformAudit } from '@/features/admin/lib/platform/audit';

/** Override columns a super admin may set (mirrors the table). */
const OVERRIDE_COLUMNS = [
  'max_contacts',
  'max_active_flows',
  'max_members',
  'max_channels',
  'monthly_messages',
  'monthly_broadcast_recipients',
  'monthly_ai_replies',
] as const;

type OverrideColumn = (typeof OVERRIDE_COLUMNS)[number];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();
    const { id } = await params;

    const [accountRes, overrideRes, plansRes, usageRes] = await Promise.all([
      admin
        .from('accounts')
        .select('id, name, plan_id')
        .eq('id', id)
        .maybeSingle(),
      admin
        .from('account_limit_overrides')
        .select('*')
        .eq('account_id', id)
        .maybeSingle(),
      admin
        .from('plans')
        .select('id, display_name, is_active, sort_order')
        .order('sort_order', { ascending: true }),
      admin
        .from('usage_counters')
        .select('metric, used, period_start')
        .eq('account_id', id)
        .gte(
          'period_start',
          // Current UTC month only — historical periods aren't relevant
          // to a "what's this tenant consuming right now" panel.
          `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-01`
        ),
    ]);

    if (!accountRes.data) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      account: accountRes.data,
      override: overrideRes.data ?? null,
      plans: plansRes.data ?? [],
      usage: usageRes.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();
    const { id } = await params;

    const body = (await request.json()) as Record<string, unknown>;

    // -- Validate ---------------------------------------------------------
    const patch: Record<string, unknown> = {};
    for (const column of OVERRIDE_COLUMNS) {
      if (!(column in body)) continue;
      const value = body[column];
      // NULL clears the override; -1 = unlimited; N >= 0 = hard cap.
      if (value !== null && (!Number.isInteger(value) || (value as number) < -1)) {
        return NextResponse.json(
          { error: `${column} must be null, -1 (unlimited), or an integer >= 0` },
          { status: 400 }
        );
      }
      patch[column] = value;
    }
    if ('unlimited_all' in body) {
      if (typeof body.unlimited_all !== 'boolean') {
        return NextResponse.json(
          { error: 'unlimited_all must be a boolean' },
          { status: 400 }
        );
      }
      patch.unlimited_all = body.unlimited_all;
    }
    if ('reason' in body) {
      if (
        body.reason !== null &&
        (typeof body.reason !== 'string' || body.reason.length > 500)
      ) {
        return NextResponse.json(
          { error: 'reason must be a string (max 500 chars) or null' },
          { status: 400 }
        );
      }
      patch.reason = body.reason;
    }

    let planChanged = false;
    if ('plan_id' in body) {
      if (typeof body.plan_id !== 'string') {
        return NextResponse.json(
          { error: 'plan_id must be a string' },
          { status: 400 }
        );
      }
      const { data: plan } = await admin
        .from('plans')
        .select('id')
        .eq('id', body.plan_id)
        .maybeSingle();
      if (!plan) {
        return NextResponse.json(
          { error: `Unknown plan '${body.plan_id}'` },
          { status: 400 }
        );
      }
      const { error: planErr } = await admin
        .from('accounts')
        .update({ plan_id: body.plan_id })
        .eq('id', id);
      if (planErr) {
        console.error('[PUT /api/admin/workspaces/:id/limits] plan:', planErr);
        return NextResponse.json(
          { error: 'Failed to change plan' },
          { status: 500 }
        );
      }
      planChanged = true;
    }

    // -- Upsert the override row (only if any override field was sent) ----
    if (Object.keys(patch).length > 0) {
      const { error: upsertErr } = await admin
        .from('account_limit_overrides')
        .upsert(
          { account_id: id, ...patch, updated_at: new Date().toISOString() },
          { onConflict: 'account_id' }
        );
      if (upsertErr) {
        console.error(
          '[PUT /api/admin/workspaces/:id/limits] upsert:',
          upsertErr
        );
        return NextResponse.json(
          { error: 'Failed to save overrides' },
          { status: 500 }
        );
      }
    } else if (!planChanged) {
      return NextResponse.json(
        { error: 'Nothing to update' },
        { status: 400 }
      );
    }

    // Audit: granting unlimited access is exactly the kind of action
    // that must be attributable later. Values logged, no PII.
    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId: id,
      action: 'workspace.limits_updated',
      entity: `account:${id}`,
      after: {
        ...(planChanged ? { plan_id: body.plan_id } : {}),
        ...patch,
      },
    });

    const { data: override } = await admin
      .from('account_limit_overrides')
      .select('*')
      .eq('account_id', id)
      .maybeSingle();

    return NextResponse.json({ ok: true, override: override ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

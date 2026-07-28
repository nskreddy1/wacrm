import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/features/flows/lib/admin-client';

/**
 * Notification destinations management.
 *
 * Reads go through the caller's RLS-scoped client (defense in depth: even
 * a bug here cannot leak another tenant's rows). The column list matches
 * the browser-safe grant — credentials_encrypted is not selectable by
 * design, so tokens cannot leak through this endpoint even by accident.
 *
 * Writes require admin and are strictly scoped by account_id.
 */

const SAFE_COLUMNS =
  'id, account_id, provider, display_name, config, event_types, enabled, created_at, updated_at';

export async function GET() {
  let ctx;
  try {
    ctx = await requireRole('viewer');
  } catch (error) {
    return toErrorResponse(error);
  }

  const { data, error } = await ctx.supabase
    .from('alert_destinations')
    .select(SAFE_COLUMNS)
    .eq('account_id', ctx.accountId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ destinations: data ?? [] });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  display_name: z.string().trim().min(1).max(120).optional(),
  event_types: z.array(z.string().min(1).max(64)).min(1).max(16).optional(),
  /**
   * Provider-specific routing (e.g. picked Slack channel). Merged
   * server-side onto the existing config so a partial update can never
   * wipe fields it did not mention (team_id must survive a channel pick).
   */
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (error) {
    return toErrorResponse(error);
  }

  const rate = await checkRateLimit(
    `alerts-dest-write:${ctx.userId}`,
    RATE_LIMITS.adminAction
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { id, config, ...fields } = parsed.data;

  const db = supabaseAdmin();

  // Ownership check BEFORE the write (service role bypasses RLS).
  const { data: existing } = await db
    .from('alert_destinations')
    .select('id, account_id, provider, config')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = { ...fields };
  if (config) {
    update.config = { ...(existing.config as object), ...config };
  }

  const { error } = await db
    .from('alert_destinations')
    .update(update)
    .eq('id', id)
    .eq('account_id', ctx.accountId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (error) {
    return toErrorResponse(error);
  }

  const rate = await checkRateLimit(
    `alerts-dest-write:${ctx.userId}`,
    RATE_LIMITS.adminAction
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: existing } = await db
    .from('alert_destinations')
    .select('id, provider')
    .eq('id', parsed.data.id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.provider === 'team_chat') {
    // The tier-1 built-in is the delivery floor — it can be disabled via
    // PATCH but never deleted, so alerts always have somewhere to land.
    return NextResponse.json(
      { error: 'The built-in team chat destination cannot be deleted' },
      { status: 422 }
    );
  }

  const { error } = await db
    .from('alert_destinations')
    .delete()
    .eq('id', parsed.data.id)
    .eq('account_id', ctx.accountId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

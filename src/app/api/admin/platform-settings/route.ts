import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { toErrorResponse } from '@/features/auth/lib/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  getAiEngine,
  resetEngineCache,
  type AiEngine,
} from '@/features/assistant/lib/ai/engine-flag';
import {
  getInviteDeliveryMode,
  isInviteDeliveryMode,
  resetInviteDeliveryModeCache,
  PLATFORM_SETTING_KEY,
} from '@/lib/email/invite-delivery-mode';
import { logPlatformAudit } from '@/features/admin/lib/platform/audit';
import { getPlatformTransportSummary } from '@/lib/email/platform-invite-transport';

// ============================================================
// Platform settings — super-admin control surface.
//
// Both methods are gated by the shared `requireSuperAdmin()` helper
// (DB flag `profiles.is_super_admin`, with the SUPER_ADMIN_EMAILS
// env allowlist as a transition fallback); everyone else gets 403.
//
// The table itself has RLS enabled with no policies, so reads/writes
// only ever happen here through the service-role client — after the
// gate has passed.
// ============================================================

/**
 * GET /api/admin/platform-settings
 *
 * Returns the resolved `ai_engine` value — including the default when
 * no row exists — so the caller sees what the platform is actually
 * running, not just the raw stored value.
 */
export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  // Resolve fresh (bust the local caches first) so a super admin never
  // reads a stale value from this instance's TTL cache.
  resetEngineCache();
  resetInviteDeliveryModeCache();
  const [engine, inviteDeliveryMode] = await Promise.all([
    getAiEngine(),
    getInviteDeliveryMode(),
  ]);
  return NextResponse.json({
    ai_engine: engine,
    invite_delivery_mode: inviteDeliveryMode,
  });
}

/**
 * PATCH /api/admin/platform-settings
 *
 * Body: `{ "ai_engine": "direct" | "langchain" }`. Upserts the flag
 * through the service-role client, then busts this instance's flag
 * cache so the change applies immediately here; other serverless
 * instances converge within the cache TTL (~30s).
 */
export async function PATCH(request: Request) {
  let ctx;
  try {
    ctx = await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as {
    ai_engine?: unknown;
    invite_delivery_mode?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Build the upsert set from ONLY the keys the caller actually sent, so
  // patching one setting can't silently reset the other. Unknown values
  // are rejected outright rather than coerced — this table drives
  // whether the platform emails strangers.
  const rows: { key: string; value: string; updated_at: string }[] = [];
  const now = new Date().toISOString();
  const result: { ai_engine?: AiEngine; invite_delivery_mode?: string } = {};

  if ('ai_engine' in body) {
    const value = body.ai_engine;
    if (value !== 'direct' && value !== 'langchain') {
      return NextResponse.json(
        { error: "ai_engine must be 'direct' or 'langchain'" },
        { status: 400 }
      );
    }
    rows.push({ key: 'ai_engine', value, updated_at: now });
    result.ai_engine = value satisfies AiEngine;
  }

  if ('invite_delivery_mode' in body) {
    const value = body.invite_delivery_mode;
    if (!isInviteDeliveryMode(value)) {
      return NextResponse.json(
        { error: "invite_delivery_mode must be 'email' or 'link_only'" },
        { status: 400 }
      );
    }
    // Configure-before-enable: turning email delivery ON is only
    // allowed once a sender actually exists. Otherwise the operator
    // flips the switch, invites silently fall through to no_provider,
    // and nobody notices until a new hire never gets their invite.
    // Enforced here (not just in the UI) because the UI is not a
    // security or correctness boundary.
    if (value === 'email') {
      const summary = await getPlatformTransportSummary();
      const envFallback = Boolean(process.env.RESEND_API_KEY);
      if (!summary.configured && !envFallback) {
        return NextResponse.json(
          {
            error:
              'Configure an invite sender before enabling email delivery. ' +
              'Until then, invites keep generating copyable links.',
          },
          { status: 409 }
        );
      }
    }
    rows.push({ key: PLATFORM_SETTING_KEY, value, updated_at: now });
    result.invite_delivery_mode = value;
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'Provide ai_engine and/or invite_delivery_mode' },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin()
    .from('platform_settings')
    .upsert(rows, { onConflict: 'key' });

  if (error) {
    console.error('[admin/platform-settings PATCH] upsert failed:', error);
    return NextResponse.json(
      { error: 'Failed to save platform setting' },
      { status: 500 }
    );
  }

  // Turning invite email on/off must take effect now, not in 30s.
  if (result.ai_engine !== undefined) resetEngineCache();
  if (result.invite_delivery_mode !== undefined) {
    resetInviteDeliveryModeCache();
  }

  // Record who flipped a platform-wide switch. Enabling outbound mail
  // is exactly the kind of change that needs an operator trail.
  // `logPlatformAudit` never throws — it logs and moves on.
  await logPlatformAudit(ctx.supabase, {
    actorId: ctx.userId,
    accountId: null, // platform-wide, not tenant-scoped
    action: 'platform_settings.update',
    entity: 'platform_settings',
    after: result,
  });

  return NextResponse.json(result);
}

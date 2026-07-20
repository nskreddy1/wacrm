import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  getAiEngine,
  resetEngineCache,
  type AiEngine,
} from '@/lib/ai/engine-flag'

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
    await requireSuperAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  // Resolve fresh (bust the local cache first) so a super admin never
  // reads a stale value from this instance's TTL cache.
  resetEngineCache()
  const engine = await getAiEngine()
  return NextResponse.json({ ai_engine: engine })
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
  try {
    await requireSuperAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as {
    ai_engine?: unknown
  } | null
  const value = body?.ai_engine
  if (value !== 'direct' && value !== 'langchain') {
    return NextResponse.json(
      { error: "ai_engine must be 'direct' or 'langchain'" },
      { status: 400 },
    )
  }
  const engine: AiEngine = value

  const { error } = await supabaseAdmin()
    .from('platform_settings')
    .upsert(
      { key: 'ai_engine', value: engine, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )

  if (error) {
    console.error('[admin/platform-settings PATCH] upsert failed:', error)
    return NextResponse.json(
      { error: 'Failed to save platform setting' },
      { status: 500 },
    )
  }

  resetEngineCache()
  return NextResponse.json({ ai_engine: engine })
}

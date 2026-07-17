import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSuperAdmin } from '@/lib/auth/super-admin'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  getAiEngine,
  resetEngineCache,
  type AiEngine,
} from '@/lib/ai/engine-flag'

// ============================================================
// Platform settings — super-admin control surface.
//
// The interim API for flipping the platform-wide `ai_engine` flag
// (a full super-admin UI is a future phase). Both methods require an
// authenticated Supabase user whose email is on the
// SUPER_ADMIN_EMAILS allowlist; everyone else gets 403.
//
// The table itself has RLS enabled with no policies, so reads/writes
// only ever happen here through the service-role client — after the
// gate has passed.
// ============================================================

/** 401 for no session, 403 for a session that isn't a super admin. */
async function requireSuperAdmin(): Promise<NextResponse | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }
  if (!isSuperAdmin(user.email)) {
    return NextResponse.json(
      { error: 'Super admin access required' },
      { status: 403 },
    )
  }
  return null
}

/**
 * GET /api/admin/platform-settings
 *
 * Returns the resolved `ai_engine` value — including the default when
 * no row exists — so the caller sees what the platform is actually
 * running, not just the raw stored value.
 */
export async function GET() {
  const denied = await requireSuperAdmin()
  if (denied) return denied

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
  const denied = await requireSuperAdmin()
  if (denied) return denied

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

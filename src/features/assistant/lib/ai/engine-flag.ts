import { supabaseAdmin } from './admin-client'

// ============================================================
// Platform-wide AI engine flag.
//
// One global value decides which engine serves BOTH chat generation
// and embeddings: the restored direct fetch adapters
// (engines/direct) or LangChain (engines/langchain).
//
// Resolution order:
//   1. platform_settings row (key = 'ai_engine') — set by super
//      admins via /api/admin/platform-settings
//   2. AI_ENGINE env var — handy for local dev / tests
//   3. default: 'direct'
//
// The DB read is cached in-module for a short TTL so per-message
// webhook traffic doesn't add a query per AI call. The admin route
// busts this cache after an update; other serverless instances
// converge within the TTL.
// ============================================================

export type AiEngine = 'direct' | 'langchain'

export const DEFAULT_AI_ENGINE: AiEngine = 'direct'

/** How long a fetched flag value is trusted before re-reading the DB. */
const CACHE_TTL_MS = 30_000

let cached: { value: AiEngine; expiresAt: number } | null = null

function isAiEngine(value: unknown): value is AiEngine {
  return value === 'direct' || value === 'langchain'
}

/** Env fallback (also the local-dev/test override when no DB row exists). */
function envEngine(): AiEngine | null {
  const raw = process.env.AI_ENGINE?.trim().toLowerCase()
  return isAiEngine(raw) ? raw : null
}

/**
 * Resolve the current AI engine. DB value wins; on a missing row the
 * `AI_ENGINE` env var applies; otherwise the default (`direct`). DB
 * errors fall back to env/default and log a breadcrumb — an outage of
 * the settings table must never take the reply path down with it.
 */
export async function getAiEngine(): Promise<AiEngine> {
  const now = Date.now()
  if (cached && now < cached.expiresAt) return cached.value

  let value: AiEngine | null = null
  try {
    const { data, error } = await supabaseAdmin()
      .from('platform_settings')
      .select('value')
      .eq('key', 'ai_engine')
      .maybeSingle()
    if (error) {
      console.error('[ai/engine-flag] settings read failed:', error.message)
    } else if (data && isAiEngine(data.value)) {
      value = data.value
    }
  } catch (err) {
    console.error('[ai/engine-flag] settings read threw:', err)
  }

  const resolved = value ?? envEngine() ?? DEFAULT_AI_ENGINE
  cached = { value: resolved, expiresAt: now + CACHE_TTL_MS }
  return resolved
}

/**
 * Drop the cached value so the next `getAiEngine()` re-reads the DB.
 * Used by tests and by the admin route right after an update so the
 * local instance reflects the change immediately.
 */
export function resetEngineCache(): void {
  cached = null
}

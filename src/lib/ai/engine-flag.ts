import { supabaseAdmin } from './admin-client'

// ============================================================
// Platform-wide AI engine flag.
//
// Switches BOTH chat generation and embeddings between the direct
// fetch adapters and the LangChain engine. Resolution order:
//   1. `platform_settings` row with key 'ai_engine' (set by super
//      admins via /api/admin/platform-settings)
//   2. `AI_ENGINE` env var (handy for local dev / tests)
//   3. default: 'direct'
//
// A short in-memory TTL cache keeps per-message webhook traffic from
// adding a DB read to every AI call. DB errors fall back to the
// default with a logged breadcrumb — the flag must never take the
// AI path down.
// ============================================================

export type AiEngine = 'direct' | 'langchain'

export const AI_ENGINE_KEY = 'ai_engine'
export const DEFAULT_AI_ENGINE: AiEngine = 'direct'

const CACHE_TTL_MS = 30_000

let cache: { value: AiEngine; at: number } | null = null

export function isAiEngine(value: unknown): value is AiEngine {
  return value === 'direct' || value === 'langchain'
}

/** Bust the module-level cache — used by tests and by the admin route
 *  right after an update so this instance reflects it immediately. */
export function resetEngineCache(): void {
  cache = null
}

function envEngine(): AiEngine | null {
  const raw = process.env.AI_ENGINE?.trim().toLowerCase()
  return isAiEngine(raw) ? raw : null
}

/**
 * Resolve the current platform-wide AI engine. Never throws — any
 * lookup failure falls back to the env var, then the default.
 */
export async function getAiEngine(): Promise<AiEngine> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value
  }

  let fromDb: AiEngine | null = null
  try {
    const { data, error } = await supabaseAdmin()
      .from('platform_settings')
      .select('value')
      .eq('key', AI_ENGINE_KEY)
      .maybeSingle()
    if (error) {
      console.error('[engine-flag] platform_settings read error:', error)
    } else if (data) {
      // `value` is jsonb — stored as a bare string ("direct"|"langchain").
      const v = data.value
      if (isAiEngine(v)) {
        fromDb = v
      } else {
        console.error('[engine-flag] unrecognized ai_engine value:', v)
      }
    }
  } catch (err) {
    // Missing env / unreachable DB (e.g. unit tests) — fall through.
    console.error('[engine-flag] platform_settings lookup failed:', err)
  }

  const resolved = fromDb ?? envEngine() ?? DEFAULT_AI_ENGINE
  cache = { value: resolved, at: Date.now() }
  return resolved
}

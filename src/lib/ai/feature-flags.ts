import { supabaseAdmin } from './admin-client'
import type { AiConfig } from './types'

// ============================================================
// Per-account AI optimization flags + platform kill-switch.
//
// Two layers, both required for a feature to be ON:
//   1. Account opt-in — `ai_configs.feature_flags` JSONB, e.g.
//      {"prompt_caching": true}. Default '{}' = everything OFF.
//      RLS-scoped with the rest of ai_configs (tenant-isolated).
//   2. Platform kill-switch — `platform_settings` row with key
//      'ai_disabled_features' whose value is a JSON array of
//      feature names (e.g. ["prompt_caching"]). Lets a super
//      admin disable a misbehaving optimization for EVERY
//      account instantly, without touching account rows.
//      Env override for local dev/tests: AI_DISABLED_FEATURES
//      (comma-separated).
//
// Mirrors the engine-flag pattern: the kill-switch read is
// cached in-module for a short TTL so per-message webhook
// traffic doesn't add a query per AI call, and a DB outage
// falls back safely (features stay account-controlled) rather
// than taking the reply path down.
// ============================================================

/** Feature names recognized in `ai_configs.feature_flags`. */
export type AiFeatureName = 'prompt_caching'

/** Parsed per-account flags, all defaulting to false. */
export interface AiFeatureFlags {
  /** Provider prompt-cache alignment: stable-prefix prompt structure +
   *  cache_control/prompt_cache_key wiring + cached-token telemetry. */
  promptCaching: boolean
}

export const DEFAULT_FEATURE_FLAGS: AiFeatureFlags = {
  promptCaching: false,
}

/**
 * Parse the raw JSONB column into typed flags. Unknown keys are
 * ignored; anything other than an explicit `true` is OFF (a malformed
 * value must never silently enable an optimization).
 */
export function parseFeatureFlags(raw: unknown): AiFeatureFlags {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_FEATURE_FLAGS }
  }
  const obj = raw as Record<string, unknown>
  return {
    promptCaching: obj.prompt_caching === true,
  }
}

/** How long a fetched kill-switch value is trusted before re-reading. */
const CACHE_TTL_MS = 30_000

let killCache: { value: Set<string>; expiresAt: number } | null = null

function envDisabled(): Set<string> {
  const raw = process.env.AI_DISABLED_FEATURES
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

/**
 * Platform-wide disabled feature set. DB row wins; env var is unioned
 * in (so local dev can force-disable without a DB row). On DB error →
 * env-only, logged: an outage of platform_settings must never block
 * replies, and "kill-switch unreadable" safely degrades to
 * "account flags decide".
 */
async function getDisabledFeatures(): Promise<Set<string>> {
  const now = Date.now()
  if (killCache && now < killCache.expiresAt) return killCache.value

  const disabled = envDisabled()
  try {
    const { data, error } = await supabaseAdmin()
      .from('platform_settings')
      .select('value')
      .eq('key', 'ai_disabled_features')
      .maybeSingle()
    if (error) {
      console.error('[ai/feature-flags] kill-switch read failed:', error.message)
    } else if (data && Array.isArray(data.value)) {
      for (const v of data.value) {
        if (typeof v === 'string') disabled.add(v.trim().toLowerCase())
      }
    }
  } catch (err) {
    console.error('[ai/feature-flags] kill-switch read threw:', err)
  }

  killCache = { value: disabled, expiresAt: now + CACHE_TTL_MS }
  return disabled
}

/**
 * Is an AI optimization live for this account? Requires BOTH the
 * account's opt-in AND the absence of a platform kill. Never throws.
 */
export async function isAiFeatureEnabled(
  config: Pick<AiConfig, 'featureFlags'>,
  feature: AiFeatureName,
): Promise<boolean> {
  const optedIn =
    feature === 'prompt_caching' && config.featureFlags?.promptCaching === true
  if (!optedIn) return false
  const disabled = await getDisabledFeatures()
  return !disabled.has(feature)
}

/** Test helper: drop the cached kill-switch so the next call re-reads. */
export function resetFeatureFlagCache(): void {
  killCache = null
}

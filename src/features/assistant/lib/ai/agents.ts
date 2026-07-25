import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/features/whatsapp/lib/encryption';
import type { AiConfig, AiProvider, AutoReplyLimitMode } from './types';
import { isAiProvider, isAutoReplyLimitMode } from './types';

// ============================================================
// Single default agent — server loader.
//
// Product decision (2026-07-25): each account has ONE agent row
// (`ai_agents`, kind='default') — one provider, BYO key, model and
// persona — with two independently toggleable capabilities stored in
// their own columns:
//   • suggestions_enabled — AI draft suggestions in the inbox
//   • autoreply_enabled   — automatic customer replies
//
// See migration 20260725150000_single_default_agent.sql.
//
// Compatibility strategy: runtime consumers (auto-reply engine, inbox
// draft route, playground) all speak `AiConfig`, and the generation
// engine underneath (generate/dispatch/usage) is provider-plumbing
// that doesn't care where the config came from. So `loadAgentConfig`
// maps the agent row onto `AiConfig` instead of introducing a
// parallel type — the entire engine keeps working untouched.
// ============================================================

/** The two independently toggleable capabilities of the agent. */
export type AgentCapability = 'suggestions' | 'autoreply';

export function isAgentCapability(value: unknown): value is AgentCapability {
  return value === 'suggestions' || value === 'autoreply';
}

/** `ai_agents.settings` jsonb. All optional — the API layer fills
 *  defaults on read, so a partially-saved agent is valid. Behavior
 *  settings only apply to the auto-reply capability. */
export interface AgentSettings {
  /** Max bot replies counted against `limitMode`. Default 3. */
  replyCap?: number;
  limitMode?: AutoReplyLimitMode;
  /** 'HH:MM' 24h local to `timezone`. Both null = always on. */
  scheduleStart?: string | null;
  scheduleEnd?: string | null;
  /** IANA timezone the schedule is evaluated in. Null = UTC. */
  timezone?: string | null;
  /** Human agent (auth.users.id) receiving escalation handoffs; null =
   *  shared queue. */
  handoffAgentId?: string | null;
  /** Optional OpenAI-compatible key for KB embeddings, encrypted. */
  embeddingsApiKey?: string | null;
}

/** Raw `ai_agents` row as selected by AGENT_COLUMNS. */
export interface AgentRow {
  id: string;
  display_name: string;
  provider: string | null;
  model: string | null;
  api_key: string | null;
  base_url: string | null;
  system_prompt: string | null;
  is_enabled: boolean;
  suggestions_enabled: boolean;
  autoreply_enabled: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const AGENT_COLUMNS =
  'id, display_name, provider, model, api_key, base_url, system_prompt, is_enabled, suggestions_enabled, autoreply_enabled, settings, created_at, updated_at';

const DEFAULT_REPLY_CAP = 3;

/** Postgres/JSON 'HH:MM:SS' or 'HH:MM' → 'HH:MM' | null. */
function toHhMm(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const m = /^(\d{2}:\d{2})/.exec(value);
  return m ? m[1] : null;
}

function readSettings(raw: Record<string, unknown>): Required<
  Omit<AgentSettings, 'embeddingsApiKey'>
> & {
  embeddingsApiKey: string | null;
} {
  const cap = Number(raw.replyCap);
  return {
    replyCap:
      Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : DEFAULT_REPLY_CAP,
    limitMode: isAutoReplyLimitMode(raw.limitMode)
      ? raw.limitMode
      : 'per_conversation',
    scheduleStart: toHhMm(raw.scheduleStart),
    scheduleEnd: toHhMm(raw.scheduleEnd),
    timezone:
      typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : null,
    handoffAgentId:
      typeof raw.handoffAgentId === 'string' && raw.handoffAgentId
        ? raw.handoffAgentId
        : null,
    embeddingsApiKey:
      typeof raw.embeddingsApiKey === 'string' && raw.embeddingsApiKey
        ? raw.embeddingsApiKey
        : null,
  };
}

/**
 * Decrypt the agent's embeddings key. Failures downgrade to lexical KB
 * search rather than taking down the agent, but leave a breadcrumb —
 * a rotated ENCRYPTION_KEY here silently disables semantic search.
 */
function decryptEmbeddingsKey(
  encrypted: string | null,
  accountId: string
): string | null {
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    console.error(
      `[ai agent] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`
    );
    return null;
  }
}

/** Fetch the account's single default agent row, or null. */
export async function fetchAgentRow(
  db: SupabaseClient,
  accountId: string
): Promise<AgentRow | null> {
  const { data, error } = await db
    .from('ai_agents')
    .select(AGENT_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  return (data as AgentRow) ?? null;
}

/**
 * Load the agent's config for *use* by one capability surface.
 * Returns null when the agent doesn't exist, the master switch or the
 * requested capability is off (unless `requireEnabled: false` — the
 * Playground's "test before enabling" path), or there's no usable key.
 *
 * No env-key fallback: the rebuilt system is explicit — the agent the
 * client can see is the only thing that can spend money. Throws only
 * when the stored key can't be decrypted (mismatched ENCRYPTION_KEY),
 * so that surfaces as an error instead of "not configured".
 *
 * Works with any client: RLS-scoped SSR client from dashboard routes,
 * or the service-role admin client from webhooks.
 */
export async function loadAgentConfig(
  db: SupabaseClient,
  accountId: string,
  capability: AgentCapability,
  opts: { requireEnabled?: boolean } = {}
): Promise<(AiConfig & { agentId: string }) | null> {
  const { requireEnabled = true } = opts;
  const row = await fetchAgentRow(db, accountId);
  if (!row) return null;

  if (requireEnabled) {
    if (!row.is_enabled) return null;
    if (capability === 'suggestions' && !row.suggestions_enabled) return null;
    if (capability === 'autoreply' && !row.autoreply_enabled) return null;
  }

  // Ollama needs no key; every other provider does. A row without a
  // usable provider+model+key is "not configured yet" (mid-wizard).
  if (!row.provider || !isAiProvider(row.provider) || !row.model) return null;
  if (!row.api_key && row.provider !== 'ollama') return null;

  const settings = readSettings(row.settings ?? {});
  const forAutoreply = capability === 'autoreply';

  return {
    agentId: row.id,
    provider: row.provider as AiProvider,
    model: row.model,
    apiKey: row.api_key ? decrypt(row.api_key) : '',
    baseUrl: row.base_url,
    systemPrompt: row.system_prompt,
    isActive: row.is_enabled && row.suggestions_enabled,
    autoReplyEnabled: row.is_enabled && row.autoreply_enabled,
    autoReplyMaxPerConversation: settings.replyCap,
    autoReplyLimitMode: settings.limitMode,
    autoReplyScheduleStart: forAutoreply ? settings.scheduleStart : null,
    autoReplyScheduleEnd: forAutoreply ? settings.scheduleEnd : null,
    autoReplyTimezone: forAutoreply ? settings.timezone : null,
    handoffAgentId: forAutoreply ? settings.handoffAgentId : null,
    embeddingsApiKey: decryptEmbeddingsKey(
      settings.embeddingsApiKey,
      accountId
    ),
    keySource: 'account',
  };
}

/**
 * Load + decrypt the account's embeddings key from the agent row.
 * Signature mirrors the old `loadEmbeddingsKey` so KB ingest routes
 * migrate with an import swap.
 */
export async function loadAgentsEmbeddingsKey(
  db: SupabaseClient,
  accountId: string
): Promise<{ key: string | null; corrupt: boolean }> {
  let row: AgentRow | null = null;
  try {
    row = await fetchAgentRow(db, accountId);
  } catch {
    return { key: null, corrupt: false };
  }
  const enc = row?.settings
    ? (row.settings as Record<string, unknown>).embeddingsApiKey
    : null;
  if (typeof enc !== 'string' || !enc) return { key: null, corrupt: false };
  try {
    return { key: decrypt(enc), corrupt: false };
  } catch {
    console.error(
      `[ai agent] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`
    );
    return { key: null, corrupt: true };
  }
}

/**
 * Client-safe projection of the agent row: the API key NEVER leaves
 * the server after save — the client only learns whether one is
 * stored. The encrypted embeddings key is likewise reduced to a
 * boolean.
 */
export function toClientAgent(row: AgentRow) {
  const settings = { ...(row.settings ?? {}) } as Record<string, unknown>;
  const hasEmbeddingsKey =
    typeof settings.embeddingsApiKey === 'string' &&
    settings.embeddingsApiKey.length > 0;
  delete settings.embeddingsApiKey;

  return {
    id: row.id,
    displayName: row.display_name,
    provider: row.provider,
    model: row.model,
    hasApiKey: Boolean(row.api_key),
    baseUrl: row.base_url,
    systemPrompt: row.system_prompt,
    isEnabled: row.is_enabled,
    suggestionsEnabled: row.suggestions_enabled,
    autoreplyEnabled: row.autoreply_enabled,
    settings,
    hasEmbeddingsKey,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ClientAgent = ReturnType<typeof toClientAgent>;

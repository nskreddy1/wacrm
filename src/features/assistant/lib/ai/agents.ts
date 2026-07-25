import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/features/whatsapp/lib/encryption';
import type {
  AiConfig,
  AiProvider,
  AutoReplyLimitMode,
} from './types';
import { isAiProvider, isAutoReplyLimitMode } from './types';

// ============================================================
// Per-agent AI system — server loader.
//
// Replaces the single shared `ai_configs` row with one `ai_agents` row
// per agent kind, each fully self-contained (own provider, BYO key,
// model, prompt, behavior settings). See migration
// 20260725130000_ai_agents_rebuild.sql for the schema and RLS.
//
// Compatibility strategy: runtime consumers (auto-reply engine, inbox
// draft route, playground) all speak `AiConfig`, and the generation
// engine underneath (generate/dispatch/usage) is provider-plumbing that
// doesn't care where the config came from. So `loadAgentConfig` maps an
// agent row onto `AiConfig` instead of introducing a parallel type —
// the entire engine keeps working untouched.
// ============================================================

export type AgentKind = 'copilot' | 'autoreply';

export const AGENT_KINDS: readonly AgentKind[] = ['copilot', 'autoreply'];

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && AGENT_KINDS.includes(value as AgentKind);
}

/** `ai_agents.settings` for the autoreply kind. All optional — the API
 *  layer fills defaults on read, so a partially-saved agent is valid. */
export interface AutoreplyAgentSettings {
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

/** `ai_agents.settings` for the copilot kind. */
export interface CopilotAgentSettings {
  /** Optional OpenAI-compatible key for KB embeddings, encrypted. */
  embeddingsApiKey?: string | null;
}

/** Raw `ai_agents` row as selected by AGENT_COLUMNS. */
export interface AgentRow {
  id: string;
  kind: AgentKind;
  display_name: string;
  provider: string | null;
  model: string | null;
  api_key: string | null;
  base_url: string | null;
  system_prompt: string | null;
  is_enabled: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const AGENT_COLUMNS =
  'id, kind, display_name, provider, model, api_key, base_url, system_prompt, is_enabled, settings, created_at, updated_at';

const DEFAULT_REPLY_CAP = 3;

/** Postgres/JSON 'HH:MM:SS' or 'HH:MM' → 'HH:MM' | null. */
function toHhMm(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const m = /^(\d{2}:\d{2})/.exec(value);
  return m ? m[1] : null;
}

function readAutoreplySettings(
  raw: Record<string, unknown>
): Required<Omit<AutoreplyAgentSettings, 'embeddingsApiKey'>> & {
  embeddingsApiKey: string | null;
} {
  const cap = Number(raw.replyCap);
  return {
    replyCap: Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : DEFAULT_REPLY_CAP,
    limitMode: isAutoReplyLimitMode(raw.limitMode)
      ? raw.limitMode
      : 'per_conversation',
    scheduleStart: toHhMm(raw.scheduleStart),
    scheduleEnd: toHhMm(raw.scheduleEnd),
    timezone: typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : null,
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
 * Decrypt an agent's embeddings key. Failures downgrade to lexical KB
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
      `[ai agents] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`
    );
    return null;
  }
}

/**
 * Load ONE agent's config for *use* (generation). Returns null when the
 * agent doesn't exist, is disabled (unless `requireEnabled: false` —
 * the Playground's "test before enabling" path), or has no usable key.
 *
 * No env-key fallback: the rebuilt system is explicit — an agent the
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
  kind: AgentKind,
  opts: { requireEnabled?: boolean } = {}
): Promise<(AiConfig & { agentId: string }) | null> {
  const { requireEnabled = true } = opts;
  const { data, error } = await db
    .from('ai_agents')
    .select(AGENT_COLUMNS)
    .eq('account_id', accountId)
    .eq('kind', kind)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as AgentRow;
  if (requireEnabled && !row.is_enabled) return null;
  // Ollama needs no key; every other provider does. A row without a
  // usable provider+model+key is "not configured yet" (mid-wizard).
  if (!row.provider || !isAiProvider(row.provider) || !row.model) return null;
  if (!row.api_key && row.provider !== 'ollama') return null;

  const settings = readAutoreplySettings(row.settings ?? {});
  const isAutoreply = row.kind === 'autoreply';

  return {
    agentId: row.id,
    provider: row.provider as AiProvider,
    model: row.model,
    apiKey: row.api_key ? decrypt(row.api_key) : '',
    baseUrl: row.base_url,
    systemPrompt: row.system_prompt,
    isActive: row.is_enabled,
    autoReplyEnabled: isAutoreply ? row.is_enabled : false,
    autoReplyMaxPerConversation: settings.replyCap,
    autoReplyLimitMode: settings.limitMode,
    autoReplyScheduleStart: isAutoreply ? settings.scheduleStart : null,
    autoReplyScheduleEnd: isAutoreply ? settings.scheduleEnd : null,
    autoReplyTimezone: isAutoreply ? settings.timezone : null,
    handoffAgentId: isAutoreply ? settings.handoffAgentId : null,
    embeddingsApiKey: decryptEmbeddingsKey(settings.embeddingsApiKey, accountId),
    keySource: 'account',
  };
}

/**
 * Load + decrypt the account's embeddings key, checking both agents
 * (autoreply first — it's the unattended spender, so it's the one most
 * deliberately configured). Signature mirrors the old
 * `loadEmbeddingsKey` so KB ingest routes migrate with an import swap.
 */
export async function loadAgentsEmbeddingsKey(
  db: SupabaseClient,
  accountId: string
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_agents')
    .select('kind, settings')
    .eq('account_id', accountId);
  if (error || !data) return { key: null, corrupt: false };

  const rows = [...data].sort((a) => (a.kind === 'autoreply' ? -1 : 1));
  let corrupt = false;
  for (const row of rows) {
    const enc = (row.settings as Record<string, unknown> | null)
      ?.embeddingsApiKey;
    if (typeof enc !== 'string' || !enc) continue;
    try {
      return { key: decrypt(enc), corrupt: false };
    } catch {
      console.error(
        `[ai agents] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`
      );
      corrupt = true;
    }
  }
  return { key: null, corrupt };
}

/**
 * Client-safe projection of an agent row: the API key NEVER leaves the
 * server after save — the client only learns whether one is stored.
 * The encrypted embeddings key is likewise reduced to a boolean.
 */
export function toClientAgent(row: AgentRow) {
  const settings = { ...(row.settings ?? {}) } as Record<string, unknown>;
  const hasEmbeddingsKey =
    typeof settings.embeddingsApiKey === 'string' &&
    settings.embeddingsApiKey.length > 0;
  delete settings.embeddingsApiKey;

  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    provider: row.provider,
    model: row.model,
    hasApiKey: Boolean(row.api_key),
    baseUrl: row.base_url,
    systemPrompt: row.system_prompt,
    isEnabled: row.is_enabled,
    settings,
    hasEmbeddingsKey,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ClientAgent = ReturnType<typeof toClientAgent>;

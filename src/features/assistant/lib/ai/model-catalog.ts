// ============================================================
// Live model catalogue — "which models can this key actually use?"
//
// Why this exists: the model field used to be free text, so setting up
// an agent meant knowing a provider's exact model id from memory. A
// typo is not caught until the verify-before-save round-trip fails,
// and a stale id (a model the vendor retired) fails the same way.
//
// Why it is NOT a hardcoded list: model ids churn weekly, and this is
// a bring-your-own-key product — the models a tenant may call depend
// on their own account tier and provider allow-list, which no table
// shipped in our bundle can know. So we ask the provider, with the
// tenant's own key, and annotate each id with whether it has a
// reasoning knob (`reasoning-controls.ts` is the authority on that).
//
// Deliberately NOT the AI SDK: this codebase talks to providers over
// their own HTTP APIs with per-tenant keys (see engines/), and the AI
// SDK exposes no cross-provider model catalogue — only the Vercel AI
// Gateway can enumerate models, and that is a different (gateway-key)
// billing path than a customer's own OpenAI key.
//
// Every provider here serves a list endpoint:
//   OpenAI / compat presets  GET {base}/models          Bearer
//   Anthropic                GET /v1/models             x-api-key
//   Gemini                   GET /v1beta/models         x-goog-api-key
//   Ollama                   GET {base}/models          no auth
//
// A key NEVER travels in a query string — URLs are the one part of a
// request that routinely lands in access logs, proxy logs and error
// reporters. Gemini accepts `x-goog-api-key`, which is what
// `engines/direct/gemini.ts` already uses for generation.
//
// Failures are never fatal to setup: callers surface the message and
// keep the free-text field usable, so a provider outage or a locked
// down key can never block an operator from saving a valid model id.
// ============================================================

import {
  OPENAI_COMPAT_BASE_URL,
  resolveOllamaBaseUrl,
} from './defaults';
import { reasoningSupport } from './reasoning-controls';
import { AiError, type AiProvider } from './types';

/** One selectable model, as offered to the operator. */
export interface CatalogModel {
  /** Exact id to store in `ai_agents.model`. */
  id: string;
  /** Vendor display name when the API gives one, else the id. */
  label: string;
  /** True when this model has a real reasoning knob — drives the
   *  "Thinking" badge and the visibility of the reasoning switch. */
  reasoning: boolean;
}

/** How long a listing stays warm. Model catalogues change on the order
 *  of weeks; an operator opening the form twice should not pay two
 *  provider round-trips. */
const CACHE_TTL_MS = 10 * 60 * 1000;
/**
 * How long a FAILURE stays warm. Short, because a revoked key gets
 * re-pasted within seconds — but non-zero, because the alternative is
 * amplification: this endpoint is refetched on provider switches and
 * refresh clicks, and a workspace whose key 401s would otherwise send
 * one upstream request per interaction, on every instance, forever.
 */
const NEGATIVE_TTL_MS = 60 * 1000;
/**
 * Hard bound on the map. The cache key includes the tenant's key
 * fingerprint, so on a long-lived instance serving many workspaces an
 * unbounded map is a slow leak. Oldest-first eviction (Map preserves
 * insertion order) is the right policy here: entries are cheap to
 * rebuild and a listing nobody has asked for in a while is exactly the
 * one to drop.
 */
const MAX_CACHE_ENTRIES = 500;
const LIST_TIMEOUT_MS = 12_000;
/** Gemini pages its listing. Five pages at 200/page is ~1000 models —
 *  far past any real catalogue, and a guard against a paging bug on the
 *  provider side turning into an infinite loop on ours. */
const MAX_LIST_PAGES = 5;

type CacheEntry =
  | { ok: true; models: CatalogModel[]; expiresAt: number }
  | { ok: false; error: AiError; expiresAt: number };

/**
 * Process-local cache, keyed by provider + base URL + a fingerprint of
 * the key. The key is part of the cache key because two tenants on the
 * same provider legitimately see different catalogues; it is reduced to
 * a short prefix/suffix + length so no usable secret material sits in a
 * map that might end up in a heap dump.
 */
const cache = new Map<string, CacheEntry>();

/**
 * Listings currently in flight, so N concurrent identical requests
 * (two admins on the same workspace, or one form remounting) make ONE
 * upstream call instead of N.
 */
const inFlight = new Map<string, Promise<CatalogModel[]>>();

function cacheKey(provider: string, baseUrl: string, apiKey: string): string {
  const fingerprint = apiKey
    ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}:${apiKey.length}`
    : 'nokey';
  return `${provider}|${baseUrl}|${fingerprint}`;
}

/** Store an outcome, evicting the oldest entries past the bound. */
function remember(key: string, entry: CacheEntry): void {
  // Delete first so a refreshed key moves to the END of the insertion
  // order — otherwise a hot entry would still be evicted as "oldest".
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Drop all cached listings. Test-only seam — nothing in the product
 * calls this, because a stale listing is corrected by the TTL and by
 * the Refresh button the picker renders.
 */
export function resetModelCatalogCache(): void {
  cache.clear();
  inFlight.clear();
}

/* ---------------------------------------------------------- */
/* Response shapes                                             */
/* ---------------------------------------------------------- */

interface OpenAiListResponse {
  data?: Array<{ id?: unknown; name?: unknown }>;
}

interface AnthropicListResponse {
  data?: Array<{ id?: unknown; display_name?: unknown }>;
}

interface GeminiListResponse {
  models?: Array<{
    name?: unknown;
    displayName?: unknown;
    supportedGenerationMethods?: unknown;
  }>;
  nextPageToken?: unknown;
}

/**
 * Model ids that speak a different protocol than chat/completions —
 * embeddings, speech, image, video, moderation, realtime and legacy
 * text-completion endpoints. OpenAI's `/models` returns the account's
 * entire inventory, so without this filter an operator is offered
 * `whisper-1`, `sora-2` or `gpt-4o-realtime-preview` as a reply model.
 *
 * NOTE the deliberate absence of a bare `instruct`: on OpenAI that
 * marks the legacy completions model, but on NVIDIA/Together half the
 * catalogue is `…-70b-instruct` chat models — including our own default
 * NVIDIA model. So the legacy completion families are matched by name
 * (`gpt-3.5-turbo-instruct`, `davinci`, `babbage`, `curie`, `ada`)
 * instead of by that substring.
 */
const NON_CHAT =
  // `embed` (not `embedding`) so NVIDIA's `…-nv-embedqa-…` is caught too,
  // plus the bge / gte / e5 embedding families, whose ids never say so.
  /(embed|whisper|tts|audio|dall-e|moderation|image|video|rerank|guard|transcribe|speech|clip|sora|realtime|computer-use|gpt-3\.5-turbo-instruct|davinci|babbage|curie-|text-ada|(?:^|\/)(?:bge|gte|e5)-)/i;

/* ---------------------------------------------------------- */
/* HTTP                                                        */
/* ---------------------------------------------------------- */

async function getJson(
  url: string,
  headers: Record<string, string>
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    throw new AiError(
      timedOut
        ? 'The provider took too long to list its models.'
        : 'Could not reach the provider to list its models.',
      { code: timedOut ? 'timeout' : 'network_error', status: 502 }
    );
  }

  if (!res.ok) {
    // Same taxonomy the generation adapters use, so the UI can branch
    // on `code` identically whether a listing or a reply failed.
    if (res.status === 401 || res.status === 403) {
      throw new AiError(
        'The provider rejected this API key when listing models.',
        { code: 'invalid_key', status: 400 }
      );
    }
    if (res.status === 429) {
      throw new AiError('The provider rate-limited the model listing.', {
        code: 'rate_limited',
        status: 429,
      });
    }
    if (res.status === 404) {
      throw new AiError(
        'This endpoint does not offer a model listing — enter the model id directly.',
        { code: 'not_supported', status: 400 }
      );
    }
    throw new AiError('The provider could not list its models.', {
      code: 'provider_error',
      status: 502,
    });
  }

  return res.json().catch(() => {
    throw new AiError('The provider returned an unreadable model list.', {
      code: 'bad_response',
      status: 502,
    });
  });
}

/* ---------------------------------------------------------- */
/* Entry point                                                 */
/* ---------------------------------------------------------- */

export interface ListModelsInput {
  provider: AiProvider;
  /** Plaintext provider key. Empty is only valid for Ollama. */
  apiKey: string;
  /** Required for `custom`; optional override for `ollama`. */
  baseUrl?: string | null;
}

/**
 * Ask the provider which models this key may call.
 *
 * Throws `AiError` — callers turn it into a non-blocking message next
 * to a still-editable model field, never a hard failure.
 */
export async function listProviderModels(
  input: ListModelsInput
): Promise<CatalogModel[]> {
  const { provider } = input;
  const apiKey = input.apiKey?.trim() ?? '';
  const baseUrl = resolveListBaseUrl(provider, input.baseUrl);

  if (!apiKey && provider !== 'ollama') {
    throw new AiError('Save an API key first to load this provider’s models.', {
      code: 'missing_key',
      status: 400,
    });
  }

  const key = cacheKey(provider, baseUrl, apiKey);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    if (hit.ok) return hit.models;
    // Replay the cached failure verbatim: the caller's error handling
    // must not be able to tell a fresh 401 from a remembered one.
    throw hit.error;
  }
  if (hit) cache.delete(key);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const started = (async () => {
    try {
      const models = annotate(
        provider,
        await fetchIds(provider, baseUrl, apiKey)
      );
      remember(key, {
        ok: true,
        models,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return models;
    } catch (e) {
      const error =
        e instanceof AiError
          ? e
          : new AiError('The provider could not list its models.', {
              code: 'provider_error',
              status: 502,
            });
      remember(key, {
        ok: false,
        error,
        expiresAt: Date.now() + NEGATIVE_TTL_MS,
      });
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, started);
  return started;
}

/** Where this provider's listing lives. */
function resolveListBaseUrl(
  provider: AiProvider,
  configured?: string | null
): string {
  if (provider === 'ollama') return resolveOllamaBaseUrl(configured);
  if (provider === 'custom') {
    const trimmed = configured?.trim().replace(/\/+$/, '') ?? '';
    if (!trimmed) {
      throw new AiError('Enter the endpoint base URL first.', {
        code: 'missing_base_url',
        status: 400,
      });
    }
    return trimmed;
  }
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  if (provider === 'gemini') {
    return 'https://generativelanguage.googleapis.com/v1beta';
  }
  const preset = OPENAI_COMPAT_BASE_URL[provider];
  if (!preset) {
    throw new AiError('This provider does not publish a model list.', {
      code: 'not_supported',
      status: 400,
    });
  }
  return preset;
}

/** Provider-specific listing + normalization to `{ id, label }`. */
async function fetchIds(
  provider: AiProvider,
  baseUrl: string,
  apiKey: string
): Promise<Array<{ id: string; label: string }>> {
  if (provider === 'anthropic') {
    const body = (await getJson(`${baseUrl}/models?limit=1000`, {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    })) as AnthropicListResponse;
    return (body.data ?? []).flatMap((m) => {
      const id = typeof m.id === 'string' ? m.id : '';
      if (!id) return [];
      const label = typeof m.display_name === 'string' ? m.display_name : id;
      return [{ id, label }];
    });
  }

  if (provider === 'gemini') {
    const out: Array<{ id: string; label: string }> = [];
    let pageToken: string | null = null;
    // Gemini pages its listing, and a first page of 200 is NOT the whole
    // catalogue on a key with preview models — the missing ones were
    // simply unselectable before.
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const url = new URL(`${baseUrl}/models`);
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = (await getJson(url.toString(), {
        // Header auth, never `?key=` — see the file header.
        'x-goog-api-key': apiKey,
      })) as GeminiListResponse;

      for (const m of body.models ?? []) {
        const raw = typeof m.name === 'string' ? m.name : '';
        if (!raw) continue;
        // Only models that can actually answer a chat turn.
        const methods = Array.isArray(m.supportedGenerationMethods)
          ? m.supportedGenerationMethods
          : [];
        if (methods.length > 0 && !methods.includes('generateContent')) {
          continue;
        }
        // The API returns 'models/gemini-2.5-flash'; we store the bare id.
        const id = raw.replace(/^models\//, '');
        const label = typeof m.displayName === 'string' ? m.displayName : id;
        out.push({ id, label });
      }

      pageToken =
        typeof body.nextPageToken === 'string' && body.nextPageToken
          ? body.nextPageToken
          : null;
      if (!pageToken) break;
    }
    return out;
  }

  // OpenAI and every OpenAI-compatible preset (plus Ollama's /v1 shim,
  // which ignores the Authorization header).
  const body = await getJson(`${baseUrl}/models`, {
    Authorization: `Bearer ${apiKey || 'ollama'}`,
  });
  // Most compat providers answer `{ data: [...] }`, but some (Together
  // among them) return a bare JSON array. Reading only `.data` turned
  // that into a silent "0 models available" — indistinguishable from a
  // locked-down key.
  const entries: OpenAiListResponse['data'] = Array.isArray(body)
    ? (body as NonNullable<OpenAiListResponse['data']>)
    : ((body as OpenAiListResponse)?.data ?? []);
  return (entries ?? []).flatMap((m) => {
    const id = typeof m?.id === 'string' ? m.id : '';
    if (!id) return [];
    const label = typeof m.name === 'string' && m.name ? m.name : id;
    return [{ id, label }];
  });
}

/**
 * Drop non-chat endpoints, dedupe, annotate reasoning capability, and
 * sort reasoning-capable models first (that is the interesting axis
 * when someone is here to turn thinking on) then alphabetically.
 */
function annotate(
  provider: AiProvider,
  raw: Array<{ id: string; label: string }>
): CatalogModel[] {
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const { id, label } of raw) {
    if (seen.has(id) || NON_CHAT.test(id)) continue;
    seen.add(id);
    models.push({
      id,
      label,
      reasoning: reasoningSupport(provider, id).supported,
    });
  }
  return models.sort((a, b) => {
    if (a.reasoning !== b.reasoning) return a.reasoning ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

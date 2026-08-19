import { AiError, type ChatMessage } from '../../types';
import { MAX_OUTPUT_TOKENS } from '../../defaults';
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
  type ProviderResult,
} from './shared';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicResponse {
  content?: { type?: string; text?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages);
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift();
  }
  if (merged.length === 0) {
    return [
      { role: 'user', content: '(The customer has not sent a message yet.)' },
    ];
  }
  return merged;
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in the shared dispatch layer).
 */
export async function generateAnthropic(
  args: ProviderArgs
): Promise<ProviderResult> {
  const {
    apiKey,
    model,
    systemPrompt,
    messages,
    timeoutMs,
    systemBlocks,
    reasoning,
    tuning,
  } = args;

  // Cache-aligned path: send the system prompt as an array of blocks,
  // each ending in a `cache_control` breakpoint — block 0 (platform
  // scaffold) is shared by EVERY account, block 1 (business context)
  // by every conversation of the account. Anthropic then bills cached
  // reads at 10% of input price. Legacy path keeps the plain string.
  const system =
    systemBlocks && systemBlocks.length > 0
      ? systemBlocks.map((text) => ({
          type: 'text' as const,
          text,
          cache_control: { type: 'ephemeral' as const },
        }))
      : systemPrompt;

  const reasoningParams = reasoning?.params ?? {};
  const thinkingOn =
    (reasoningParams.thinking as { type?: string } | undefined)?.type ===
    'enabled';

  // Anthropic requires max_tokens > budget_tokens whenever extended
  // thinking is enabled, so the reasoning plan's larger floor is not
  // optional here — it's a hard API constraint.
  const maxOut =
    tuning?.maxOutputTokens ??
    Math.max(MAX_OUTPUT_TOKENS, reasoning?.minOutputTokens ?? 0);

  const samplingParams: Record<string, unknown> = {};
  // Extended thinking forbids temperature/top_p — sending them 400s.
  if (!thinkingOn) {
    if (tuning?.temperature !== undefined) {
      samplingParams.temperature = tuning.temperature;
    }
    if (tuning?.topP !== undefined) samplingParams.top_p = tuning.topP;
  }
  // Anthropic has no presence/frequency penalty — those are silently
  // dropped rather than sent and rejected.

  const send = (extra: Record<string, unknown>) =>
    fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system,
        max_tokens: maxOut,
        messages: normalizeForAnthropic(messages),
        ...extra,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  let res: Response;
  try {
    res = await send({ ...reasoningParams, ...samplingParams });
  } catch (err) {
    throw toNetworkError(err);
  }

  // Older API revisions and non-thinking models reject the `thinking`
  // field outright. Retry once without it so a Claude 3.5 account keeps
  // working after this change.
  if (res.status === 400 && Object.keys(reasoningParams).length > 0) {
    try {
      res = await send(samplingParams);
    } catch (err) {
      throw toNetworkError(err);
    }
  }

  if (!res.ok) {
    throw await providerHttpError('Anthropic', res);
  }

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null;
  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!text) {
    throw new AiError('Anthropic returned an empty response.', {
      code: 'empty_response',
    });
  }
  // Anthropic reports input/output but no total — normalizeUsage sums.
  // Note: input_tokens EXCLUDES cache reads/writes, so add them back
  // for a comparable "full prompt size" number across providers.
  const cacheRead = data?.usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = data?.usage?.cache_creation_input_tokens ?? 0;
  const usage = normalizeUsage({
    prompt: (data?.usage?.input_tokens ?? 0) + cacheRead + cacheWrite,
    completion: data?.usage?.output_tokens,
    cached: data?.usage?.cache_read_input_tokens,
    cacheWrite: data?.usage?.cache_creation_input_tokens,
  });
  return { text, usage };
}

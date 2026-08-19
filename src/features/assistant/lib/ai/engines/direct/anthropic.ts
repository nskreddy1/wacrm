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
  const { apiKey, model, systemPrompt, messages, timeoutMs, systemBlocks } =
    args;

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

  const body = (thinking: object | null) =>
    JSON.stringify({
      model,
      system,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: normalizeForAnthropic(messages),
      ...(thinking ? { thinking } : {}),
    });

  const call = (payload: string) =>
    fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });

  let res: Response;
  try {
    /*
     * Thinking OFF, explicitly.
     *
     * Extended thinking is opt-in on Claude 3.7/4.x, so omitting the
     * field would already be correct — but Claude 4.6 added adaptive
     * thinking that engages on its own, and `max_tokens` covers the
     * scratchpad AND the reply, so an adaptive turn can burn the budget
     * and return no message. Saying `disabled` out loud costs nothing
     * and removes the ambiguity.
     */
    res = await call(body({ type: 'disabled' }));

    // Older API revisions (and any model that predates the field)
    // reject `thinking` with a 400 — fall back to the plain request,
    // where thinking is off by default anyway.
    if (res.status === 400) {
      res = await call(body(null));
    }
  } catch (err) {
    throw toNetworkError(err);
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

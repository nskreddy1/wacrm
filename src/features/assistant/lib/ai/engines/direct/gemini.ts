import { AiError } from '../../types';
import { MAX_OUTPUT_TOKENS } from '../../defaults';
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
  type ProviderResult,
} from './shared';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        /**
         * Gemini marks scratchpad parts with `thought: true` and puts
         * them in the SAME `parts` array as the answer. Joining the
         * array blindly is what shipped "Here's a thinking process:
         * 1. Analyze User Input…" to a customer on WhatsApp.
         */
        thought?: boolean;
      }[];
    };
    /** 'STOP' when the model finished; 'MAX_TOKENS' when the cap hit. */
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    /** Tokens served from Gemini's implicit prefix cache (75-90% off). */
    cachedContentTokenCount?: number;
  };
}

/**
 * Call Google's Gemini generateContent endpoint with the caller's own
 * key. Mirrors the OpenAI/Anthropic adapters: raw assistant text +
 * normalized token usage (handoff parsing happens in the shared
 * dispatch layer).
 *
 * Gemini's chat shape differs from OpenAI's: the system prompt rides in
 * `systemInstruction`, turns live in `contents`, and the assistant role
 * is called `model`. The key is passed via header (not query string) so
 * it can't leak into logs.
 */
export async function generateGemini(
  args: ProviderArgs
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args;

  const body = (thinkingConfig: object | null) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: mergeConsecutive(messages).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    });

  const call = (payload: string) =>
    fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
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
     * The default model here is `gemini-flash-latest`, which thinks by
     * default — and `maxOutputTokens` is a budget for thinking AND the
     * answer together. A 1024-token cap plus a long CRM/knowledge
     * prompt meant the model regularly spent the entire budget
     * reasoning and returned a truncated scratchpad with no reply. A
     * one-line WhatsApp answer needs no reasoning, so we turn it off
     * and get the whole budget for the message.
     */
    res = await call(
      body({ thinkingBudget: 0, includeThoughts: false })
    );

    /*
     * Not every model lets thinking be disabled — Gemini 3 replaced the
     * numeric budget with `thinkingLevel` and has no "off", and the Pro
     * tiers enforce a minimum budget; both reject `thinkingBudget: 0`
     * with a 400. A BYO-key tenant can type any model id into settings,
     * so step down instead of failing: lowest thinking level, then the
     * plain request. The `thought` filter below protects the customer in
     * every case.
     */
    if (res.status === 400) {
      res = await call(body({ thinkingLevel: 'low', includeThoughts: false }));
    }
    if (res.status === 400) {
      res = await call(body(null));
    }
  } catch (err) {
    throw toNetworkError(err);
  }

  if (!res.ok) {
    throw await providerHttpError('Gemini', res);
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null;
  const candidate = data?.candidates?.[0];
  const truncated = candidate?.finishReason === 'MAX_TOKENS';
  // Answer parts only — `thought: true` parts are the scratchpad.
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => p.thought !== true)
    .map((p) => p.text ?? '')
    .join('');
  if (!text.trim()) {
    throw new AiError(
      truncated
        ? 'Gemini spent its entire output budget on internal reasoning and returned no reply. Use a model whose thinking can be disabled, or raise the output token cap.'
        : 'Gemini returned an empty response.',
      { code: truncated ? 'reasoning_only_response' : 'empty_response' }
    );
  }
  const usage = normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
    cached: data?.usageMetadata?.cachedContentTokenCount,
  });
  return { text, usage, truncated };
}

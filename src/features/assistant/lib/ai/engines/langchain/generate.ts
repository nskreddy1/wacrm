import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { AiConfig, AiUsage, ChatMessage } from '../../types';
import { aiRequestTimeoutMs } from '../../defaults';
import { providerLabel, toAiError } from '../../errors';
import { normalizeLcUsage, resolveChatModel } from './model';

// ============================================================
// LangChain engine — chat generation. Selected when the platform
// `ai_engine` flag is `langchain`. Returns the raw `{ text, usage }`;
// sentinel/meta parsing and the empty-response check stay in the
// shared dispatch layer (src/lib/ai/generate.ts).
// ============================================================

export interface LangChainGenerateArgs {
  config: AiConfig;
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string;
  /** Conversation turns, already normalized for the target provider
   *  (merged consecutive roles; Anthropic-safe leading turn). */
  turns: ChatMessage[];
}

/** Map our provider-agnostic turns to LangChain message objects. */
function toLcMessages(
  systemPrompt: string,
  turns: ChatMessage[]
): BaseMessage[] {
  return [
    new SystemMessage(systemPrompt),
    ...turns.map((m) =>
      m.role === 'assistant'
        ? new AIMessage(m.content)
        : new HumanMessage(m.content)
    ),
  ];
}

/** Extract the plain assistant text from a LangChain message content
 *  value (string, or an array of typed content parts). */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (
          part &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * Generate the next reply via LangChain. Resolves the chat model for
 * the account's config and invokes it with the transcript. Throws
 * `AiError` on any provider/network failure.
 */
export async function generateReplyLangChain(
  args: LangChainGenerateArgs
): Promise<{ text: string; usage: AiUsage | null }> {
  const { config, systemPrompt, turns } = args;
  const label = providerLabel(config.provider);

  // Config problems (missing base URL, unknown provider) throw typed
  // AiErrors synchronously — let them propagate untouched.
  const model = resolveChatModel(config);
  const lcMessages = toLcMessages(systemPrompt, turns);

  let response;
  try {
    response = await model.invoke(lcMessages, {
      // Same env-driven per-call timeout as the direct fetch adapters.
      signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    });
  } catch (err) {
    throw toAiError(err, label);
  }

  return {
    text: contentToText(response.content).trim(),
    usage: normalizeLcUsage(response.usage_metadata),
  };
}

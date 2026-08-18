/**
 * Shared failure vocabulary for the Mira chat stream.
 *
 * `toUIMessageStream` masks stream errors as a bare "An error occurred."
 * and logs nothing, deliberately, so no provider detail reaches the
 * browser. The side effect was that a missing API key, an exhausted
 * quota and an over-long thread all rendered identically and left no
 * server trace — the assistant "just didn't work" with nothing to go on.
 *
 * The fix is a small closed set of codes. The route classifies the raw
 * error and puts only the code on the wire; the widget maps that code to
 * copy. Because both sides import this module they cannot drift, and the
 * provider's raw text — which can carry key fragments, account ids and
 * internal URLs — never leaves the server.
 *
 * Client-safe on purpose: no `server-only`, no Node imports.
 */

/** Prefix marking a stream error as one we classified ourselves. */
const CODE_PREFIX = 'mira_error:';

export const ASSISTANT_ERROR_CODES = [
  'invalid_key',
  'quota_exhausted',
  'rate_limited',
  'context_too_long',
  'conversation_out_of_sync',
  'model_unavailable',
  'provider_timeout',
  'unknown',
] as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

/**
 * What the user reads. `cause` says what went wrong, `recovery` says who
 * can fix it — the distinction matters here because several of these are
 * platform-admin problems a normal seat holder cannot act on, and telling
 * them to "try again" would just waste their time.
 */
export const ASSISTANT_ERROR_NOTICES: Record<
  AssistantErrorCode,
  { cause: string; recovery: string }
> = {
  invalid_key: {
    cause: 'The AI provider rejected the configured API key.',
    recovery: 'A platform admin needs to update it in the Admin console.',
  },
  quota_exhausted: {
    cause: "The AI provider's quota or credit is exhausted.",
    recovery: 'A platform admin needs to review the provider account.',
  },
  rate_limited: {
    cause: 'Too many requests in a short time.',
    recovery: 'Wait about a minute, then send again.',
  },
  context_too_long: {
    cause: 'This conversation is too long for the model.',
    recovery: 'Start a new chat to carry on.',
  },
  conversation_out_of_sync: {
    cause: 'An earlier step in this chat was interrupted.',
    recovery: 'Start a new chat to carry on.',
  },
  model_unavailable: {
    cause: 'The configured AI model is unavailable.',
    recovery: 'A platform admin needs to choose another model in Admin.',
  },
  provider_timeout: {
    cause: 'The AI provider did not respond in time.',
    recovery: 'Resend the message to try again.',
  },
  unknown: {
    cause: "Mira couldn't finish that reply.",
    recovery: 'Resend the message to try again.',
  },
};

/**
 * Best-effort classification of a provider or tool failure.
 *
 * Matches on message text because the failure arrives from many
 * providers through several layers (provider SDK, AI SDK wrapper, fetch)
 * and no single structured field survives all of them. Order matters:
 * quota and rate limiting both mention limits, and an exhausted account
 * needs an admin while a 429 just needs a pause, so the costlier
 * misdiagnosis is checked first.
 */
export function classifyAssistantError(error: unknown): AssistantErrorCode {
  const status =
    typeof error === 'object' && error !== null
      ? ((error as { status?: unknown; statusCode?: unknown }).status ??
        (error as { statusCode?: unknown }).statusCode)
      : undefined;
  const text = (error instanceof Error ? error.message : String(error ?? ''))
    .toLowerCase()
    .trim();

  if (status === 401 || status === 403) return 'invalid_key';
  if (/api key|unauthorized|invalid.*credential|authentication/.test(text))
    return 'invalid_key';
  if (/quota|billing|insufficient_quota|insufficient|payment|credit/.test(text))
    return 'quota_exhausted';
  if (status === 429) return 'rate_limited';
  if (/rate.?limit|too many requests|overloaded|capacity/.test(text))
    return 'rate_limited';
  if (
    /context length|context_length|too many tokens|maximum context|prompt is too long/.test(
      text
    )
  )
    return 'context_too_long';
  // A tool call the provider can't pair with a result. `transcript.ts`
  // repairs the common causes before sending, so reaching this means an
  // unrepaired shape got through — the thread cannot recover on a retry,
  // and telling the user to "resend" would loop them forever. Checked
  // before the generic 400/404 rules, which would otherwise swallow it.
  if (
    /tool_call_id|tool_calls|tool_use|tool_result|tool messages|invalid.*tool.*(call|approval)/.test(
      text
    )
  )
    return 'conversation_out_of_sync';
  if (/model.*(not found|unavailable|does not exist|deprecated)/.test(text))
    return 'model_unavailable';
  if (status === 404) return 'model_unavailable';
  if (
    /timeout|timed out|econnreset|enotfound|network|fetch failed|load failed/.test(
      text
    )
  )
    return 'provider_timeout';
  return 'unknown';
}

/** Encodes a code for the stream. Server side. */
export function encodeAssistantErrorCode(code: AssistantErrorCode): string {
  return `${CODE_PREFIX}${code}`;
}

/**
 * Resolves whatever reached the browser back into copy.
 *
 * Handles three shapes: a code we put on the wire, an error that never
 * reached the stream (a 429 or a dropped connection, classified locally),
 * and anything unrecognised, which falls back to the honest generic
 * notice rather than showing the user a raw code.
 */
export function resolveAssistantErrorNotice(error: unknown): {
  cause: string;
  recovery: string;
} {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const marker = message.indexOf(CODE_PREFIX);
  if (marker !== -1) {
    const code = message
      .slice(marker + CODE_PREFIX.length)
      .trim()
      .split(/[^a-z_]/)[0] as AssistantErrorCode;
    if (ASSISTANT_ERROR_CODES.includes(code))
      return ASSISTANT_ERROR_NOTICES[code];
  }
  return ASSISTANT_ERROR_NOTICES[classifyAssistantError(error)];
}

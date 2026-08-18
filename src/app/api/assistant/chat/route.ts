import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import {
  loadAssistantConfig,
  resolveAssistantModel,
  resolveAssistantSystemPrompt,
} from '@/features/assistant/lib/config';
import {
  buildAssistantTools,
  WRITE_TOOL_NAMES,
} from '@/features/assistant/lib/tools';
import {
  classifyAssistantError,
  encodeAssistantErrorCode,
} from '@/features/assistant/lib/chat-errors';
import { saveAssistantTurn } from '@/features/assistant/lib/sessions';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * How many messages the model sees. Every turn re-sends the whole
 * transcript, so this is the single biggest lever on time-to-first-token
 * once threads are persisted and reopened.
 */
const MODEL_HISTORY_MESSAGES = 12;

/**
 * Cap on a single stored tool result before it is summarised.
 *
 * Read tools return real workspace data — a contact list or pipeline
 * dump is easily tens of kilobytes of JSON. Replaying those verbatim on
 * every subsequent turn is what made long threads crawl: the prompt
 * grew without bound while adding nothing, because the model had
 * already used the data in the answer the user can see.
 */
const MAX_TOOL_OUTPUT_CHARS = 1_200;

/**
 * Shrink the transcript before it goes to the model.
 *
 * Keeps the last two messages byte-exact — that is the turn actually
 * being reasoned about, including any tool output the next step depends
 * on — and truncates oversized tool results in everything older. The
 * text of past turns is untouched, so the conversation still reads
 * continuously; only the bulky machine payloads shrink.
 */
function compactForModel(messages: UIMessage[]): UIMessage[] {
  const recent = messages.slice(-MODEL_HISTORY_MESSAGES);
  const keepIntactFrom = recent.length - 2;

  return recent.map((message, index) => {
    if (index >= keepIntactFrom) return message;

    const parts = message.parts.map((part) => {
      if (!('output' in part) || part.output === undefined) return part;
      const serialized =
        typeof part.output === 'string'
          ? part.output
          : JSON.stringify(part.output);
      if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) return part;
      return {
        ...part,
        output: `${serialized.slice(0, MAX_TOOL_OUTPUT_CHARS)}… [older result truncated — call the tool again for current data]`,
      };
    });

    return { ...message, parts: parts as UIMessage['parts'] };
  });
}

export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount();

    // This endpoint spends the PLATFORM key, so cap it twice: per user
    // (stops one seat holding down send / running a script) and per
    // account (stops N seats in one workspace collectively stampeding
    // the shared key while each stays under the per-user cap).
    //
    // All three preflight calls go out together. They are independent —
    // two Redis counters and a config read — but used to run in series,
    // so their latencies stacked in front of every single turn before
    // the model was even contacted. Concurrently the cost is the slowest
    // one instead of the sum.
    //
    // Both counters are still evaluated even if the first would reject:
    // INCR has already happened server-side regardless of the order we
    // read the results in, so short-circuiting would not save the write,
    // only hide it. Precedence below is unchanged (user, then account).
    const [userLimit, accountLimit, config] = await Promise.all([
      checkRateLimit(`assistant-chat:${ctx.userId}`, RATE_LIMITS.assistantChat),
      checkRateLimit(
        `assistant-chat-acct:${ctx.accountId}`,
        RATE_LIMITS.assistantChatAccount
      ),
      loadAssistantConfig(),
    ]);

    if (!userLimit.success) return rateLimitResponse(userLimit);
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    if (!config) {
      return NextResponse.json(
        {
          error: 'assistant_not_configured',
          message:
            'The platform assistant has not been configured yet. A platform admin must add an API key in the Admin console.',
        },
        { status: 503 }
      );
    }

    const body = (await req.json()) as {
      messages?: UIMessage[];
      sessionId?: unknown;
    };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 });
    }

    // Which thread to persist this turn into. The client creates the
    // session up front, so this is present on every real request; when
    // it's absent the chat still works and simply isn't recorded,
    // rather than failing the user's message.
    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null;

    // Record the inbound half of the turn now, without waiting on it.
    //
    // `onEnd` below is the authoritative write, but it only runs if the
    // stream reaches its end — close the panel or lose the connection
    // mid-answer and it never fires, leaving a session row in history
    // whose transcript is empty. Reopening that thread then looked like
    // the click did nothing. This write is what guarantees a thread in
    // the list always has content; it is deliberately not awaited so it
    // adds nothing to time-to-first-token.
    if (sessionId) {
      void saveAssistantTurn(ctx, sessionId, messages).catch((err) => {
        console.error('[assistant] failed to pre-persist turn', err);
      });
    }

    const result = streamText({
      model: resolveAssistantModel(config),
      system: resolveAssistantSystemPrompt(config),
      messages: await convertToModelMessages(compactForModel(messages)),
      tools: buildAssistantTools(ctx),
      // Read tools run freely; every write tool pauses the loop and
      // asks the user for permission in the chat (user requirement:
      // read access always, write only after the user grants it).
      toolApproval: Object.fromEntries(
        WRITE_TOOL_NAMES.map((name) => [name, 'user-approval' as const])
      ),
      // Admin-tunable generation knobs (Admin → Platform → Mira).
      ...(config.temperature !== null
        ? { temperature: config.temperature }
        : {}),
      maxOutputTokens: config.maxOutputTokens,
      // Allow tool calls + a follow-up answer (default is one step).
      stopWhen: stepCountIs(5),
      // Server-side record of anything that breaks mid-stream, including
      // a tool that throws. Without this the failure is swallowed by the
      // stream and the only signal is a generic message in the browser.
      onError: ({ error }) => {
        console.error('[assistant] stream error', {
          accountId: ctx.accountId,
          userId: ctx.userId,
          sessionId,
          model: config.model,
          error,
        });
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        // Passing the inbound messages puts the SDK in persistence
        // mode: it assigns the response message a stable id and hands
        // `onEnd` the full reconciled transcript. Note this is the
        // untrimmed list — `compactForModel` shapes what the model sees, and
        // persisting the trimmed view would silently drop the older
        // half of a long thread from history.
        originalMessages: messages,
        // Replaces the SDK's default masked "An error occurred." with a
        // classified code. Only the code crosses the wire — the widget
        // turns it into copy — so the user learns whether to retry or
        // call an admin without any provider text being exposed.
        onError: (error) =>
          encodeAssistantErrorCode(classifyAssistantError(error)),
        onEnd: async ({ messages: finalMessages, isAborted }) => {
          // An aborted stream leaves a half-formed assistant message.
          // Storing it would mean reopening the thread replays a
          // truncated answer as if it were complete.
          if (!sessionId || isAborted) return;
          try {
            await saveAssistantTurn(ctx, sessionId, finalMessages);
          } catch (err) {
            // History is a convenience; the user already has the
            // answer on screen. A persistence failure must not surface
            // as a broken chat, so log and move on.
            console.error('[assistant] failed to persist turn', err);
          }
        },
      }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

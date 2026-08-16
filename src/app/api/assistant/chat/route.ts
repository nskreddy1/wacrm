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
import { saveAssistantTurn } from '@/features/assistant/lib/sessions';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount();

    // This endpoint spends the PLATFORM key, so cap it twice: per user
    // (stops one seat holding down send / running a script) and per
    // account (stops N seats in one workspace collectively stampeding
    // the shared key while each stays under the per-user cap).
    const userLimit = await checkRateLimit(
      `assistant-chat:${ctx.userId}`,
      RATE_LIMITS.assistantChat
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    const accountLimit = await checkRateLimit(
      `assistant-chat-acct:${ctx.accountId}`,
      RATE_LIMITS.assistantChatAccount
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const config = await loadAssistantConfig();
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

    // Hard cap on transcript size to bound cost on the platform key.
    const recent = messages.slice(-20);

    const result = streamText({
      model: resolveAssistantModel(config),
      system: resolveAssistantSystemPrompt(config),
      messages: await convertToModelMessages(recent),
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
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        // Passing the inbound messages puts the SDK in persistence
        // mode: it assigns the response message a stable id and hands
        // `onEnd` the full reconciled transcript. Note this is the
        // untrimmed list — `recent` is only what the model sees, and
        // persisting the trimmed view would silently drop the older
        // half of a long thread from history.
        originalMessages: messages,
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

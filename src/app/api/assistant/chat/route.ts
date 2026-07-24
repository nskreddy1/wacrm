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

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount();

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

    const body = (await req.json()) as { messages?: UIMessage[] };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 });
    }

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
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

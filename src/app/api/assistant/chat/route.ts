import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai'
import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  loadAssistantConfig,
  resolveAssistantModel,
} from '@/lib/assistant/config'
import { buildAssistantTools, WRITE_TOOL_NAMES } from '@/lib/assistant/tools'

export const runtime = 'nodejs'
export const maxDuration = 60

const SYSTEM_PROMPT = `You are the in-app helper agent for a WhatsApp CRM platform. You help signed-in workspace users understand and use the product: WhatsApp inbox, contacts, deals/pipelines, appointments, broadcasts, automations, AI agents, and settings.

Access rules you MUST follow:
- You have READ access to the user's workspace data through your read tools. Use them freely to answer questions, and always base answers on tool results rather than guessing.
- WRITE actions (creating support tickets, adding contact notes) require the user's explicit approval in the chat. When you call a write tool, briefly tell the user what you are about to do and why, so their approve/deny decision is informed.
- Never invent data. If a tool returns an error or nothing, say so.
- If the user needs human help, wants to report a bug, or you cannot answer, offer to create a support ticket for the founder support team.
- Keep replies short and practical. Use plain text, no markdown tables.
- Politely decline anything unrelated to this product or the user's workspace.`

export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount()

    const config = await loadAssistantConfig()
    if (!config) {
      return NextResponse.json(
        {
          error: 'assistant_not_configured',
          message:
            'The platform assistant has not been configured yet. A platform admin must add an API key in the Admin console.',
        },
        { status: 503 },
      )
    }

    const body = (await req.json()) as { messages?: UIMessage[] }
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 })
    }

    // Hard cap on transcript size to bound cost on the platform key.
    const recent = messages.slice(-20)

    const result = streamText({
      model: resolveAssistantModel(config),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(recent),
      tools: buildAssistantTools(ctx),
      // Read tools run freely; every write tool pauses the loop and
      // asks the user for permission in the chat (user requirement:
      // read access always, write only after the user grants it).
      toolApproval: Object.fromEntries(
        WRITE_TOOL_NAMES.map((name) => [name, 'user-approval' as const]),
      ),
      maxOutputTokens: 800,
      // Allow tool calls + a follow-up answer (default is one step).
      stopWhen: stepCountIs(5),
    })

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

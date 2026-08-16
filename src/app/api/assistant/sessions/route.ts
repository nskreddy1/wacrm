import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import {
  createAssistantSession,
  listAssistantSessions,
} from '@/features/assistant/lib/sessions';

export const runtime = 'nodejs';

/**
 * GET — the caller's own chat history, newest first.
 *
 * No pagination params: the list is capped in the data layer and the
 * 90-day retention purge keeps it bounded from the other end.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const sessions = await listAssistantSessions(ctx);
    return NextResponse.json({ sessions });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST — start a new thread.
 *
 * Optionally seeds the title from the first message the user is about
 * to send, so the history list never shows an untitled row.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getCurrentAccount();

    // A malformed/absent body is fine — the title is optional.
    let firstMessage: string | undefined;
    try {
      const body = (await req.json()) as { firstMessage?: unknown };
      if (typeof body.firstMessage === 'string') {
        firstMessage = body.firstMessage;
      }
    } catch {
      firstMessage = undefined;
    }

    const session = await createAssistantSession(ctx, firstMessage);
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

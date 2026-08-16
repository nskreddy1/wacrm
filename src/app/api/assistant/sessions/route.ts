import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { listAssistantSessions } from '@/features/assistant/lib/sessions';

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

// There is deliberately no POST here.
//
// Threads used to be created by an explicit POST that the widget had to
// await before it could send the user's first message — a full round
// trip of dead air before anything appeared on screen. The client now
// mints the thread's uuid locally and the chat route creates the row on
// first save, so a "create session" endpoint would only be a second,
// untested way to make the same row (and a way to mint empty threads).

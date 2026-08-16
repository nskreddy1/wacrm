import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import {
  deleteAssistantSession,
  loadAssistantSession,
} from '@/features/assistant/lib/sessions';

export const runtime = 'nodejs';

/**
 * GET — one thread's full transcript, for resuming it.
 *
 * A session belonging to someone else returns 404, not 403: RLS gives
 * us "no row" for both cases, and collapsing them is the right answer
 * anyway — it reveals nothing about whether the id exists.
 *
 * Next 16: `params` is a promise and must be awaited.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const session = await loadAssistantSession(ctx, id);
    if (!session) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE — the user's own "forget this conversation" control.
 *
 * Idempotent: deleting an already-gone (or never-owned) thread is a
 * successful no-op, so a double-click can't produce an error toast.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    await deleteAssistantSession(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

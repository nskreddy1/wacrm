import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import {
  dispatchEventToFlows,
  type FlowAppEvent,
} from '@/features/flows/lib/engine';

/**
 * App-event ingestion for Workflows.
 *
 * UI surfaces (tagging a contact in the inbox sidebar, assigning a
 * conversation) and external integrations POST here to start any
 * active event-triggered flows. The engine applies per-flow config
 * filters (tag_ids / agent_ids) and the one-active-run-per-contact
 * guarantee, so callers can fire-and-forget.
 *
 * Auth: `agent`+ — starting a flow can send outbound messages, so
 * viewers must not be able to trigger it.
 */
export async function POST(request: Request) {
  let accountId: string;
  try {
    const ctx = await requireRole('agent');
    accountId = ctx.accountId;
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { event_type, contact_id, conversation_id, tag_id, agent_id } =
    body as Record<string, unknown>;

  if (typeof contact_id !== 'string' || !contact_id) {
    return NextResponse.json(
      { error: 'contact_id is required' },
      { status: 400 }
    );
  }
  if (typeof conversation_id !== 'string' || !conversation_id) {
    return NextResponse.json(
      { error: 'conversation_id is required' },
      { status: 400 }
    );
  }

  let event: FlowAppEvent;
  if (event_type === 'tag_added' && typeof tag_id === 'string' && tag_id) {
    event = { type: 'tag_added', tag_id };
  } else if (
    event_type === 'conversation_assigned' &&
    typeof agent_id === 'string' &&
    agent_id
  ) {
    event = { type: 'conversation_assigned', agent_id };
  } else if (event_type === 'new_contact_created') {
    event = { type: 'new_contact_created' };
  } else {
    return NextResponse.json(
      { error: 'event_type is missing or unsupported' },
      { status: 400 }
    );
  }

  const { started } = await dispatchEventToFlows({
    accountId,
    contactId: contact_id,
    conversationId: conversation_id,
    event,
  });

  return NextResponse.json({ ok: true, started });
}

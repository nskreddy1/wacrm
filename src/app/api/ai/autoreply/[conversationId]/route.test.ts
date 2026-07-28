import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Regression tests for the "Resume AI is a silent no-op" production bug.
//
// Once a human replied on a thread, the `close_handoff_on_agent_message` DB
// trigger set `ai_handoff_state = 'human_active'`. `resolveHandoffPosture`
// maps that state to `silent`, so the bot stood down — correct. But the
// "Resume AI" action only cleared the pause flag, assignment, and reply
// count; NOTHING ever wrote `ai_handoff_state` back. The thread stayed mute
// forever while every visible control read "not paused".
//
// Production evidence (structured auto-reply log):
//   outcome=human_took_over {"handoffState":"human_active",
//                            "killSwitch":false,"assigned":false}
//
// These tests pin the contract: resuming MUST reopen the handoff lifecycle
// (`ai_handoff_state: 'none'`) and clear stale escalation bookkeeping, and
// taking over MUST NOT touch the lifecycle (the DB trigger owns that side).
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  state: {
    conv: { id: 'conv-1' } as Record<string, unknown> | null,
    updatePayload: null as Record<string, unknown> | null,
  },
}));

vi.mock('@/features/auth/lib/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.state.conv, error: null }),
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload;
          return {
            eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
          };
        },
      }),
    },
  })),
  toErrorResponse: vi.fn(
    () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
  ),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ success: true })),
  rateLimitResponse: vi.fn(
    () => new Response(JSON.stringify({ error: 'rate' }), { status: 429 })
  ),
  RATE_LIMITS: { send: { limit: 30, windowMs: 60_000 } },
}));

import { POST } from './route';

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://test/api/ai/autoreply/conv-1', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ conversationId: 'conv-1' }) }
  );
}

beforeEach(() => {
  h.state.conv = { id: 'conv-1' };
  h.state.updatePayload = null;
});

describe('POST /api/ai/autoreply/[conversationId] — resume', () => {
  it('reopens the handoff lifecycle so human_active threads recover', async () => {
    const res = await post({ paused: false });
    expect(res.status).toBe(200);

    // THE regression assertion: without `ai_handoff_state: 'none'` the
    // update succeeds, returns 200, clears the pause flag — and the bot
    // stays silent forever. Everything looks healthy except the outcome.
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: false,
      ai_handoff_state: 'none',
    });
  });

  it('clears stale escalation bookkeeping alongside the lifecycle', async () => {
    await post({ paused: false });
    expect(h.state.updatePayload).toMatchObject({
      assigned_agent_id: null,
      ai_reply_count: 0,
      ai_handoff_summary: null,
      ai_escalated_at: null,
      ai_escalation_reason: null,
    });
  });
});

describe('POST /api/ai/autoreply/[conversationId] — take over', () => {
  it('does NOT touch the handoff lifecycle when pausing', async () => {
    // Takeover must leave `ai_handoff_state` to the DB trigger: writing
    // `human_active` here would fire before the human actually replies,
    // and writing `none` would undo a trigger that already fired.
    const res = await post({ paused: true, assign_to_me: true });
    expect(res.status).toBe(200);
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'user-1',
    });
    expect(h.state.updatePayload).not.toHaveProperty('ai_handoff_state');
    expect(h.state.updatePayload).not.toHaveProperty('ai_escalated_at');
  });
});

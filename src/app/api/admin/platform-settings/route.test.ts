// ============================================================
// PATCH /api/admin/platform-settings — configure-before-enable.
//
// Pins the rule that invite email delivery cannot be switched ON
// until a sender actually exists. Without this, an operator flips
// the toggle, every invite silently falls through to
// `no_provider`, and nobody finds out until a new hire says they
// never got their invite.
//
// The UI disables the radio too, but that is cosmetic — this route
// is the enforcement point, so the rule is tested here.
// ============================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';

let configured = false;
const upserted: unknown[] = [];

vi.mock('@/features/auth/lib/super-admin', () => ({
  requireSuperAdmin: async () => ({
    userId: 'super-1',
    supabase: {},
  }),
}));

vi.mock('@/features/assistant/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      upsert: async (rows: unknown) => {
        upserted.push(rows);
        return { error: null };
      },
    }),
  }),
}));

vi.mock('@/lib/email/platform-invite-transport', () => ({
  getPlatformTransportSummary: async () => ({ configured }),
}));

vi.mock('@/features/admin/lib/platform/audit', () => ({
  logPlatformAudit: async () => undefined,
}));

vi.mock('@/features/assistant/lib/ai/engine-flag', () => ({
  getAiEngine: async () => 'direct',
  resetEngineCache: () => undefined,
}));

vi.mock('@/lib/email/invite-delivery-mode', () => ({
  getInviteDeliveryMode: async () => 'link_only',
  isInviteDeliveryMode: (v: unknown) => v === 'email' || v === 'link_only',
  resetInviteDeliveryModeCache: () => undefined,
  PLATFORM_SETTING_KEY: 'invite_delivery_mode',
}));

function patch(body: unknown): Request {
  return new Request('http://localhost/api/admin/platform-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/admin/platform-settings — invite_delivery_mode', () => {
  beforeEach(() => {
    configured = false;
    upserted.length = 0;
    delete process.env.RESEND_API_KEY;
    vi.resetModules();
  });

  it('refuses to enable email delivery with no sender configured', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patch({ invite_delivery_mode: 'email' }));

    expect(res.status).toBe(409);
    // Nothing was written — the setting must stay off, not be
    // saved-then-warned.
    expect(upserted).toHaveLength(0);
    const body = await res.json();
    expect(body.error).toMatch(/configure an invite sender/i);
  });

  it('allows enabling email delivery once a sender exists', async () => {
    configured = true;
    const { PATCH } = await import('./route');
    const res = await PATCH(patch({ invite_delivery_mode: 'email' }));

    expect(res.status).toBe(200);
    expect(upserted).toHaveLength(1);
  });

  it('accepts the RESEND_API_KEY env fallback as a configured sender', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const { PATCH } = await import('./route');
    const res = await PATCH(patch({ invite_delivery_mode: 'email' }));

    expect(res.status).toBe(200);
  });

  it('always allows turning delivery back OFF', async () => {
    // The escape hatch must never be gated: an operator has to be
    // able to stop outbound invite mail even in a broken state.
    const { PATCH } = await import('./route');
    const res = await PATCH(patch({ invite_delivery_mode: 'link_only' }));

    expect(res.status).toBe(200);
    expect(upserted).toHaveLength(1);
  });
});

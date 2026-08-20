import { describe, expect, it } from 'vitest';

import {
  COMPOSER_MARGIN_MS,
  evaluateSessionWindow,
  newestInboundInPage,
  WHATSAPP_WINDOW_MS,
} from './session-window';

const NOW = new Date('2026-08-20T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const hours = (h: number) => h * 60 * 60 * 1000;
const minutes = (m: number) => m * 60 * 1000;

describe('evaluateSessionWindow (ADR-006 D9, critique C6)', () => {
  it('treats a thread with no inbound as CLOSED, not open', () => {
    const state = evaluateSessionWindow({ now: NOW });
    expect(state).toMatchObject({ closed: true, hasInbound: false });
  });

  it('treats an unparseable timestamp as no inbound', () => {
    expect(
      evaluateSessionWindow({ lastInboundAt: 'not-a-date', now: NOW }).closed
    ).toBe(true);
  });

  it('is open well inside the window', () => {
    const state = evaluateSessionWindow({
      lastInboundAt: ago(hours(1)),
      now: NOW,
    });
    expect(state.closed).toBe(false);
    expect(state.closingSoon).toBe(false);
    expect(state.msRemaining).toBe(WHATSAPP_WINDOW_MS - hours(1));
  });

  it('closes early inside the composer margin, while the server is still open', () => {
    const state = evaluateSessionWindow({
      lastInboundAt: ago(hours(24) - minutes(5)),
      now: NOW,
    });
    expect(state.closed).toBe(true);
    expect(state.closingSoon).toBe(true);
    expect(state.msRemaining).toBeGreaterThan(0);
    expect(state.msRemaining).toBeLessThanOrEqual(COMPOSER_MARGIN_MS);
  });

  it('is closed past 24h with no remaining time', () => {
    const state = evaluateSessionWindow({
      lastInboundAt: ago(hours(30)),
      now: NOW,
    });
    expect(state).toMatchObject({
      closed: true,
      closingSoon: false,
      msRemaining: 0,
    });
  });

  it('prefers whichever inbound signal is newer (realtime beats a stale column)', () => {
    const state = evaluateSessionWindow({
      lastInboundAt: ago(hours(25)),
      loadedInboundAt: ago(minutes(2)),
      now: NOW,
    });
    expect(state.closed).toBe(false);
  });

  it('never lets a stale page override a fresher column', () => {
    const state = evaluateSessionWindow({
      lastInboundAt: ago(minutes(2)),
      loadedInboundAt: ago(hours(40)),
      now: NOW,
    });
    expect(state.closed).toBe(false);
  });

  it('leaves non-WhatsApp threads unrestricted', () => {
    for (const channel of ['sms', 'email'] as const) {
      expect(evaluateSessionWindow({ channel, now: NOW }).closed).toBe(false);
    }
  });
});

describe('newestInboundInPage', () => {
  it('ignores agent and bot messages', () => {
    expect(
      newestInboundInPage([
        { sender_type: 'agent', created_at: ago(minutes(1)) },
        { sender_type: 'bot', created_at: ago(minutes(2)) },
      ])
    ).toBeNull();
  });

  it('returns the newest customer message regardless of order', () => {
    const newest = ago(minutes(5));
    expect(
      newestInboundInPage([
        { sender_type: 'customer', created_at: newest },
        { sender_type: 'customer', created_at: ago(hours(3)) },
      ])
    ).toBe(newest);
  });
});

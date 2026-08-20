import { describe, expect, it } from 'vitest';

import {
  OutboundBlockedError,
  isFreeFormPayload,
  evaluateOutboundWindow,
} from './window-guard';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-08-20T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR).toISOString();

describe('isFreeFormPayload', () => {
  // ADR-006 D4/D21: classification is an allowlist of what is exempt, so an
  // unrecognised future payload kind is treated as free-form (fails closed).
  it('treats text, media and interactive as free-form', () => {
    expect(isFreeFormPayload({ kind: 'text', text: 'hi' })).toBe(true);
    expect(
      isFreeFormPayload({
        kind: 'media',
        mediaKind: 'image',
        url: 'https://example.test/a.png',
      })
    ).toBe(true);
    expect(
      isFreeFormPayload({ kind: 'interactive', interactive: {} })
    ).toBe(true);
  });

  it('exempts only template payloads', () => {
    expect(
      isFreeFormPayload({
        kind: 'template',
        templateName: 'appointment_reminder',
        language: 'en',
      })
    ).toBe(false);
  });

  it('fails closed on an unknown payload kind', () => {
    expect(
      isFreeFormPayload({ kind: 'carousel' } as unknown as Parameters<
        typeof isFreeFormPayload
      >[0])
    ).toBe(true);
  });
});

describe('evaluateOutboundWindow', () => {
  const open = { channel: 'whatsapp' as const, lastInboundAt: hoursAgo(1) };

  it('allows free-form inside the 24h window', () => {
    expect(() =>
      evaluateOutboundWindow({
        ...open,
        payload: { kind: 'text', text: 'hi' },
        optedOut: false,
        now,
      })
    ).not.toThrow();
  });

  it('rejects free-form outside the window with window_closed 409', () => {
    try {
      evaluateOutboundWindow({
        channel: 'whatsapp',
        lastInboundAt: hoursAgo(25),
        payload: { kind: 'text', text: 'hi' },
        optedOut: false,
        now,
      });
      throw new Error('expected evaluateOutboundWindow to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OutboundBlockedError);
      const blocked = error as OutboundBlockedError;
      expect(blocked.code).toBe('window_closed');
      expect(blocked.status).toBe(409);
      // The error must name the way out (ADR-006 D4).
      expect(blocked.message).toMatch(/template/i);
    }
  });

  it('rejects free-form when no inbound message has ever arrived', () => {
    // NULL last_inbound_at = window closed. This is the cold-contact case and
    // the fail-closed direction the composer already takes.
    expect(() =>
      evaluateOutboundWindow({
        channel: 'whatsapp',
        lastInboundAt: null,
        payload: { kind: 'text', text: 'hi' },
        optedOut: false,
        now,
      })
    ).toThrow(OutboundBlockedError);
  });

  it('allows templates outside the window', () => {
    expect(() =>
      evaluateOutboundWindow({
        channel: 'whatsapp',
        lastInboundAt: null,
        payload: {
          kind: 'template',
          templateName: 'appointment_reminder',
          language: 'en',
        },
        optedOut: false,
        now,
      })
    ).not.toThrow();
  });

  it('rejects an exactly-24h-old window (boundary is exclusive)', () => {
    expect(() =>
      evaluateOutboundWindow({
        channel: 'whatsapp',
        lastInboundAt: hoursAgo(24),
        payload: { kind: 'text', text: 'hi' },
        optedOut: false,
        now,
      })
    ).toThrow(OutboundBlockedError);
  });

  it('blocks an opted-out contact even for templates', () => {
    // ADR-006 D8: consent outranks the window, and a template is not a way
    // around STOP.
    try {
      evaluateOutboundWindow({
        ...open,
        payload: {
          kind: 'template',
          templateName: 'appointment_reminder',
          language: 'en',
        },
        optedOut: true,
        now,
      });
      throw new Error('expected evaluateOutboundWindow to throw');
    } catch (error) {
      const blocked = error as OutboundBlockedError;
      expect(blocked.code).toBe('contact_opted_out');
      expect(blocked.status).toBe(409);
    }
  });

  it('ignores the window on non-WhatsApp channels', () => {
    // SMS/email have no window and no template regime (ADR-006 D10).
    expect(() =>
      evaluateOutboundWindow({
        channel: 'sms',
        lastInboundAt: null,
        payload: { kind: 'text', text: 'hi' },
        optedOut: false,
        now,
      })
    ).not.toThrow();
  });

  it('still enforces opt-out on non-WhatsApp channels', () => {
    expect(() =>
      evaluateOutboundWindow({
        channel: 'sms',
        lastInboundAt: null,
        payload: { kind: 'text', text: 'hi' },
        optedOut: true,
        now,
      })
    ).toThrow(OutboundBlockedError);
  });

  it('rejects an unparseable last_inbound_at rather than trusting it', () => {
    expect(() =>
      evaluateOutboundWindow({
        channel: 'whatsapp',
        lastInboundAt: 'not-a-date',
        payload: { kind: 'text', text: 'hi' },
        optedOut: false,
        now,
      })
    ).toThrow(OutboundBlockedError);
  });

  it('rejects a future last_inbound_at beyond clock-skew tolerance', () => {
    // A far-future timestamp would otherwise hold the window open forever.
    expect(() =>
      evaluateOutboundWindow({
        channel: 'whatsapp',
        lastInboundAt: new Date(now.getTime() + 48 * HOUR).toISOString(),
        payload: { kind: 'text', text: 'hi' },
        optedOut: false,
        now,
      })
    ).toThrow(OutboundBlockedError);
  });
});

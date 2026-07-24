import { describe, expect, it } from 'vitest';
import { isValidStatusTransition, mapTwilioStatus } from './status';

describe('mapTwilioStatus', () => {
  it('maps terminal delivery statuses onto the unified ladder', () => {
    expect(mapTwilioStatus('sent')).toBe('sent');
    expect(mapTwilioStatus('delivered')).toBe('delivered');
    expect(mapTwilioStatus('read')).toBe('read');
    expect(mapTwilioStatus('failed')).toBe('failed');
    expect(mapTwilioStatus('undelivered')).toBe('failed');
  });

  it('ignores pre-send churn statuses', () => {
    for (const s of [
      'queued',
      'accepted',
      'sending',
      'scheduled',
      'canceled',
      'received',
    ]) {
      expect(mapTwilioStatus(s)).toBeNull();
    }
  });
});

describe('isValidStatusTransition', () => {
  it('allows forward moves on the ladder only', () => {
    expect(isValidStatusTransition('pending', 'sent')).toBe(true);
    expect(isValidStatusTransition('sent', 'delivered')).toBe(true);
    expect(isValidStatusTransition('delivered', 'read')).toBe(true);
    expect(isValidStatusTransition('read', 'delivered')).toBe(false);
    expect(isValidStatusTransition('delivered', 'sent')).toBe(false);
  });

  it('treats failed as terminal and only reachable pre-delivery', () => {
    expect(isValidStatusTransition('pending', 'failed')).toBe(true);
    expect(isValidStatusTransition('sent', 'failed')).toBe(true);
    expect(isValidStatusTransition('delivered', 'failed')).toBe(false);
    expect(isValidStatusTransition('read', 'failed')).toBe(false);
    expect(isValidStatusTransition('failed', 'delivered')).toBe(false);
  });

  it('accepts anything on the ladder when the current status is unknown', () => {
    expect(isValidStatusTransition('weird', 'delivered')).toBe(true);
    expect(isValidStatusTransition('sent', 'weird')).toBe(false);
  });
});

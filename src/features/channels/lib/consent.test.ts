import { describe, expect, it } from 'vitest';
import { detectOptEvent } from './consent';

// ---------------------------------------------------------------------------
// ADR-006 D19: exact-match, case-insensitive, trimmed keyword detection,
// shared by every channel's inbound path. Opt-out: STOP, UNSUBSCRIBE.
// Opt-in: START, UNSTOP. Substrings must NOT match — "please don't stop the
// delivery" is a sentence, not a consent event.
// ---------------------------------------------------------------------------

describe('detectOptEvent', () => {
  it('detects opt-out keywords exactly', () => {
    expect(detectOptEvent('STOP')).toBe('out');
    expect(detectOptEvent('stop')).toBe('out');
    expect(detectOptEvent('  Stop  ')).toBe('out');
    expect(detectOptEvent('UNSUBSCRIBE')).toBe('out');
    expect(detectOptEvent('unsubscribe')).toBe('out');
  });

  it('detects opt-in keywords exactly', () => {
    expect(detectOptEvent('START')).toBe('in');
    expect(detectOptEvent('start')).toBe('in');
    expect(detectOptEvent('UNSTOP')).toBe('in');
    expect(detectOptEvent(' unstop ')).toBe('in');
  });

  it('never matches substrings or sentences', () => {
    expect(detectOptEvent("please don't stop the delivery")).toBeNull();
    expect(detectOptEvent('stop it')).toBeNull();
    expect(detectOptEvent('unstoppable')).toBeNull();
    expect(detectOptEvent('when do we start?')).toBeNull();
  });

  it('returns null for empty and undefined input', () => {
    expect(detectOptEvent('')).toBeNull();
    expect(detectOptEvent('   ')).toBeNull();
    expect(detectOptEvent(undefined)).toBeNull();
  });
});

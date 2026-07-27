import { describe, expect, it } from 'vitest';
import {
  CARETAKER_LIMITS,
  CARETAKER_POLICY,
  caretakerPolicyFor,
  caretakerPromptOverlay,
  fallbackCaretakerMessage,
  resolveHandoffPosture,
  waitingMinutes,
} from './caretaker';

/**
 * The bug these lock down: escalation used to mute the assistant
 * instantly, because *assignment* was treated as *contact*. The posture
 * must depend on whether a human actually spoke.
 */
describe('resolveHandoffPosture', () => {
  it('holds the customer while awaiting a human who has not replied', () => {
    expect(resolveHandoffPosture({ ai_handoff_state: 'awaiting_human' })).toBe(
      'caretaker'
    );
  });

  it('goes silent only once a human has actually replied', () => {
    expect(resolveHandoffPosture({ ai_handoff_state: 'human_active' })).toBe(
      'silent'
    );
  });

  it('stays in caretaker mode even when an agent is assigned', () => {
    // Regression: assignment alone must NOT silence the assistant.
    expect(
      resolveHandoffPosture({
        ai_handoff_state: 'awaiting_human',
        // @ts-expect-error -- proving assignment is not part of the contract
        assigned_agent_id: 'agent-123',
      })
    ).toBe('caretaker');
  });

  it('respects the operator kill-switch above everything else', () => {
    expect(
      resolveHandoffPosture({
        ai_handoff_state: 'awaiting_human',
        ai_autoreply_disabled: true,
      })
    ).toBe('silent');
  });

  it('defaults to normal for null or unknown states', () => {
    expect(resolveHandoffPosture({})).toBe('normal');
    expect(resolveHandoffPosture({ ai_handoff_state: null })).toBe('normal');
    // An unknown value from a future migration must not mute every thread.
    expect(resolveHandoffPosture({ ai_handoff_state: 'future_state' })).toBe(
      'normal'
    );
  });
});

describe('caretakerPolicyFor', () => {
  it('mirrors the channel_kind enum', () => {
    // Guards against drift from the Postgres enum (whatsapp|email|sms).
    expect(Object.keys(CARETAKER_POLICY).sort()).toEqual([
      'email',
      'sms',
      'voice',
      'whatsapp',
    ]);
  });

  it('holds SMS more sparingly than chat, since it bills per segment', () => {
    expect(CARETAKER_POLICY.sms.maxMessages).toBeLessThan(
      CARETAKER_POLICY.whatsapp.maxMessages
    );
    expect(CARETAKER_POLICY.sms.cooloffSeconds).toBeGreaterThan(
      CARETAKER_POLICY.whatsapp.cooloffSeconds
    );
  });

  it('gives voice a much tighter cadence, because dead air is the failure', () => {
    expect(CARETAKER_POLICY.voice.cooloffSeconds).toBeLessThan(
      CARETAKER_POLICY.whatsapp.cooloffSeconds
    );
  });

  it('falls back to the async-chat shape for unknown or missing channels', () => {
    expect(caretakerPolicyFor(null)).toEqual(CARETAKER_POLICY.whatsapp);
    expect(caretakerPolicyFor(undefined)).toEqual(CARETAKER_POLICY.whatsapp);
    expect(caretakerPolicyFor('carrier-pigeon')).toEqual(
      CARETAKER_POLICY.whatsapp
    );
  });

  it('keeps the legacy constant pointing at the chat baseline', () => {
    expect(CARETAKER_LIMITS).toEqual(CARETAKER_POLICY.whatsapp);
  });

  it('never allows an unbounded budget', () => {
    // A zero cool-off or infinite cap would let one thread spam a customer.
    for (const policy of Object.values(CARETAKER_POLICY)) {
      expect(policy.maxMessages).toBeGreaterThan(0);
      expect(policy.cooloffSeconds).toBeGreaterThan(0);
    }
  });
});

describe('waitingMinutes', () => {
  it('returns null when the thread was never escalated', () => {
    expect(waitingMinutes({})).toBeNull();
  });

  it('returns null rather than NaN for an unparseable timestamp', () => {
    expect(waitingMinutes({ ai_escalated_at: 'not-a-date' })).toBeNull();
  });

  it('never reports a negative wait for a clock-skewed future timestamp', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(waitingMinutes({ ai_escalated_at: future })).toBe(0);
  });

  it('floors elapsed time to whole minutes', () => {
    const past = new Date(Date.now() - 5 * 60_000 - 30_000).toISOString();
    expect(waitingMinutes({ ai_escalated_at: past })).toBe(5);
  });
});

describe('caretakerPromptOverlay', () => {
  it('forbids re-announcing the escalation and inventing promises', () => {
    const overlay = caretakerPromptOverlay({ waitedMinutes: 2 });
    expect(overlay).toContain('Do NOT repeat');
    expect(overlay).toContain('Do NOT promise');
    expect(overlay).toContain('Do NOT invent');
  });

  it('asks for an honest acknowledgement once the wait is long', () => {
    const overlay = caretakerPromptOverlay({ waitedMinutes: 20 });
    expect(overlay).toContain('20 minutes');
    expect(overlay).toContain('without excuses');
  });

  it('stays quiet about the delay when the wait is still short', () => {
    expect(caretakerPromptOverlay({ waitedMinutes: 3 })).not.toContain(
      'without excuses'
    );
  });

  it('humanises the escalation reason instead of leaking a raw enum', () => {
    const overlay = caretakerPromptOverlay({
      waitedMinutes: null,
      escalationReason: 'negative_sentiment',
    });
    expect(overlay).toContain('negative sentiment');
    expect(overlay).not.toContain('negative_sentiment');
  });
});

describe('fallbackCaretakerMessage', () => {
  it('escalates in honesty as the wait grows', () => {
    const short = fallbackCaretakerMessage(1);
    const medium = fallbackCaretakerMessage(12);
    const long = fallbackCaretakerMessage(45);

    expect(new Set([short, medium, long]).size).toBe(3);
    expect(long).toContain('longer than it should');
  });

  it('never re-announces the handoff in any variant', () => {
    // Repeating "I'm looping in a teammate" is what reads as a broken bot.
    for (const minutes of [null, 0, 12, 45]) {
      expect(fallbackCaretakerMessage(minutes)).not.toMatch(/looping in/i);
    }
  });
});

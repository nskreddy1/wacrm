import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_ERROR_NOTICES,
  classifyAssistantError,
  encodeAssistantErrorCode,
  resolveAssistantErrorNotice,
} from './chat-errors';

/**
 * The route classifies a failure and puts only a code on the wire; the
 * widget turns that code back into copy. These tests hold the two halves
 * together — a mismatch would silently degrade every assistant failure
 * back to the generic "couldn't finish that reply" this module exists to
 * replace.
 */
describe('assistant chat errors', () => {
  it('round-trips every code from the server encoding to user copy', () => {
    for (const code of ASSISTANT_ERROR_CODES) {
      const wire = encodeAssistantErrorCode(code);
      expect(resolveAssistantErrorNotice(new Error(wire))).toEqual(
        ASSISTANT_ERROR_NOTICES[code]
      );
    }
  });

  it('survives the SDK wrapping the code in extra text', () => {
    // The stream may prefix/suffix the message on its way through, so
    // resolution must not depend on the code being the whole string.
    const wire = encodeAssistantErrorCode('rate_limited');
    expect(
      resolveAssistantErrorNotice(new Error(`Error: ${wire} (request abc)`))
    ).toEqual(ASSISTANT_ERROR_NOTICES.rate_limited);
  });

  it('separates an exhausted quota from ordinary rate limiting', () => {
    // Both mention limits, but only one is fixable by waiting — telling a
    // user to "wait a minute" when billing is dead wastes their time.
    expect(classifyAssistantError(new Error('You exceeded your quota'))).toBe(
      'quota_exhausted'
    );
    expect(
      classifyAssistantError(new Error('Rate limit reached for gpt-4o'))
    ).toBe('rate_limited');
    expect(ASSISTANT_ERROR_NOTICES.quota_exhausted.recovery).toMatch(/admin/i);
    expect(ASSISTANT_ERROR_NOTICES.rate_limited.recovery).toMatch(/wait/i);
  });

  it('tells the user to start over when a tool call lost its result', () => {
    // The real provider wording for a dangling tool call. Retrying can
    // never fix it — the broken turn is replayed every time — so this
    // must not be classified as anything whose advice is "resend".
    const messages = [
      "An assistant message with 'tool_calls' must be followed by tool messages responding to each tool_call_id",
      'tool_use ids were found without tool_result blocks immediately after',
    ];
    for (const message of messages) {
      expect(classifyAssistantError(new Error(message)), message).toBe(
        'conversation_out_of_sync'
      );
    }
    expect(ASSISTANT_ERROR_NOTICES.conversation_out_of_sync.recovery).toMatch(
      /new chat/i
    );
  });

  it('classifies by HTTP status when there is no useful message', () => {
    expect(classifyAssistantError({ status: 401 })).toBe('invalid_key');
    expect(classifyAssistantError({ status: 429 })).toBe('rate_limited');
    expect(classifyAssistantError({ statusCode: 404 })).toBe(
      'model_unavailable'
    );
  });

  it('recognises client-side failures that never reached the stream', () => {
    // A dropped connection is classified in the browser, with no code.
    expect(classifyAssistantError(new Error('Load failed'))).toBe(
      'provider_timeout'
    );
    expect(classifyAssistantError(new TypeError('fetch failed'))).toBe(
      'provider_timeout'
    );
  });

  it('falls back to the generic notice instead of leaking raw text', () => {
    const notice = resolveAssistantErrorNotice(
      new Error('pq: relation "x" does not exist at 10.0.0.4:5432')
    );
    expect(notice).toEqual(ASSISTANT_ERROR_NOTICES.unknown);
    // The database host must not reach the user.
    expect(JSON.stringify(notice)).not.toMatch(/10\.0\.0\.4|relation/);
  });

  it('never renders a raw code to the user', () => {
    // An unrecognised code must degrade to copy, not show "mira_error:…".
    const notice = resolveAssistantErrorNotice(
      new Error('mira_error:not_a_real_code')
    );
    expect(JSON.stringify(notice)).not.toMatch(/mira_error/);
  });

  it('gives every code non-empty cause and recovery copy', () => {
    for (const code of ASSISTANT_ERROR_CODES) {
      const notice = ASSISTANT_ERROR_NOTICES[code];
      expect(notice.cause.length, code).toBeGreaterThan(0);
      expect(notice.recovery.length, code).toBeGreaterThan(0);
    }
  });

  it('handles null and undefined without throwing', () => {
    expect(resolveAssistantErrorNotice(undefined)).toEqual(
      ASSISTANT_ERROR_NOTICES.unknown
    );
    expect(resolveAssistantErrorNotice(null)).toEqual(
      ASSISTANT_ERROR_NOTICES.unknown
    );
  });
});

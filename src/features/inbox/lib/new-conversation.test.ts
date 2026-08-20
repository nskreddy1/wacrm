import { describe, it, expect } from 'vitest';
import {
  contactBlockReason,
  matchesContactQuery,
  renderTemplatePreview,
  resolveSendOutcome,
  type ContactCandidate,
} from './new-conversation';

const contact: ContactCandidate = {
  id: 'c1',
  name: 'Ada Lovelace',
  phone: '+1 (555) 010-1234',
  email: 'ada@example.com',
};

describe('contactBlockReason', () => {
  it('allows a contact with a phone who has not opted out', () => {
    expect(contactBlockReason(contact)).toBeNull();
  });

  it('blocks a contact who replied STOP', () => {
    expect(contactBlockReason({ ...contact, whatsappOptedOut: true })).toBe(
      'opted_out'
    );
  });

  it('blocks a contact with no phone number', () => {
    expect(contactBlockReason({ ...contact, phone: null })).toBe('no_phone');
    expect(contactBlockReason({ ...contact, phone: '' })).toBe('no_phone');
  });

  it('blocks a phone that has no digits at all', () => {
    // Guards against a junk-but-truthy value like '-' or 'n/a' passing the
    // presence check and producing an unsendable thread.
    expect(contactBlockReason({ ...contact, phone: '---' })).toBe('no_phone');
  });

  it('reports opt-out ahead of a missing phone', () => {
    // Both are terminal, but opt-out is the more meaningful explanation.
    expect(
      contactBlockReason({ ...contact, phone: null, whatsappOptedOut: true })
    ).toBe('opted_out');
  });

  it('treats an absent opt-out flag as not opted out', () => {
    // Fetch paths that don't select the column must stay usable; the server
    // guard remains the real boundary.
    expect(contactBlockReason({ ...contact, whatsappOptedOut: null })).toBeNull();
    expect(
      contactBlockReason({ id: 'c2', name: 'No Flag', phone: '+15550000000' })
    ).toBeNull();
  });
});

describe('matchesContactQuery', () => {
  it('matches a name case-insensitively', () => {
    expect(matchesContactQuery(contact, 'ada')).toBe(true);
    expect(matchesContactQuery(contact, 'LOVELACE')).toBe(true);
  });

  it('matches a phone typed without formatting', () => {
    expect(matchesContactQuery(contact, '5550101234')).toBe(true);
  });

  it('matches a phone typed with a leading plus', () => {
    expect(matchesContactQuery(contact, '+15550101234')).toBe(true);
  });

  it('matches an email fragment', () => {
    expect(matchesContactQuery(contact, 'example.com')).toBe(true);
  });

  it('rejects a query that matches nothing', () => {
    expect(matchesContactQuery(contact, 'zzz')).toBe(false);
  });

  it('treats a blank query as unfiltered', () => {
    expect(matchesContactQuery(contact, '   ')).toBe(true);
  });

  it('does not crash on a contact with no name or email', () => {
    const bare: ContactCandidate = { id: 'c2', phone: '+447700900123' };
    expect(matchesContactQuery(bare, '447700900123')).toBe(true);
    expect(matchesContactQuery(bare, 'ada')).toBe(false);
  });
});

describe('renderTemplatePreview', () => {
  it('substitutes positional placeholders in order', () => {
    expect(renderTemplatePreview('Hi {{1}}, your {{2}} is ready', ['Ada', 'order'])).toBe(
      'Hi Ada, your order is ready'
    );
  });

  it('leaves an unfilled placeholder visible so the gap is obvious', () => {
    expect(renderTemplatePreview('Hi {{1}}, your {{2}} is ready', ['Ada'])).toBe(
      'Hi Ada, your {{2}} is ready'
    );
  });

  it('repeats a value when the same placeholder appears twice', () => {
    expect(renderTemplatePreview('{{1}} and {{1}}', ['Ada'])).toBe('Ada and Ada');
  });

  it('returns a body with no placeholders unchanged', () => {
    expect(renderTemplatePreview('No variables here', [])).toBe(
      'No variables here'
    );
  });
});

describe('resolveSendOutcome', () => {
  it('reports a successful send with the conversation id', () => {
    expect(
      resolveSendOutcome(200, { conversation_id: 'conv-1' })
    ).toEqual({ kind: 'sent', conversationId: 'conv-1' });
  });

  it('reports success even when the route omits the conversation id', () => {
    expect(resolveSendOutcome(200, {})).toEqual({
      kind: 'sent',
      conversationId: null,
    });
  });

  it('maps a 409 window_closed onto the template-required state', () => {
    expect(
      resolveSendOutcome(409, { code: 'window_closed', error: 'closed' })
    ).toEqual({ kind: 'window_closed' });
  });

  it('maps a 409 contact_opted_out onto the terminal opted-out state', () => {
    expect(
      resolveSendOutcome(409, { code: 'contact_opted_out', error: 'stop' })
    ).toEqual({ kind: 'opted_out' });
  });

  it('maps a 429 onto rate_limited and surfaces retry_after', () => {
    expect(resolveSendOutcome(429, { retry_after: 30 })).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 30,
    });
  });

  it('maps a 429 with no retry hint onto rate_limited with a null delay', () => {
    expect(resolveSendOutcome(429, {})).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: null,
    });
  });

  it('fails closed on an unrecognised 409 code', () => {
    const outcome = resolveSendOutcome(409, {
      code: 'something_new',
      error: 'Blocked by policy',
    });
    expect(outcome).toEqual({ kind: 'error', message: 'Blocked by policy' });
  });

  it('surfaces the server message on a 500', () => {
    expect(resolveSendOutcome(500, { error: 'Meta rejected the send' })).toEqual(
      { kind: 'error', message: 'Meta rejected the send' }
    );
  });

  it('falls back to a generic message when the body has none', () => {
    const outcome = resolveSendOutcome(500, null);
    expect(outcome.kind).toBe('error');
    expect((outcome as { message: string }).message).toBeTruthy();
  });
});

import { describe, expect, it } from 'vitest';

import { resolveBindings, resolveRestPath } from './bindings';
import {
  IntegrationError,
  type BindableContact,
  type OperationBinding,
} from './types';

const contact: BindableContact = {
  id: 'c-1',
  account_id: 'a-1',
  phone: '+91 98765 43210',
  phone_normalized: '919876543210',
  email: 'asha@example.com',
  name: 'Asha',
  company: 'Acme',
};

const bind = (param: number, source: string): OperationBinding =>
  ({ param, source }) as OperationBinding;

describe('resolveBindings', () => {
  it('returns values in positional order', () => {
    expect(
      resolveBindings(contact, [
        bind(2, 'contact.email'),
        bind(1, 'contact.phone_normalized'),
      ])
    ).toEqual(['919876543210', 'asha@example.com']);
  });

  it('returns an empty array when there are no parameters', () => {
    expect(resolveBindings(contact, [])).toEqual([]);
  });

  it('derives phone_normalized from phone when the column is null', () => {
    const legacy = { ...contact, phone_normalized: null };
    expect(resolveBindings(legacy, [bind(1, 'contact.phone_normalized')])).toEqual(
      ['919876543210']
    );
  });

  it('refuses to run when a bound field is missing', () => {
    // Running with null could match unintended rows in the remote
    // system, so skipping the lookup is the safe outcome.
    const noEmail = { ...contact, email: null };
    expect(() =>
      resolveBindings(noEmail, [bind(1, 'contact.email')])
    ).toThrow(IntegrationError);
  });

  it('refuses to run when a bound field is an empty string', () => {
    const blank = { ...contact, email: '' };
    expect(() => resolveBindings(blank, [bind(1, 'contact.email')])).toThrow(
      IntegrationError
    );
  });

  it('rejects non-contiguous parameters written directly to the database', () => {
    expect(() =>
      resolveBindings(contact, [bind(1, 'contact.phone'), bind(3, 'contact.email')])
    ).toThrow(/consecutively/);
  });

  it('rejects an unknown binding source', () => {
    // The identity rule: there is no source that reads the customer's
    // message, so an injected one must fail closed.
    expect(() =>
      resolveBindings(contact, [bind(1, 'message.order_id')])
    ).toThrow(IntegrationError);
  });
});

describe('resolveRestPath', () => {
  it('interpolates a bindable field', () => {
    expect(resolveRestPath(contact, '/orders?phone={contact.phone_normalized}')).toBe(
      '/orders?phone=919876543210'
    );
  });

  it('URL-encodes the value so it cannot restructure the path', () => {
    const hostile = { ...contact, email: 'a/../../admin?x=1#f' };
    expect(resolveRestPath(hostile, '/u/{contact.email}')).toBe(
      '/u/a%2F..%2F..%2Fadmin%3Fx%3D1%23f'
    );
  });

  it('encodes a plus sign in a phone number', () => {
    expect(resolveRestPath(contact, '/o/{contact.phone}')).toBe(
      '/o/%2B91%2098765%2043210'
    );
  });

  it('refuses when the field is missing', () => {
    const noEmail = { ...contact, email: null };
    expect(() => resolveRestPath(noEmail, '/u/{contact.email}')).toThrow(
      IntegrationError
    );
  });

  it('leaves a template with no placeholders untouched', () => {
    expect(resolveRestPath(contact, '/orders/recent')).toBe('/orders/recent');
  });
});

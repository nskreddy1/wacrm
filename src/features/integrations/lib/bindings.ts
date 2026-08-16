// ============================================================
// Binding resolution — THE identity boundary of this feature.
//
// Parameter values are read from the server-resolved contact row. The
// model, and therefore the customer's message, cannot reach this
// function: `resolveBindings` takes a contact and a binding list, and
// there is no code path that accepts a model-supplied value.
//
// This mirrors `crm-context.ts`, which scopes every query with
// `.eq('contact_id', contactId)` using the contact the webhook already
// identified from the sender's phone number.
//
// Concretely: a customer asking "status of order 5567?" does NOT cause a
// lookup of order 5567. It causes "orders for THIS contact" to be
// fetched (capped), and the model answers from that set. If 5567 is not
// theirs, it simply is not in the data.
// ============================================================

import {
  IntegrationError,
  type BindableContact,
  type BindingSource,
  type OperationBinding,
} from './types';

function readField(
  contact: BindableContact,
  source: BindingSource
): string | null {
  switch (source) {
    case 'contact.id':
      return contact.id;
    case 'contact.account_id':
      return contact.account_id;
    case 'contact.phone':
      return contact.phone;
    case 'contact.phone_normalized':
      // Falling back to a digits-only form of `phone` matters because
      // the column is generated and can be null on rows written before
      // it existed; an external system almost always stores digits only.
      return contact.phone_normalized ?? contact.phone?.replace(/\D/g, '') ?? null;
    case 'contact.email':
      return contact.email;
    case 'contact.name':
      return contact.name;
    case 'contact.company':
      return contact.company;
    default: {
      // Exhaustiveness: a new BindingSource must be handled explicitly
      // rather than silently resolving to undefined and being sent as a
      // null parameter.
      const never: never = source;
      throw new IntegrationError(`Unsupported binding source "${never}".`);
    }
  }
}

/**
 * Build the positional parameter array for a statement.
 *
 * Throws when a bound field is empty on this contact. That is
 * deliberate: an operation keyed on `contact.email` for a
 * WhatsApp-only contact would otherwise run with `null` and, depending
 * on the remote statement, could match unintended rows (`WHERE
 * email IS NOT DISTINCT FROM NULL`) or return someone else's data.
 * Refusing to run is the safe outcome — the caller reports "no data"
 * and the AI falls back to a human handoff.
 */
export function resolveBindings(
  contact: BindableContact,
  bindings: OperationBinding[]
): unknown[] {
  const ordered = [...bindings].sort((a, b) => a.param - b.param);
  const values: unknown[] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const binding = ordered[index];
    // Positions must be contiguous from 1 — validated on save, but
    // re-checked here because a row could have been edited directly in
    // the database, bypassing the API.
    if (binding.param !== index + 1) {
      throw new IntegrationError(
        `Operation parameters must be numbered consecutively from $1 (expected $${index + 1}, found $${binding.param}).`
      );
    }

    const value = readField(contact, binding.source);
    if (value === null || value === '') {
      throw new IntegrationError(
        `This contact has no ${binding.source.replace('contact.', '')} on record, so the lookup was skipped.`
      );
    }
    values.push(value);
  }

  return values;
}

/**
 * Interpolate a REST path template.
 *
 * Values are `encodeURIComponent`-escaped so a contact field containing
 * `/`, `?`, `#` or `..` cannot restructure the path, add query
 * parameters, or climb above the connection's `base_url`.
 */
export function resolveRestPath(
  contact: BindableContact,
  template: string
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, rawField: string) => {
    const field = rawField.trim() as BindingSource;
    const value = readField(contact, field);
    if (value === null || value === '') {
      throw new IntegrationError(
        `This contact has no ${field.replace('contact.', '')} on record, so the lookup was skipped.`
      );
    }
    return encodeURIComponent(value);
  });
}

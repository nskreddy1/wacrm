import { describe, expect, it } from 'vitest';

import {
  extractTemplateVariables,
  hasNamedVariables,
  renderTemplateText,
  toContentVariables,
  toPositionalValues,
} from './template-variables';

// Two placeholder dialects reach this module: Meta's strictly positional
// `{{1}}` and Twilio/SMS-Studio's named `{{first_name}}`. Conflating them
// is what shipped raw `{{first_name}}` text to contacts, so every test
// below pins one dialect boundary.
describe('extractTemplateVariables', () => {
  it('extracts positional tokens keeping their declared number', () => {
    expect(extractTemplateVariables('Hi {{1}}, order {{2}} shipped')).toEqual([
      { token: '1', kind: 'positional', index: 1, label: '{{1}}' },
      { token: '2', kind: 'positional', index: 2, label: '{{2}}' },
    ]);
  });

  it('keeps a positional token in its declared slot even when it appears first', () => {
    // `{{2}}` must stay slot 2 so the value the agent typed for slot 2
    // does not silently become slot 1 on the wire.
    const vars = extractTemplateVariables('{{2}} then {{1}}');
    expect(vars.map((v) => [v.token, v.index])).toEqual([
      ['2', 2],
      ['1', 1],
    ]);
  });

  it('numbers named tokens by order of first appearance', () => {
    expect(
      extractTemplateVariables('Hi {{first_name}}, see you {{date}}')
    ).toEqual([
      { token: 'first_name', kind: 'named', index: 1, label: 'First name' },
      { token: 'date', kind: 'named', index: 2, label: 'Date' },
    ]);
  });

  it('deduplicates a token repeated in the body', () => {
    const vars = extractTemplateVariables('{{name}} — thanks, {{name}}!');
    expect(vars).toHaveLength(1);
    expect(vars[0].token).toBe('name');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(extractTemplateVariables('Hi {{ first_name }}')[0].token).toBe(
      'first_name'
    );
  });

  it('treats {{0}} as literal text, not a slot', () => {
    // Neither dialect has a slot 0, so numbering it would shift every
    // real slot by one.
    expect(extractTemplateVariables('Discount {{0}}%')).toEqual([]);
  });

  it('returns no variables for null, undefined, or plain text', () => {
    expect(extractTemplateVariables(null)).toEqual([]);
    expect(extractTemplateVariables(undefined)).toEqual([]);
    expect(extractTemplateVariables('Store closes at 9pm.')).toEqual([]);
  });
});

describe('hasNamedVariables', () => {
  it('is true only when a named token is present', () => {
    expect(hasNamedVariables('Hi {{first_name}}')).toBe(true);
    expect(hasNamedVariables('Hi {{1}}')).toBe(false);
    expect(hasNamedVariables('Hi there')).toBe(false);
  });

  it('is true for a mixed body', () => {
    expect(hasNamedVariables('Hi {{1}}, on {{date}}')).toBe(true);
  });
});

describe('renderTemplateText', () => {
  it('substitutes both dialects from one token-keyed map', () => {
    expect(
      renderTemplateText('Hi {{first_name}}, order {{1}} shipped', {
        first_name: 'Asha',
        '1': '#1042',
      })
    ).toBe('Hi Asha, order #1042 shipped');
  });

  it('leaves an unfilled token visible rather than blanking it', () => {
    // A visible `{{date}}` in the preview is a bug the agent can see and
    // fix; a silent empty string is one they cannot.
    expect(renderTemplateText('See you {{date}}', {})).toBe('See you {{date}}');
  });

  it('leaves a whitespace-only value as the raw token', () => {
    expect(renderTemplateText('See you {{date}}', { date: '   ' })).toBe(
      'See you {{date}}'
    );
  });

  it('replaces every occurrence of a repeated token', () => {
    expect(renderTemplateText('{{name}} & {{name}}', { name: 'Asha' })).toBe(
      'Asha & Asha'
    );
  });
});

describe('toPositionalValues', () => {
  it('orders named values by first appearance', () => {
    expect(
      toPositionalValues('Hi {{first_name}}, see you {{date}}', {
        date: 'Friday',
        first_name: 'Asha',
      })
    ).toEqual(['Asha', 'Friday']);
  });

  it('places a positional value in its declared slot', () => {
    expect(toPositionalValues('{{2}} then {{1}}', { '1': 'a', '2': 'b' })).toEqual(
      ['a', 'b']
    );
  });

  it('fills a missing value with an empty string, never null', () => {
    // A sparse array would serialize as `null` and Twilio rejects that.
    const out = toPositionalValues('{{a}} {{b}}', { b: 'two' });
    expect(out).toEqual(['', 'two']);
    expect(out.every((v) => typeof v === 'string')).toBe(true);
  });
});

describe('toContentVariables', () => {
  it('keys a named template by its token names', () => {
    // The regression: keying this positionally is accepted by Twilio but
    // substitutes nothing, so the contact receives raw `{{first_name}}`.
    expect(
      toContentVariables('Hi {{first_name}}, see you {{date}}', [
        'Asha',
        'Friday',
      ])
    ).toEqual({ first_name: 'Asha', date: 'Friday' });
  });

  it('keys a positional template by its numbers', () => {
    expect(
      toContentVariables('Hi {{1}}, order {{2}} shipped', ['Asha', '#1042'])
    ).toEqual({ '1': 'Asha', '2': '#1042' });
  });

  it('honours declared slots for out-of-order positional tokens', () => {
    expect(toContentVariables('{{2}} then {{1}}', ['one', 'two'])).toEqual({
      '1': 'one',
      '2': 'two',
    });
  });

  it('keys a mixed template per token', () => {
    expect(
      toContentVariables('Hi {{1}}, on {{date}}', ['Asha', 'Friday'])
    ).toEqual({ '1': 'Asha', date: 'Friday' });
  });

  it('falls back to positional keys when the body text is unknown', () => {
    // A Twilio-authored template we only know by SID has no local
    // body_text; positional is the correct, pre-existing behaviour.
    expect(toContentVariables(null, ['Asha', 'Friday'])).toEqual({
      '1': 'Asha',
      '2': 'Friday',
    });
  });

  it('returns an empty map for a template with no variables', () => {
    expect(toContentVariables('Store closes at 9pm.', [])).toEqual({});
  });

  it('substitutes an empty string for a value the caller omitted', () => {
    expect(toContentVariables('Hi {{first_name}} {{last_name}}', ['Asha'])).toEqual(
      { first_name: 'Asha', last_name: '' }
    );
  });

  it('coerces non-string values so JSON.stringify never emits a number', () => {
    // Twilio's ContentVariables must be a string→string map.
    expect(toContentVariables('Order {{1}}', [1042])).toEqual({ '1': '1042' });
  });

  it('round-trips with toPositionalValues for a named template', () => {
    const body = 'Hi {{first_name}}, see you {{date}}';
    const typed = { first_name: 'Asha', date: 'Friday' };
    expect(toContentVariables(body, toPositionalValues(body, typed))).toEqual(
      typed
    );
  });
});

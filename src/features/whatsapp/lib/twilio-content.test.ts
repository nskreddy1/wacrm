import { describe, expect, it, vi } from 'vitest';

// The lib guards itself with `import 'server-only'` (a Next.js-only
// package with no runtime export) — stub it so vitest can load it.
vi.mock('server-only', () => ({}));

import {
  normalizeTwilioContent,
  validateWhatsAppTemplateBody,
} from './twilio-content';

// WhatsApp auto-reject rules from the Twilio Content API docs
// (docs/content/twilio-text): leading/trailing/adjacent variables and
// missing samples fail review — we catch them before submission.
describe('validateWhatsAppTemplateBody', () => {
  it('accepts a compliant body with samples', () => {
    expect(
      validateWhatsAppTemplateBody('Hi {{1}}, your order {{2}} shipped!', [
        'Asha',
        '#1042',
      ])
    ).toBeNull();
  });

  it('accepts a plain body with no variables and no samples', () => {
    expect(validateWhatsAppTemplateBody('Store closes at 9pm.', [])).toBeNull();
  });

  it('rejects a body that starts with a variable', () => {
    expect(validateWhatsAppTemplateBody('{{1}}, welcome!', ['Asha'])).toMatch(
      /START/i
    );
  });

  it('rejects a body that ends with a variable', () => {
    expect(validateWhatsAppTemplateBody('Your code is {{1}}', ['1234'])).toMatch(
      /END/i
    );
  });

  it('rejects adjacent variables', () => {
    expect(
      validateWhatsAppTemplateBody('Hi {{1}} {{2}}, welcome aboard.', [
        'Asha',
        'Rao',
      ])
    ).toMatch(/next to each other/i);
  });

  it('requires a sample for every variable', () => {
    expect(
      validateWhatsAppTemplateBody('Hi {{1}}, order {{2}} is ready.', ['Asha'])
    ).toMatch(/sample/i);
  });
});

describe('normalizeTwilioContent', () => {
  it('extracts body and media url from twilio/media templates', () => {
    const result = normalizeTwilioContent({
      sid: 'HX1',
      friendly_name: 'order_update',
      language: 'en',
      types: {
        'twilio/media': {
          body: 'Your order {{1}} shipped.',
          media: ['https://example.com/banner.png'],
        },
      },
    });
    expect(result.body).toBe('Your order {{1}} shipped.');
    expect(result.mediaUrl).toBe('https://example.com/banner.png');
    expect(result.buttons).toEqual([]);
  });

  it('extracts quick replies with a null media url', () => {
    const result = normalizeTwilioContent({
      sid: 'HX2',
      friendly_name: 'opt_in',
      language: 'en',
      types: {
        'twilio/quick-reply': {
          body: 'Connect with Messages',
          actions: [
            { type: 'QUICK_REPLY', title: 'Yes', id: 'yes' },
            { type: 'QUICK_REPLY', title: 'No', id: 'no' },
          ],
        },
      },
    });
    expect(result.mediaUrl).toBeNull();
    expect(result.buttons).toEqual([
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'QUICK_REPLY', text: 'No' },
    ]);
  });
});

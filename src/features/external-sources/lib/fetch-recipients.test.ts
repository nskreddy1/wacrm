import { describe, expect, it } from 'vitest';

import { fetchRecipients } from './fetch-recipients';

describe('fetchRecipients REST security', () => {
  it('rejects private and loopback endpoints before fetching them', async () => {
    await expect(
      fetchRecipients({
        type: 'rest',
        config: { url: 'http://127.0.0.1:4599/parents', authStyle: 'none' },
        fieldMap: { phone: 'phone' },
        secret: null,
      })
    ).rejects.toThrow('publicly reachable');
  });
});

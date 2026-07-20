import { describe, expect, it } from 'vitest';

import { getSourceSaveTarget } from './validate';

describe('getSourceSaveTarget', () => {
  it('creates a new source before it has a persisted id', () => {
    expect(getSourceSaveTarget(null)).toEqual({
      url: '/api/external-sources',
      method: 'POST',
    });
  });

  it('patches a source created by Test connection instead of duplicating it', () => {
    expect(getSourceSaveTarget('source-123')).toEqual({
      url: '/api/external-sources/source-123',
      method: 'PATCH',
    });
  });
});

// ============================================================
// ADR-005 F1 — the raw key must never reach the SWR cache map.
// ============================================================

import { describe, expect, it } from 'vitest';

import {
  draftModelsSwrKey,
  isListableDraftKey,
  keyFingerprint,
  MIN_DRAFT_KEY_LENGTH,
} from './model-list-key';

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz-7f3d';

describe('keyFingerprint', () => {
  it('is length:last4 and nothing else', () => {
    expect(keyFingerprint(KEY)).toBe(`${KEY.length}:7f3d`);
  });

  it('never contains the key body', () => {
    expect(keyFingerprint(KEY)).not.toContain('abcdefghij');
  });

  it('separates two keys that share their last 4 characters', () => {
    expect(keyFingerprint('sk-aaaa-7f3d')).not.toBe(keyFingerprint(KEY));
  });
});

describe('isListableDraftKey', () => {
  it('rejects a mid-paste draft', () => {
    expect(isListableDraftKey('sk-abc')).toBe(false);
    expect(isListableDraftKey('')).toBe(false);
    expect(isListableDraftKey(null)).toBe(false);
  });

  it('accepts a draft at the threshold', () => {
    expect(isListableDraftKey('x'.repeat(MIN_DRAFT_KEY_LENGTH))).toBe(true);
  });
});

describe('draftModelsSwrKey', () => {
  const base = {
    endpoint: '/api/ai/models',
    provider: 'openai',
    draftApiKey: KEY,
  };

  it('contains no part of the raw key', () => {
    const serialized = JSON.stringify(draftModelsSwrKey(base));
    expect(serialized).not.toContain(KEY);
    expect(serialized).not.toContain('abcdefghij');
    expect(serialized).toContain('7f3d');
  });

  it('changes when the key changes', () => {
    expect(draftModelsSwrKey(base)).not.toEqual(
      draftModelsSwrKey({ ...base, draftApiKey: 'sk-other-key-value-1234' })
    );
  });

  it('changes when the provider, base URL or target account changes', () => {
    const original = draftModelsSwrKey(base);
    expect(draftModelsSwrKey({ ...base, provider: 'gemini' })).not.toEqual(
      original
    );
    expect(
      draftModelsSwrKey({ ...base, baseUrl: 'http://localhost:11434/v1' })
    ).not.toEqual(original);
    expect(draftModelsSwrKey({ ...base, accountId: 'acc-9' })).not.toEqual(
      original
    );
  });

  it('is stable for the same inputs, so a re-render reuses the cache entry', () => {
    expect(draftModelsSwrKey(base)).toEqual(draftModelsSwrKey(base));
  });
});

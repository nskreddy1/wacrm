import { describe, expect, it } from 'vitest';

import { areAllSelected, toggleAll, toggleId } from './use-row-selection';

describe('toggleId', () => {
  it('adds an absent id without mutating the input', () => {
    const input = new Set(['a']);
    const next = toggleId(input, 'b');
    expect([...next].sort()).toEqual(['a', 'b']);
    expect(input.has('b')).toBe(false);
  });

  it('removes a present id', () => {
    expect(toggleId(new Set(['a', 'b']), 'a').has('a')).toBe(false);
  });
});

describe('toggleAll', () => {
  it('selects all when some are missing', () => {
    const next = toggleAll(new Set(['a']), ['a', 'b', 'c']);
    expect(next.size).toBe(3);
  });

  it('deselects all when every id is present, keeping unrelated selections', () => {
    const next = toggleAll(new Set(['a', 'b', 'x']), ['a', 'b']);
    expect([...next]).toEqual(['x']);
  });

  it('is a no-op for an empty id list', () => {
    expect([...toggleAll(new Set(['a']), [])]).toEqual(['a']);
  });
});

describe('areAllSelected', () => {
  it('is false for an empty id list', () => {
    // Guards the "select all" checkbox from reading as checked on an
    // empty/filtered-to-nothing list.
    expect(areAllSelected(new Set(['a']), [])).toBe(false);
  });

  it('is true only when every id is selected', () => {
    expect(areAllSelected(new Set(['a', 'b']), ['a', 'b'])).toBe(true);
    expect(areAllSelected(new Set(['a']), ['a', 'b'])).toBe(false);
  });
});

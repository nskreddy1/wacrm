import { describe, expect, it } from 'vitest';
import { nextCell } from './pipeline-data-sheet';

describe('sheet keyboard navigation', () => {
  it('moves across rows', () =>
    expect(nextCell(0, 5, 2)).toEqual({ row: 1, column: 0 }));
  it('moves backward across rows', () =>
    expect(nextCell(1, 0, 2, true)).toEqual({ row: 0, column: 5 }));
  it('stays inside the grid', () => {
    expect(nextCell(0, 0, 1, true)).toEqual({ row: 0, column: 0 });
    expect(nextCell(0, 5, 1)).toEqual({ row: 0, column: 5 });
  });
});

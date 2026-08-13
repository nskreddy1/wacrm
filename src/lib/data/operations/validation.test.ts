// ============================================================
// Characterization tests for the operations-domain schemas.
//
// These PIN existing behavior rather than change it (ADR-003 D2). The routes
// treat these schemas as the trust boundary — the repository layer assumes
// shape-valid input — so a silent loosening here becomes a data-integrity
// bug several layers away with no test to catch it.
// ============================================================

import { describe, expect, it } from 'vitest';

import {
  catalogItemCreateSchema,
  catalogItemUpdateSchema,
  idListSchema,
} from './validation';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('catalogItemCreateSchema', () => {
  it('applies price, currency and isActive defaults when omitted', () => {
    const parsed = catalogItemCreateSchema.parse({ name: 'Consultation' });
    expect(parsed.price).toBe(0);
    expect(parsed.currency).toBe('USD');
    expect(parsed.isActive).toBe(true);
  });

  it('trims the name and rejects one that is only whitespace', () => {
    expect(catalogItemCreateSchema.parse({ name: '  Setup  ' }).name).toBe(
      'Setup'
    );
    expect(catalogItemCreateSchema.safeParse({ name: '   ' }).success).toBe(
      false
    );
  });

  it('rejects a missing name', () => {
    expect(catalogItemCreateSchema.safeParse({}).success).toBe(false);
  });

  it('enforces the 160-character name bound', () => {
    expect(
      catalogItemCreateSchema.safeParse({ name: 'a'.repeat(160) }).success
    ).toBe(true);
    expect(
      catalogItemCreateSchema.safeParse({ name: 'a'.repeat(161) }).success
    ).toBe(false);
  });

  it('normalizes an empty optional string to null rather than keeping it', () => {
    // Guards the write path: '' and null mean different things in Postgres,
    // and the UI submits '' for a cleared field.
    const parsed = catalogItemCreateSchema.parse({
      name: 'Item',
      description: '',
      category: '   ',
    });
    expect(parsed.description).toBeNull();
    expect(parsed.category).toBeNull();
  });

  it('upper-cases the currency and requires exactly three characters', () => {
    expect(
      catalogItemCreateSchema.parse({ name: 'Item', currency: 'inr' }).currency
    ).toBe('INR');
    expect(
      catalogItemCreateSchema.safeParse({ name: 'Item', currency: 'RUPEE' })
        .success
    ).toBe(false);
  });

  it('rejects a negative price', () => {
    // The one bound with real money consequences.
    expect(
      catalogItemCreateSchema.safeParse({ name: 'Item', price: -1 }).success
    ).toBe(false);
  });

  it('rejects a price above the 999,999,999 ceiling', () => {
    expect(
      catalogItemCreateSchema.safeParse({ name: 'Item', price: 999_999_999 })
        .success
    ).toBe(true);
    expect(
      catalogItemCreateSchema.safeParse({ name: 'Item', price: 1_000_000_000 })
        .success
    ).toBe(false);
  });

  it('rejects a price sent as a string', () => {
    // JSON bodies make this the most likely malformed-input shape.
    expect(
      catalogItemCreateSchema.safeParse({ name: 'Item', price: '10' }).success
    ).toBe(false);
  });

  it('caps custom field values at ten keys', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`f${i}`, 'v'])
    );
    expect(
      catalogItemCreateSchema.safeParse({ name: 'Item', customValues: tooMany })
        .success
    ).toBe(false);
  });
});

describe('catalogItemUpdateSchema', () => {
  it('requires a uuid id', () => {
    expect(catalogItemUpdateSchema.safeParse({ name: 'Item' }).success).toBe(
      false
    );
    expect(
      catalogItemUpdateSchema.safeParse({ id: 'not-a-uuid' }).success
    ).toBe(false);
    expect(catalogItemUpdateSchema.safeParse({ id: UUID }).success).toBe(true);
  });

  it('allows a partial update without re-sending the name', () => {
    const parsed = catalogItemUpdateSchema.parse({ id: UUID, isActive: false });
    expect(parsed.isActive).toBe(false);
    // .partial() drops the defaults, so an omitted field stays undefined
    // instead of being silently reset to the create-time default.
    expect(parsed.price).toBeUndefined();
    expect(parsed.currency).toBeUndefined();
  });

  it('still enforces field bounds on the fields that are present', () => {
    expect(
      catalogItemUpdateSchema.safeParse({ id: UUID, price: -5 }).success
    ).toBe(false);
    expect(
      catalogItemUpdateSchema.safeParse({ id: UUID, name: '' }).success
    ).toBe(false);
  });
});

describe('idListSchema', () => {
  it('rejects an empty id list', () => {
    // Without .min(1) a bulk DELETE with no ids would be a silent no-op that
    // still reports success to the caller.
    expect(idListSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it('rejects non-uuid ids', () => {
    expect(idListSchema.safeParse({ ids: ['1'] }).success).toBe(false);
  });

  it('accepts up to 100 ids and rejects 101', () => {
    const ids = (n: number) => Array.from({ length: n }, () => UUID);
    expect(idListSchema.safeParse({ ids: ids(100) }).success).toBe(true);
    expect(idListSchema.safeParse({ ids: ids(101) }).success).toBe(false);
  });
});

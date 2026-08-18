// ============================================================
// Bulk contact import — duplicate handling contract.
//
// The import UI used to POST one contact per row, so every row that
// already existed came back as an HTTP 400: an 11-row file of known
// contacts produced 11 console errors, and a duplicate repeated *within*
// the same file failed the same way. Duplicates are now resolved before
// anything is written and reported as `skipped`, which is a different
// outcome from `errors` — that distinction is what these tests pin.
//
// Duplicate detection must use the digits-only shape of the phone number,
// matching the generated `contacts.phone_normalized` column behind the
// unique index `(account_id, phone_normalized)`. If it drifted, "+1 (415)
// 555-0123" and "14155550123" would look distinct here while colliding in
// the database — exactly the failure the batching was meant to remove.
// ============================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';

/** Phone numbers already stored for the account under test. */
let existingPhones: string[] = [];
/** Rows handed to the single-contact insert, in order. */
let inserted: Record<string, unknown>[] = [];
/** Next insert attempt fails with this, to simulate a mid-import race. */
let insertError: Error | null = null;
/** SQLSTATE for the simulated failure ('23505' = unique violation). */
let insertErrorCode: string | undefined;
let quota: { allowed: boolean; limit: number | null; used: number } = {
  allowed: true,
  limit: null,
  used: 0,
};

vi.mock('@/lib/quotas', () => ({
  canAddResource: async () => quota,
}));

/**
 * Minimal Supabase stub.
 *
 * The insert is stubbed at the *client* rather than by mocking
 * `createSupabaseContact`: `importSupabaseContacts` calls that function
 * directly within the same module, and a self-mock does not intercept
 * intra-module calls, so the real insert would run against this stub and
 * fail on a missing `.insert`. Stubbing the client keeps the whole real
 * code path — validation, dedupe, quota, insert — under test.
 */
const supabase = {
  from: (table: string) => {
    // After inserting, `createSupabaseContact` resolves custom-field
    // values. These rows carry no custom fields, so an empty definition
    // list is the correct answer and the write path short-circuits.
    // `saveCustomValues` awaits `.select(...).eq(...)` directly, so `eq`
    // must resolve to the result rather than return a further builder.
    if (table === 'custom_fields')
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      } as never;
    if (table !== 'contacts')
      throw new Error(`unexpected table in import path: ${table}`);
    return {
      // Existing-phone lookup.
      select: (columns: string) => {
        if (columns.includes('phone_normalized'))
          return {
            eq: () => ({
              neq: async () => ({
                data: existingPhones.map((phone) => ({
                  phone_normalized: phone,
                })),
                error: null,
              }),
            }),
          };
        throw new Error(`unexpected select: ${columns}`);
      },
      // Per-row insert.
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            // Postgres errors arrive as `{ code, message }`, not as an
            // Error instance — `createSupabaseContact` reads `error.code`
            // to detect a 23505 unique violation.
            if (insertError)
              return {
                data: null,
                error: {
                  code: insertErrorCode,
                  message: insertError.message,
                },
              };
            inserted.push(values);
            return {
              data: { id: `contact-${inserted.length}`, ...values },
              error: null,
            };
          },
        }),
      }),
    };
  },
};

const ctx = { supabase, accountId: 'account-1', userId: 'user-1' } as never;

async function runImport(
  rows: { row: number; values: Record<string, unknown> }[]
) {
  const { importSupabaseContacts } = await import('./supabase-repository');
  return importSupabaseContacts(ctx, rows as never);
}

function row(n: number, phone: string, name = `Person ${n}`) {
  return { row: n, values: { name, phone } };
}

beforeEach(() => {
  existingPhones = [];
  inserted = [];
  insertError = null;
  insertErrorCode = undefined;
  quota = { allowed: true, limit: null, used: 0 };
});

describe('bulk contact import', () => {
  it('imports clean rows', async () => {
    const result = await runImport([
      row(2, '+14155550001'),
      row(3, '+14155550002'),
    ]);
    expect(result.imported).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('skips a row already in the database instead of erroring', async () => {
    existingPhones = ['14155550001'];
    const result = await runImport([
      row(2, '+1 (415) 555-0001'), // same number, different formatting
      row(3, '+14155550002'),
    ]);
    // The pre-existing contact is a skip, not a failure.
    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].row).toBe(2);
    expect(result.skipped[0].reason).toMatch(/already exists/i);
    // Crucially, it was never written.
    expect(inserted).toHaveLength(1);
  });

  it('skips a duplicate repeated within the same file', async () => {
    // Same digits once punctuation is stripped, so these collide on the
    // unique index. Note the country code is part of the key: "+1 415…"
    // and "415…" are genuinely different contacts to the database, so the
    // formatting varied here without changing the digits.
    const result = await runImport([
      row(2, '+14155550001'),
      row(3, '+1 (415) 555-0001'),
    ]);
    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.skipped.map((s) => s.row)).toEqual([3]);
  });

  it('reports the spreadsheet row number for invalid rows', async () => {
    const result = await runImport([
      row(2, '+14155550001'),
      { row: 3, values: { name: '', phone: '' } }, // no usable identity
    ]);
    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
  });

  it('treats a mid-import duplicate race as a skip, not an error', async () => {
    // A concurrent import or inbound webhook can claim the number between
    // the existence check and the insert. That is expected, not a failure.
    // Driven through the real 23505 path so the test exercises the same
    // translation production does, rather than a message invented here.
    insertError = new Error('duplicate key value violates unique constraint');
    insertErrorCode = '23505';
    const result = await runImport([row(2, '+14155550001')]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('reports genuine insert failures as errors', async () => {
    insertError = new Error('connection terminated unexpectedly');
    const result = await runImport([row(2, '+14155550001')]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(2);
  });

  it('imports what fits when the plan limit is reached', async () => {
    // Partial success beats rejecting the whole file: the user learns
    // exactly which rows landed and which need a plan change.
    quota = { allowed: false, limit: 10, used: 9 };
    const result = await runImport([
      row(2, '+14155550001'),
      row(3, '+14155550002'),
      row(4, '+14155550003'),
    ]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0].reason).toMatch(/limit/i);
  });

  it('does not divide by a null limit on unlimited plans', async () => {
    // `limit: null` means unlimited, so this branch should not be reached;
    // if it ever is, it must degrade rather than throw on null arithmetic.
    quota = { allowed: false, limit: null, used: 5 };
    const result = await runImport([row(2, '+14155550001')]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('rejects a file larger than the row cap', async () => {
    const { CONTACT_IMPORT_MAX_ROWS } = await import('./supabase-repository');
    const tooMany = Array.from({ length: CONTACT_IMPORT_MAX_ROWS + 1 }, (_, i) =>
      row(i + 2, `+1415555${String(i).padStart(4, '0')}`)
    );
    await expect(runImport(tooMany)).rejects.toThrow(/limited to/i);
  });

  it('returns an empty result for an empty file without querying', async () => {
    const result = await runImport([]);
    expect(result).toEqual({ imported: 0, skipped: [], errors: [] });
  });

  it('imports contacts that have no phone number', async () => {
    // Email-only contacts must not all collide on an empty phone key.
    const result = await runImport([
      { row: 2, values: { name: 'A', email: 'a@example.com' } },
      { row: 3, values: { name: 'B', email: 'b@example.com' } },
    ]);
    expect(result.imported).toBe(2);
    expect(result.skipped).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildCrmContext } from './crm-context';

const ACCOUNT = 'acc-1';
const CONTACT = 'con-1';

interface QueryRecord {
  table: string;
  columns: string;
  filters: Record<string, unknown>;
}

/**
 * Chainable Supabase fake in the style of `knowledge.test.ts` — no mock
 * library. Every `.eq()/.gte()` is recorded so tests can assert the
 * account_id filter really reached the query builder, which is the
 * security-relevant part (callers pass a service-role client that
 * bypasses RLS).
 */
function makeDb(rows: Record<string, unknown[]>) {
  const queries: QueryRecord[] = [];

  function from(table: string) {
    return {
      select(columns: string) {
        const record: QueryRecord = { table, columns, filters: {} };
        queries.push(record);

        const builder = {
          eq(col: string, val: unknown) {
            record.filters[col] = val;
            return builder;
          },
          gte(col: string, val: unknown) {
            record.filters[`${col}__gte`] = val;
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return Promise.resolve({ data: rows[table] ?? [], error: null });
          },
          maybeSingle() {
            return Promise.resolve({
              data: (rows[table] ?? [])[0] ?? null,
              error: null,
            });
          },
          // Awaited directly when neither limit() nor maybeSingle() ends
          // the chain.
          then(resolve: (v: unknown) => unknown) {
            return Promise.resolve({
              data: rows[table] ?? [],
              error: null,
            }).then(resolve);
          },
        };
        return builder;
      },
    };
  }

  return { db: { from } as unknown as SupabaseClient, queries };
}

const contactRow = { name: 'Aisha Khan', company: 'Northwind' };

describe('buildCrmContext', () => {
  it('returns null when the contact has no CRM footprint', async () => {
    const { db } = makeDb({});
    expect(await buildCrmContext(db, ACCOUNT, CONTACT)).toBeNull();
  });

  it('scopes every table to the account, not just the contact', async () => {
    const { db, queries } = makeDb({ contacts: [contactRow] });
    await buildCrmContext(db, ACCOUNT, CONTACT);

    // catalog_items is account-wide rather than contact-scoped, so a
    // missing account filter would leak another tenant's price list.
    for (const table of [
      'contacts',
      'deals',
      'appointments',
      'catalog_items',
    ]) {
      const query = queries.find((q) => q.table === table);
      expect(query, `${table} was not queried`).toBeDefined();
      expect(query?.filters.account_id, `${table} missing account scope`).toBe(
        ACCOUNT
      );
    }
  });

  it('includes upcoming appointments with their catalog subject', async () => {
    const { db } = makeDb({
      contacts: [contactRow],
      appointments: [
        {
          title: 'Onboarding call',
          starts_at: '2026-09-01T10:00:00.000Z',
          ends_at: null,
          location: 'Zoom',
          status: 'scheduled',
          catalog_items: { name: 'Starter Program' },
        },
      ],
    });

    const out = await buildCrmContext(db, ACCOUNT, CONTACT, 'UTC');
    expect(out).toContain('Their upcoming appointments:');
    expect(out).toContain('Onboarding call');
    expect(out).toContain('about: Starter Program');
    expect(out).toContain('location: Zoom');
  });

  it('only asks for scheduled, future appointments', async () => {
    const { db, queries } = makeDb({ contacts: [contactRow] });
    await buildCrmContext(db, ACCOUNT, CONTACT);

    const appointments = queries.find((q) => q.table === 'appointments');
    expect(appointments?.filters.status).toBe('scheduled');
    expect(appointments?.filters.starts_at__gte).toBeTruthy();
  });

  it('never selects internal appointment notes', async () => {
    const { db, queries } = makeDb({ contacts: [contactRow] });
    await buildCrmContext(db, ACCOUNT, CONTACT);

    const appointments = queries.find((q) => q.table === 'appointments');
    expect(appointments?.columns).not.toContain('notes');
  });

  it('lists only active catalog items as the authoritative price list', async () => {
    const { db, queries } = makeDb({
      contacts: [contactRow],
      catalog_items: [
        {
          name: 'Starter Program',
          category: 'Programs',
          price: 4999,
          currency: 'INR',
        },
      ],
    });

    const out = await buildCrmContext(db, ACCOUNT, CONTACT);
    expect(
      queries.find((q) => q.table === 'catalog_items')?.filters.is_active
    ).toBe(true);
    expect(out).toContain('authoritative price list');
    expect(out).toContain('INR 4,999');
  });

  it('renders appointment times in the account timezone', async () => {
    const rows = {
      contacts: [contactRow],
      appointments: [
        {
          title: 'Site visit',
          starts_at: '2026-09-01T10:00:00.000Z',
          ends_at: null,
          location: null,
          status: 'scheduled',
          catalog_items: null,
        },
      ],
    };

    const utc = await buildCrmContext(makeDb(rows).db, ACCOUNT, CONTACT, 'UTC');
    const kolkata = await buildCrmContext(
      makeDb(rows).db,
      ACCOUNT,
      CONTACT,
      'Asia/Kolkata'
    );

    // 10:00 UTC is 15:30 IST — the same instant must not render alike.
    expect(utc).toContain('10:00');
    expect(kolkata).toContain('15:30');
    expect(utc).not.toEqual(kolkata);
  });

  it('falls back to UTC for an unknown timezone instead of throwing', async () => {
    const { db } = makeDb({
      contacts: [contactRow],
      appointments: [
        {
          title: 'Site visit',
          starts_at: '2026-09-01T10:00:00.000Z',
          ends_at: null,
          location: null,
          status: 'scheduled',
          catalog_items: null,
        },
      ],
    });

    const out = await buildCrmContext(db, ACCOUNT, CONTACT, 'Mars/Olympus');
    expect(out).toContain('Site visit');
    expect(out).toContain('UTC');
  });

  it('degrades to null when the database throws', async () => {
    const db = {
      from: () => {
        throw new Error('connection reset');
      },
    } as unknown as SupabaseClient;

    expect(await buildCrmContext(db, ACCOUNT, CONTACT)).toBeNull();
  });
});

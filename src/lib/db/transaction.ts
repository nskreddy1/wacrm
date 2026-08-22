/**
 * src/lib/db/transaction.ts
 *
 * The explicit Unit-of-Work boundary (plan addendum §B). Multi-statement
 * mutations that must commit or roll back together go through
 * `withTransaction`; everything else uses the plain `sql` tag.
 *
 * The callback receives a transaction-scoped tagged-template function with
 * the same parameterized-only contract as src/lib/db/sql.ts.
 */
import { db } from './client';

export type TransactionSql = <T = unknown>(
  strings: TemplateStringsArray,
  ...params: unknown[]
) => Promise<T[]>;

export async function withTransaction<R>(
  fn: (tx: TransactionSql) => Promise<R>
): Promise<R> {
  const result = await db().begin(async (t) => {
    const tx: TransactionSql = async (strings, ...params) =>
      (await t(strings, ...(params as never[]))) as never;
    return fn(tx);
  });
  return result as R;
}

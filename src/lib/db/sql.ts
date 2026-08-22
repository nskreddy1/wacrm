/**
 * src/lib/db/sql.ts
 *
 * Parameterized-only tagged-template execution. Repositories import this,
 * never `postgres` directly (ARCH-005 / ADR-002 §3.1).
 *
 * NO logging/timing here — observability wraps the adapter from the outside
 * (src/lib/observability/instrument.ts, Decorator pattern), keeping this
 * layer's job singular (plan addendum §B, review §4).
 *
 * The tagged-template signature makes string-concatenated SQL a type error,
 * which is the injection defense: values always travel as bind parameters.
 */
import { db } from './client';

export async function sql<T = unknown>(
  strings: TemplateStringsArray,
  ...params: unknown[]
): Promise<T[]> {
  return (await db()(strings, ...(params as never[]))) as unknown as T[];
}

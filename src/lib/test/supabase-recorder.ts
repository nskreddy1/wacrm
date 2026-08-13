/**
 * A recording Supabase test double.
 *
 * Account scoping is the core security boundary of this product: every query
 * that touches tenant data must filter by `account_id`. RLS enforces that in
 * the database, but a tool or repository that forgets the filter still leaks
 * or writes across workspaces whenever it runs with the service-role key.
 *
 * Unit tests cannot see the SQL, so this double records what the code *asked*
 * for — table, operation, filters and payload — and lets a test assert that
 * the account filter was applied. It is deliberately dumb: it performs no
 * matching or filtering, it only remembers.
 *
 * Shared here (rather than mocked inline in one test file) so every future
 * data-layer or assistant-tool test asserts scoping the same way.
 *
 * Usage:
 *
 *   const db = createSupabaseRecorder([{ data: { id: 'x' }, error: null }]);
 *   await buildAssistantTools({ supabase: db.client, accountId: 'a', userId: 'u' })
 *     .list_catalog_items.execute({ limit: 5 });
 *   expect(db.queries[0].filters).toContainEqual(['account_id', 'a']);
 */

export type RecordedOperation = 'select' | 'insert' | 'update' | 'delete';

export interface RecordedQuery {
  /** Table passed to `.from()`. */
  table: string;
  /** Which verb the chain used. Defaults to 'select' until one is called. */
  operation: RecordedOperation;
  /** Columns string handed to `.select()`, when present. */
  columns?: string;
  /** Every filter applied, in call order, as [method, column, value]. */
  filters: Array<[string, string, unknown]>;
  /** Row(s) handed to `.insert()` / `.update()`. */
  payload?: unknown;
}

export interface SupabaseResult {
  data: unknown;
  error: unknown;
}

const FILTER_METHODS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'is',
  'in',
  'contains',
  'not',
]);

/** Chain methods that only shape the response and carry no assertions. */
const PASSTHROUGH_METHODS = new Set([
  'order',
  'limit',
  'range',
  'or',
  'filter',
  'abortSignal',
  'throwOnError',
  'overrideTypes',
]);

/**
 * @param results Results handed out in order, one per awaited chain. A chain
 *   awaited after the list is exhausted resolves to `{ data: null, error: null }`,
 *   which is what a "not found" lookup looks like.
 */
export function createSupabaseRecorder(results: SupabaseResult[] = []) {
  const queries: RecordedQuery[] = [];
  let cursor = 0;

  function nextResult(): SupabaseResult {
    return results[cursor++] ?? { data: null, error: null };
  }

  function buildChain(record: RecordedQuery) {
    // Every method returns the same chain object, mirroring PostgREST's
    // builder. `then` makes it awaitable at any point in the chain.
    const chain: Record<string, unknown> = {
      then(
        onFulfilled?: (value: SupabaseResult) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        return Promise.resolve(nextResult()).then(onFulfilled, onRejected);
      },
    };

    const add = (name: string, fn: (...args: never[]) => unknown) => {
      chain[name] = fn;
    };

    add('select', (columns?: string) => {
      if (typeof columns === 'string') record.columns = columns;
      return chain;
    });

    for (const verb of ['insert', 'update', 'upsert'] as const) {
      add(verb, (payload: unknown) => {
        record.operation = verb === 'upsert' ? 'insert' : verb;
        record.payload = payload;
        return chain;
      });
    }

    add('delete', () => {
      record.operation = 'delete';
      return chain;
    });

    for (const method of FILTER_METHODS) {
      add(method, (column: string, value: unknown) => {
        record.filters.push([method, column, value]);
        return chain;
      });
    }

    for (const method of PASSTHROUGH_METHODS) {
      add(method, () => chain);
    }

    // Terminal single-row helpers resolve immediately.
    for (const method of ['single', 'maybeSingle', 'csv'] as const) {
      add(method, () => Promise.resolve(nextResult()));
    }

    return chain;
  }

  const client = {
    from(table: string) {
      const record: RecordedQuery = {
        table,
        operation: 'select',
        filters: [],
      };
      queries.push(record);
      return buildChain(record);
    },
  };

  return {
    /** Cast at the call site: the double implements only what tests exercise. */
    client: client as never,
    /** Recorded chains, in the order `.from()` was called. */
    queries,
    /** Convenience: the `eq` filters of a recorded chain as [column, value]. */
    eqFilters(index: number): Array<[string, unknown]> {
      return (queries[index]?.filters ?? [])
        .filter(([method]) => method === 'eq')
        .map(([, column, value]) => [column, value]);
    },
    reset() {
      queries.length = 0;
      cursor = 0;
    },
  };
}

/**
 * Instrumentation decorators (plan Task 6 Step 4, addendum §B —
 * Decorator pattern). Observability wraps operations; it is never
 * inlined into business logic.
 *
 *   withObservability(name, handler) — route-handler wrapper: creates a
 *     correlation from the request, times the handler, logs one line per
 *     request, captures unhandled errors, and echoes x-request-id.
 *
 *   instrument(name, fn) — wraps any async unit of work with timing +
 *     error capture, inheriting the ambient correlation.
 *
 * Slow-query logging (>500 ms) lives here as `timedQuery` — a wrapper
 * feature code can apply around specific hot queries; it deliberately
 * does NOT monkey-patch the sql template tag.
 */
import { captureError } from './errors';
import { logger } from './logger';
import { newCorrelation, runWithCorrelation } from './correlation';

const SLOW_QUERY_MS = 500;

type RouteHandler = (
  req: Request,
  ctx?: unknown
) => Promise<Response> | Response;

/** Wrap a Next.js route handler with correlation + logging + capture. */
export function withObservability(
  operation: string,
  handler: RouteHandler
): RouteHandler {
  return async (req, ctx) => {
    const url = new URL(req.url);
    const correlation = newCorrelation({
      request_id: req.headers.get('x-request-id') ?? undefined,
      operation,
      route: url.pathname,
    });
    return runWithCorrelation(correlation, async () => {
      const start = performance.now();
      try {
        const res = await handler(req, ctx);
        const ms = Math.round(performance.now() - start);
        logger.info(
          { operation, route: url.pathname, status: res.status, ms },
          `${operation} ${res.status} in ${ms}ms`
        );
        const headers = new Headers(res.headers);
        headers.set('x-request-id', correlation.request_id);
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      } catch (err) {
        captureError(err, { operation, route: url.pathname });
        return Response.json(
          { error: 'Internal error', request_id: correlation.request_id },
          { status: 500, headers: { 'x-request-id': correlation.request_id } }
        );
      }
    });
  };
}

/** Time + error-capture any async unit of work under the ambient correlation. */
export async function instrument<T>(
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } catch (err) {
    captureError(err, { operation });
    throw err;
  } finally {
    const ms = Math.round(performance.now() - start);
    if (ms > SLOW_QUERY_MS) {
      logger.warn({ operation, ms }, `${operation} slow: ${ms}ms`);
    }
  }
}

/** Slow-query wrapper for hot DB paths (>500 ms warns with query name). */
export async function timedQuery<T>(
  queryName: string,
  fn: () => Promise<T>
): Promise<T> {
  return instrument(`db.${queryName}`, fn);
}

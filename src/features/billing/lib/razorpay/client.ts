/**
 * Razorpay HTTP client — `fetch` only, no SDK.
 *
 * WHY NO SDK
 * The official Node SDK assumes a long-lived Node process: it bundles a
 * Node HTTP agent and its own retry behaviour. This app runs on
 * Cloudflare Workers (ADR-INFRA-001), where an unbounded subrequest is
 * a hung isolate rather than a slow request, and where a vendor's
 * retry-on-POST is *unsafe* for an endpoint with no idempotency
 * guarantee (5.3a) — a silent retry can create a second subscription
 * for one customer. So the transport is explicit, bounded, and
 * retry-free by construction.
 *
 * WHAT THIS FILE IS NOT ALLOWED TO DO
 * - It never decides business meaning. Status translation lives in the
 *   adapter (the anti-corruption layer, D1).
 * - It never retries a POST. An ambiguous create is resolved by
 *   *reading state back* (`fetchSubscription`), never by sending again.
 * - It never logs a credential, a URL with credentials, or a response
 *   body. Bodies carry customer identifiers (F7).
 */

/** Razorpay API base. Version-pinned: `v1` is part of the contract. */
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

/**
 * Per-request timeout.
 *
 * Bounded well below the platform's own limit so a hung provider call
 * surfaces as our own typed error — which the caller can reconcile —
 * rather than as an isolate the runtime kills, which leaves a
 * possibly-created subscription with nothing recorded locally.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export interface RazorpayCredentials {
  readonly keyId: string;
  readonly keySecret: string;
}

/**
 * A failed provider call, carrying enough to decide whether to
 * reconcile — and nothing more.
 *
 * `ambiguous` is the field that matters. A timeout or a `5xx` on a
 * create means the subscription MAY exist at the provider; treating
 * that as a plain failure is how a customer gets charged for a
 * subscription we never recorded.
 */
export class RazorpayApiError extends Error {
  readonly status: number;
  readonly providerCode?: string;
  readonly ambiguous: boolean;

  constructor(
    message: string,
    options: { status: number; providerCode?: string; ambiguous: boolean }
  ) {
    super(message);
    this.name = 'RazorpayApiError';
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.ambiguous = options.ambiguous;
  }
}

/** `status: 0` marks "never got an answer" — distinct from any HTTP status. */
const NO_HTTP_STATUS = 0;

function basicAuthHeader({ keyId, keySecret }: RazorpayCredentials): string {
  // `Buffer` is available under nodejs_compat; matches the rest of the repo.
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

/**
 * Pull the provider's error description out of a failed response.
 *
 * Best-effort and defensive: an error body is exactly where a provider
 * is least likely to honour its documented schema.
 */
function describeError(payload: unknown): { code?: string; description?: string } {
  if (typeof payload !== 'object' || payload === null) return {};
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return {};
  const { code, description } = error as { code?: unknown; description?: unknown };
  return {
    code: typeof code === 'string' ? code : undefined,
    description: typeof description === 'string' ? description : undefined,
  };
}

export class RazorpayClient {
  private readonly credentials: RazorpayCredentials;

  constructor(credentials: RazorpayCredentials) {
    this.credentials = credentials;
  }

  /**
   * Issue one bounded request. No retries, ever.
   *
   * @param method HTTP method.
   * @param path Path under the pinned API base, e.g. `/subscriptions`.
   * @param body Optional JSON body — a CLOSED literal from the adapter.
   */
  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Readonly<Record<string, unknown>>
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
        method,
        headers: {
          authorization: basicAuthHeader(this.credentials),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Bounded by construction. A hung provider must not become a
        // hung isolate.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      // Timeout or transport failure. For a POST this is the dangerous
      // case: the request may well have been processed. `ambiguous` is
      // what tells the caller to reconcile instead of retrying.
      throw new RazorpayApiError(
        `Razorpay request failed before a response was received (${method} ${path})`,
        {
          status: NO_HTTP_STATUS,
          ambiguous: method === 'POST',
          providerCode:
            cause instanceof Error && cause.name === 'TimeoutError'
              ? 'timeout'
              : undefined,
        }
      );
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const { code, description } = describeError(payload);
      throw new RazorpayApiError(
        // The provider's description is included because these are
        // operator-facing 400s (a mis-seeded plan ref, a bad amount) and
        // hiding them turns a five-minute fix into a debugging session.
        // It is a schema complaint about OUR request, not customer data.
        `Razorpay ${method} ${path} failed with ${response.status}` +
          (description ? `: ${description}` : ''),
        {
          status: response.status,
          providerCode: code,
          // A 5xx or 429 leaves the outcome genuinely unknown; a 4xx is
          // a definitive rejection, so nothing was created.
          ambiguous:
            method === 'POST' && (response.status >= 500 || response.status === 429),
        }
      );
    }

    return payload as T;
  }
}

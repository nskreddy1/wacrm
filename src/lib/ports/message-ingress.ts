/**
 * MessageIngress port — the async-ready ingestion seam (plan addendum
 * §C, scale ladder §F stage 3).
 *
 * Today the webhook route processes inbound messages inline
 * (`SynchronousMessageIngress`). When measured load demands it, this
 * port is implemented by a `QueuedMessageIngress` (e.g. Cloudflare
 * Queues) with ZERO call-site changes — that swap is what makes
 * "millions of concurrent users" a config change instead of a rewrite.
 *
 * Dependency Rule (addendum §A): this file is a port. It MUST NOT
 * import Next.js, @supabase/*, Redis, or any vendor SDK. Adapters
 * (the dedupe store, the processor) are injected by the caller.
 *
 * Precedence contract: Flows → Automations → AI auto-reply lives
 * INSIDE the injected processor (the existing pipeline, verbatim) and
 * MUST NOT move into ingress implementations.
 */

/** A channel-agnostic inbound event. `payload` is opaque to the port —
 *  only the injected processor knows its real shape. */
export interface InboundMessage<TPayload = unknown> {
  /** Provider-unique event id (WhatsApp: wamid). The idempotency key. */
  eventId: string;
  /** Owning tenant — every downstream row is scoped to this. */
  accountId: string;
  /** Channel discriminator ('whatsapp' today; email later). */
  channel: string;
  payload: TPayload;
}

export type Ack =
  /** First delivery — the pipeline ran (or was durably enqueued). */
  | { status: 'accepted' }
  /** Redelivery of an already-processed event — skipped (NFR-008). */
  | { status: 'duplicate' };

export interface MessageIngress<TPayload = unknown> {
  accept(event: InboundMessage<TPayload>): Promise<Ack>;
}

/**
 * Exactly-once claim on an event id. Implemented by the webhook route
 * over `webhook_events` (INSERT ... ON CONFLICT DO NOTHING).
 *
 * Contract: MUST fail OPEN (return true) on backend errors — a rare
 * duplicate reply is recoverable; a silently dropped customer message
 * is not.
 */
export interface IngressDedupeStore {
  /** true = first claim (process it), false = already processed. */
  claim(eventId: string, accountId: string): Promise<boolean>;
}

export type InboundProcessor<TPayload> = (
  event: InboundMessage<TPayload>
) => Promise<void>;

/**
 * Stage-1 implementation: dedupe, then run the existing pipeline
 * inline. Zero behavior change versus calling the pipeline directly —
 * the seam itself is the deliverable.
 */
export class SynchronousMessageIngress<TPayload>
  implements MessageIngress<TPayload>
{
  constructor(
    private readonly dedupe: IngressDedupeStore,
    private readonly process: InboundProcessor<TPayload>
  ) {}

  async accept(event: InboundMessage<TPayload>): Promise<Ack> {
    const firstDelivery = await this.dedupe.claim(
      event.eventId,
      event.accountId
    );
    if (!firstDelivery) return { status: 'duplicate' };
    await this.process(event);
    return { status: 'accepted' };
  }
}

/**
 * Langfuse AI tracing adapter (plan Task 6 Step 5, ADR-INFRA-001 §6).
 *
 * Env-gated no-op: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY absent →
 * every function here is a no-op costing nothing. Present → traces go
 * to Langfuse's public ingestion API (Hobby free tier: 50k units/mo)
 * via fire-and-forget fetch — the AI request path NEVER waits on
 * tracing delivery (NFR-003).
 *
 * PII POLICY (review §9, recorded here as the enforcement point):
 * prompts and completions are BYOK customer data. We send ONLY
 * metadata — model, latency, token counts, operation, correlation ids.
 * Message text NEVER leaves this adapter's redaction boundary. Anyone
 * changing that must update ADR-INFRA-001 first.
 *
 * `withAITracing` is the Decorator (addendum §B rule 2): it wraps an
 * AIProvider port implementation; tracing is never inlined into
 * generation business code.
 */
import type {
  AIProvider,
  GenerateReplyInput,
  GenerateReplyResult,
} from '@/lib/ports/ai-provider';
import { currentCorrelation } from './correlation';

type TraceEvent = {
  model: string;
  operation: string;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  ok: boolean;
};

function isEnabled(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY
  );
}

function ingest(event: TraceEvent): void {
  if (!isEnabled()) return;
  const base = (
    process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com'
  ).replace(/\/$/, '');
  const correlation = currentCorrelation();
  const now = new Date().toISOString();
  const traceId = correlation?.trace_id ?? crypto.randomUUID();
  const auth = btoa(
    `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`
  );
  // Fire-and-forget (NFR-003); failures are silently dropped — tracing
  // is best-effort telemetry, never a dependency of the AI reply path.
  void fetch(`${base}/api/public/ingestion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      batch: [
        {
          id: crypto.randomUUID(),
          type: 'trace-create',
          timestamp: now,
          body: {
            id: traceId,
            name: event.operation,
            // METADATA ONLY — no prompt/completion text (PII policy above).
            metadata: {
              request_id: correlation?.request_id,
              account_id: correlation?.account_id,
              release: process.env.RELEASE_VERSION ?? 'dev',
              model: event.model,
              latency_ms: event.latency_ms,
              ok: event.ok,
            },
          },
        },
        {
          id: crypto.randomUUID(),
          type: 'generation-create',
          timestamp: now,
          body: {
            id: crypto.randomUUID(),
            traceId,
            name: event.operation,
            model: event.model,
            usage: {
              input: event.input_tokens,
              output: event.output_tokens,
            },
          },
        },
      ],
    }),
  }).catch(() => {});
}

/** Decorator: wrap an AIProvider with metadata-only Langfuse tracing. */
export function withAITracing(
  provider: AIProvider,
  operation = 'ai.generate_reply'
): AIProvider {
  if (!isEnabled()) return provider; // zero overhead when unconfigured
  return {
    async generateReply(
      input: GenerateReplyInput
    ): Promise<GenerateReplyResult> {
      const start = performance.now();
      try {
        const result = await provider.generateReply(input);
        ingest({
          model: input.model,
          operation,
          latency_ms: Math.round(performance.now() - start),
          input_tokens: result.usage?.inputTokens,
          output_tokens: result.usage?.outputTokens,
          ok: true,
        });
        return result;
      } catch (err) {
        ingest({
          model: input.model,
          operation,
          latency_ms: Math.round(performance.now() - start),
          ok: false,
        });
        throw err;
      }
    },
  };
}

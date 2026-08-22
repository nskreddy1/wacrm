/**
 * Structured logger (plan Task 6 Step 2, ADR-INFRA-001 §6, NFR-003).
 *
 * pino in cross-runtime ("browser object") mode so the SAME logger works
 * in Node dev, Vitest, and Cloudflare Workers — no sonic-boom streams,
 * no worker-thread transports (both break on Workers isolates).
 *
 * Transport:
 *   LOKI_URL + LOKI_TOKEN set → fire-and-forget HTTP push to Grafana
 *     Cloud Loki (free tier: 50 GB, 14-day retention). Push failures are
 *     swallowed after one console warning per process — NO request path
 *     ever depends on synchronous observability delivery (NFR-003).
 *   Otherwise → structured JSON to the console (Workers observability
 *     tail / local dev output).
 *
 * Redaction: tokens, secrets, phone numbers, and emails are stripped
 * BEFORE anything leaves the process. Redaction is allow-listed by key
 * name — new secret-shaped keys must be added here, not worked around.
 *
 * Feature code imports { logger } (or child(correlation)) from this
 * module — never pino directly (ARCH-004).
 */
import pino from 'pino';
import { currentCorrelation } from './correlation';

const REDACT_KEYS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'apikey',
  'api_key',
  'secret',
  'password',
  'signature',
  'x-hub-signature-256',
  'phone',
  'phone_number',
  'wa_id',
  'email',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase())
      ? '[REDACTED]'
      : redact(v, depth + 1);
  }
  return out;
}

// ---------------------------------------------------------------------
// Loki push — fire-and-forget, batched per call, never awaited by callers.
// ---------------------------------------------------------------------
let lokiWarned = false;

function pushToLoki(entry: Record<string, unknown>) {
  const url = process.env.LOKI_URL;
  const token = process.env.LOKI_TOKEN;
  if (!url || !token) return;
  const body = JSON.stringify({
    streams: [
      {
        stream: {
          app: 'auxelon',
          env: process.env.RELEASE_VERSION ? 'production' : 'development',
          level: String(entry.level ?? 'info'),
        },
        values: [[`${Date.now()}000000`, JSON.stringify(entry)]],
      },
    ],
  });
  // Deliberately NOT awaited (NFR-003).
  void fetch(`${url.replace(/\/$/, '')}/loki/api/v1/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
  }).catch(() => {
    if (!lokiWarned) {
      lokiWarned = true;
      console.warn('[observability] Loki push failing; logs continue to console only');
    }
  });
}

const LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  browser: {
    asObject: true,
    write: (o) => {
      const raw = o as Record<string, unknown>;
      const entry = {
        ...(redact(raw) as Record<string, unknown>),
        level: LEVEL_LABELS[Number(raw.level)] ?? raw.level,
        ...currentCorrelation(),
      };
      // Console is the always-on sink (Workers tail / dev terminal).
      console.log(JSON.stringify(entry));
      pushToLoki(entry);
    },
  },
});

/** Child logger bound to explicit context (e.g. a webhook event). */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(redact(bindings) as Record<string, unknown>);
}

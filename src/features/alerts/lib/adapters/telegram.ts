import { decrypt } from '@/features/whatsapp/lib/encryption';
import type {
  AlertAdapter,
  AlertDestination,
  AlertPayload,
  AlertSendResult,
} from '../types';

/**
 * Telegram alert adapter (Bot API `sendMessage`).
 *
 * Connection model: the admin creates a bot with @BotFather, adds it to
 * the team's group, and pastes the bot token. There is no OAuth for
 * Telegram bots — a token is the only mechanism the platform offers, so
 * unlike Slack this one is necessarily paste-based. The token is stored
 * AES-256-GCM encrypted (same envelope as WhatsApp credentials) and is
 * only ever decrypted here, inside the cron process.
 *
 * Error classification matters more than it looks: Telegram returns HTTP
 * 400 for both "your text was malformed" (permanent) and "chat not
 * found" (permanent), but 429 for flood limits (retryable) and 5xx for
 * its own outages (retryable). Misclassifying a permanent error as
 * retryable means we hammer the API for 31 minutes and then dead-letter
 * anyway; misclassifying a transient one as permanent means the team
 * silently stops getting alerts. Both are bad, so the mapping below is
 * explicit rather than a catch-all.
 */

export interface TelegramDestinationConfig {
  /** Numeric chat id (negative for groups) or an @channel username. */
  chat_id: string;
  /** Cosmetic only, shown in settings. */
  chat_title?: string;
}

interface TelegramResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/** Telegram hard-caps a message at 4096 UTF-16 code units. */
const MAX_MESSAGE_LEN = 4096;

function escapeHtml(value: string): string {
  // Telegram's HTML parse_mode only needs these three escaped.
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMessage(payload: AlertPayload): string {
  const parts = [
    `<b>${escapeHtml(payload.title)}</b>`,
    escapeHtml(payload.body),
  ];
  if (payload.url) {
    parts.push(`<a href="${escapeHtml(payload.url)}">Open conversation</a>`);
  }
  const text = parts.join('\n\n');
  return text.length > MAX_MESSAGE_LEN
    ? `${text.slice(0, MAX_MESSAGE_LEN - 1)}…`
    : text;
}

/**
 * Permanent conditions — retrying cannot fix these, so dead-letter
 * immediately and surface the reason to the admin.
 */
function isPermanent(status: number, description: string): boolean {
  const d = description.toLowerCase();
  return (
    status === 401 || // token revoked or wrong
    status === 403 || // bot blocked / kicked from the group
    status === 404 || // token malformed -> endpoint doesn't resolve
    d.includes('chat not found') ||
    d.includes('bot was blocked') ||
    d.includes('bot was kicked') ||
    d.includes('user is deactivated') ||
    d.includes('not enough rights') ||
    d.includes('chat_id is empty')
  );
}

export const telegramAlertAdapter: AlertAdapter = {
  provider: 'telegram',

  async send(
    destination: AlertDestination,
    payload: AlertPayload
  ): Promise<AlertSendResult> {
    const config = destination.config as unknown as TelegramDestinationConfig;
    const chatId = config?.chat_id?.trim();

    if (!chatId) {
      return { ok: false, retryable: false, error: 'No chat configured' };
    }
    if (!destination.credentials_encrypted) {
      return {
        ok: false,
        retryable: false,
        error: 'Telegram bot token missing — reconnect the destination',
      };
    }

    let token: string;
    try {
      token = decrypt(destination.credentials_encrypted);
    } catch {
      // Undecryptable ciphertext (rotated ENCRYPTION_KEY, corrupt row):
      // never retryable, and we must not echo any cipher detail.
      return {
        ok: false,
        retryable: false,
        error: 'Stored Telegram token could not be decrypted — reconnect',
      };
    }

    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: formatMessage(payload),
          parse_mode: 'HTML',
          // Keep the alert compact: no giant link unfurl in the group.
          disable_web_page_preview: true,
        }),
        // Bounded: a hung socket must not hold a cron worker open and
        // stall every other delivery in this tick.
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Network error or timeout — the classic transient case.
      return { ok: false, retryable: true, error: 'Could not reach Telegram' };
    }

    let data: TelegramResponse | null = null;
    try {
      data = (await res.json()) as TelegramResponse;
    } catch {
      // Non-JSON body (proxy error page). Trust the status code instead.
      data = null;
    }

    if (res.ok && data?.ok) return { ok: true };

    const description = data?.description ?? `HTTP ${res.status}`;

    // Flood control. Telegram tells us how long to wait; our fixed
    // backoff ladder is coarser but always >= 60s, so honouring the
    // status alone is sufficient and we simply retry.
    if (res.status === 429) {
      return {
        ok: false,
        retryable: true,
        error: `Rate limited by Telegram${
          data?.parameters?.retry_after
            ? ` (retry after ${data.parameters.retry_after}s)`
            : ''
        }`,
      };
    }

    if (isPermanent(res.status, description)) {
      return { ok: false, retryable: false, error: description };
    }

    // Everything else (5xx, unexpected 400s) — assume transient. The
    // MAX_ATTEMPTS ceiling guarantees this still terminates.
    return { ok: false, retryable: true, error: description };
  },
};

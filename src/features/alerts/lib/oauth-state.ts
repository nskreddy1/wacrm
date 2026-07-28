import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed, self-expiring OAuth `state` parameter (CSRF protection).
 *
 * Stateless by design: the state carries its own payload + HMAC instead of
 * a server-side session row, so it needs no storage, no cleanup job, and
 * works across serverless instances — any node can verify a state minted
 * by any other. That is what keeps the OAuth flow horizontally scalable.
 *
 * Key is derived from ENCRYPTION_KEY (already required for credential
 * encryption) via HMAC with a domain-separation label, so a leak of one
 * derived key never compromises the other use.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes: OAuth dance, not a session.

interface OAuthStatePayload {
  accountId: string;
  userId: string;
  provider: string;
  exp: number;
}

function stateKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is required for OAuth state signing');
  }
  return createHmac('sha256', raw).update('alerts-oauth-state-v1').digest();
}

function sign(data: string): string {
  return createHmac('sha256', stateKey()).update(data).digest('base64url');
}

export function createOAuthState(input: {
  accountId: string;
  userId: string;
  provider: string;
}): string {
  const payload: OAuthStatePayload = {
    accountId: input.accountId,
    userId: input.userId,
    provider: input.provider,
    exp: Date.now() + STATE_TTL_MS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data)}`;
}

export function verifyOAuthState(
  state: string,
  expectedProvider: string
): OAuthStatePayload | null {
  const dot = state.lastIndexOf('.');
  if (dot <= 0) return null;
  const data = state.slice(0, dot);
  const mac = state.slice(dot + 1);

  const expected = sign(data);
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (
    macBuf.length !== expectedBuf.length ||
    !timingSafeEqual(macBuf, expectedBuf)
  ) {
    return null;
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof payload.accountId !== 'string' ||
    typeof payload.userId !== 'string' ||
    payload.provider !== expectedProvider ||
    typeof payload.exp !== 'number' ||
    payload.exp < Date.now()
  ) {
    return null;
  }
  return payload;
}

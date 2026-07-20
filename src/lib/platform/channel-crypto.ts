// ============================================================
// Channel credential encryption — server-only AES-256-GCM.
//
// Provider secrets (Twilio auth tokens, WhatsApp API keys, …) are
// encrypted BEFORE they leave the Node process and stored in the
// `channel_configurations.encrypted_credentials` BYTEA column as a
// single opaque blob: `iv (12B) || authTag (16B) || ciphertext`.
//
// The symmetric key comes ONLY from the CHANNEL_CREDENTIALS_KEY env
// var (any string ≥ 16 chars; it is stretched to 32 bytes with
// SHA-256). The key never touches the database, client bundles, or
// logs — and there is deliberately NO "reveal" API: credentials can
// be overwritten or tested, never read back.
//
// GCM (not CBC) so tampering with the ciphertext at rest fails
// decryption loudly instead of yielding garbage credentials.
// ============================================================

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const IV_LENGTH = 12; // NIST-recommended GCM nonce size
const TAG_LENGTH = 16;

class MissingKeyError extends Error {
  constructor() {
    super(
      'CHANNEL_CREDENTIALS_KEY is not configured — cannot encrypt channel credentials',
    );
    this.name = 'MissingKeyError';
  }
}

export function hasCredentialsKey(): boolean {
  return (process.env.CHANNEL_CREDENTIALS_KEY ?? '').trim().length >= 16;
}

/** Stretch the env passphrase into a 32-byte AES key. */
function key(): Buffer {
  const raw = (process.env.CHANNEL_CREDENTIALS_KEY ?? '').trim();
  if (raw.length < 16) throw new MissingKeyError();
  return createHash('sha256').update(raw).digest();
}

/** Encrypt a credentials JSON string → `\x…` hex literal for BYTEA. */
export function encryptCredentials(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const blob = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  // PostgREST accepts BYTEA as a `\x`-prefixed hex string.
  return `\\x${blob.toString('hex')}`;
}

/**
 * Decrypt a BYTEA hex literal back to the credentials JSON string.
 * Used ONLY transiently server-side (test-connection); the result
 * must never be serialized into a response.
 */
export function decryptCredentials(byteaHex: string): string {
  const hex = byteaHex.startsWith('\\x') ? byteaHex.slice(2) : byteaHex;
  const blob = Buffer.from(hex, 'hex');
  if (blob.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext too short');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/** Build a human-safe hint like `AC••••4f2a` — never secret material. */
export function maskPreview(value: string): string {
  const v = value.trim();
  if (v.length <= 6) return '••••';
  return `${v.slice(0, 2)}••••${v.slice(-4)}`;
}

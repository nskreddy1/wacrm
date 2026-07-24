import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AiProvider } from './types';

const PROOF_TTL_MS = 10 * 60 * 1000;

type ProofPayload = {
  accountId: string;
  provider: AiProvider;
  model: string;
  keyHash: string;
  /** Custom-provider endpoint the test ran against ('' for presets). */
  baseUrl?: string;
  expiresAt: number;
};

function secret(): string {
  const value = process.env.ENCRYPTION_KEY;
  if (!value) throw new Error('ENCRYPTION_KEY is not configured');
  return value;
}

function keyHash(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

function signature(encodedPayload: string): string {
  return createHmac('sha256', secret())
    .update(encodedPayload)
    .digest('base64url');
}

/**
 * Short-lived, server-signed proof that a specific account/provider/model/key
 * combination passed the provider test. This lets Save reuse a successful
 * Test key result without trusting a client-controlled boolean or calling the
 * provider a second time.
 */
export function createValidationProof(args: {
  accountId: string;
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
}): string {
  const payload: ProofPayload = {
    accountId: args.accountId,
    provider: args.provider,
    model: args.model,
    keyHash: keyHash(args.apiKey),
    baseUrl: args.baseUrl ?? '',
    expiresAt: Date.now() + PROOF_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded)}`;
}

export function verifyValidationProof(
  proof: unknown,
  args: {
    accountId: string;
    provider: AiProvider;
    model: string;
    apiKey: string;
    baseUrl?: string | null;
  }
): boolean {
  if (typeof proof !== 'string') return false;
  const [encoded, suppliedSignature, extra] = proof.split('.');
  if (!encoded || !suppliedSignature || extra) return false;

  const expectedSignature = signature(encoded);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as ProofPayload;
    return (
      payload.expiresAt > Date.now() &&
      payload.accountId === args.accountId &&
      payload.provider === args.provider &&
      payload.model === args.model &&
      payload.keyHash === keyHash(args.apiKey) &&
      (payload.baseUrl ?? '') === (args.baseUrl ?? '')
    );
  } catch {
    return false;
  }
}

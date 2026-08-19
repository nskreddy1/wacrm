// ============================================================
// Client-side cache identity for a model listing (ADR-005 F1).
//
// The listing is fetched with an in-progress API key, and SWR keeps
// every key it is given in an in-memory map that survives for the life
// of the page and is fully visible to devtools. So the raw provider key
// MUST NOT be part of the SWR key — only a fingerprint that is enough
// to distinguish "they pasted a different key" from "same key, another
// render", and useless to anyone who reads it.
//
// `${length}:${last4}` is the ADR's binding format. It matches the
// discipline `model-catalog.ts` already applies to its own server-side
// cache key, so both layers leak the same (negligible) amount.
//
// The raw key travels ONLY in the POST body of the fetch.
// ============================================================

/** Minimum draft length before a listing is attempted at all. Below
 *  this the operator is mid-paste and every provider round-trip would
 *  be wasted against a 30/min budget (ADR-005 F3). */
export const MIN_DRAFT_KEY_LENGTH = 20;

/** Debounce on the draft key, so pasting a key costs ONE provider call
 *  rather than one per keystroke (ADR-005 F3). */
export const DRAFT_KEY_DEBOUNCE_MS = 600;

/** Non-reversible stand-in for a key, safe to put in a cache key. */
export function keyFingerprint(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(-4)}`;
}

/** Is this draft long enough to be worth a provider round-trip? */
export function isListableDraftKey(draft: string | null | undefined): boolean {
  return (draft?.trim().length ?? 0) >= MIN_DRAFT_KEY_LENGTH;
}

/**
 * SWR cache key for a draft-key (POST) listing. Returned as a tuple so
 * a change of provider, endpoint, base URL, target account OR key all
 * produce a distinct entry — while the key itself never appears.
 */
export function draftModelsSwrKey(input: {
  endpoint: string;
  provider: string;
  baseUrl?: string | null;
  accountId?: string | null;
  draftApiKey: string;
}): readonly [string, string, string, string, string, string] {
  return [
    'ai-models',
    input.endpoint,
    input.provider,
    input.baseUrl?.trim() ?? '',
    input.accountId ?? '',
    keyFingerprint(input.draftApiKey),
  ] as const;
}

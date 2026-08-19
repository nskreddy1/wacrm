// ============================================================
// Shared body of the two model-listing routes (ADR-005 D2/D5).
//
// `/api/ai/models` (tenant, requireRole('admin')) and
// `/api/admin/ai-models` (super-admin, explicit account_id) both list
// the SAME provider catalogue; they differ only in who is allowed to
// ask and whose account row holds the fallback key. Both verbs on both
// routes delegate here so the pair cannot drift:
//
//   GET   → no `bodyApiKey`: the key comes from the stored agent row.
//   POST  → `bodyApiKey` from the JSON body: first-run setup and
//           provider switches, where nothing is saved yet.
//
// ADR-005 F1 is binding on this file:
//   • the key is a function-local; it is never persisted here,
//   • it is never logged (nothing in this module logs the key or the
//     request body), and
//   • it is never echoed — the response shape is exactly
//     `{ models, needsKey, error?, code? }`.
//
// ADR-005 F2: the auth guard lives in the route, ABOVE this call. Keep
// this handler shared — un-sharing it is how a new verb ends up
// without the guard the old one had.
//
// ADR-005 F4: the non-throwing contract is preserved. A provider
// problem answers 200 with `error` (and `code` propagated verbatim
// from `AiError`), never a 500, so the model field degrades to free
// text instead of blocking a valid save.
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/crypto/secrets';
import { fetchAgentRow } from './agents';
import { listProviderModels } from './model-catalog';
import { AiError, type AiProvider } from './types';

export interface ListModelsRequest {
  /** Client to read the fallback agent row with — the caller's
   *  RLS-scoped client on the tenant route, the platform admin client
   *  on the super-admin route. */
  db: SupabaseClient;
  accountId: string;
  provider: AiProvider;
  /** In-progress base URL for `custom` / `ollama`. Query param on GET,
   *  body field on POST. Falls back to the stored row's value. */
  baseUrl?: string | null;
  /**
   * Draft key from the request BODY. Never read from a URL — a key in
   * a query string lands in access logs, proxy logs and error
   * reporters (ADR-005 D2 / F1). Empty or absent falls back to the
   * stored key exactly as GET does.
   */
  bodyApiKey?: string | null;
  /** Log prefix for the one unknown-error line. Never includes a key. */
  logLabel: string;
}

export async function handleListModels({
  db,
  accountId,
  provider,
  baseUrl,
  bodyApiKey,
  logLabel,
}: ListModelsRequest): Promise<NextResponse> {
  const row = await fetchAgentRow(db, accountId).catch(() => null);

  // Resolution order: the draft key wins, because the operator is
  // typing it right now precisely because the stored one is absent or
  // belongs to another provider.
  let apiKey = bodyApiKey?.trim() ?? '';

  // The stored key only applies to the provider it was saved for.
  // Switching the picker to a provider with no key yet is a normal
  // state, not an error — the form stays on free text.
  if (!apiKey && row?.api_key && row.provider === provider) {
    try {
      apiKey = decrypt(row.api_key);
    } catch {
      return NextResponse.json({
        models: [],
        needsKey: true,
        error: 'The stored API key could not be decrypted — re-enter it.',
      });
    }
  }
  if (!apiKey && provider !== 'ollama') {
    return NextResponse.json({ models: [], needsKey: true });
  }

  // Base URL is only meaningful for custom/ollama endpoints; take the
  // in-progress form value so the picker works before the first save.
  const resolvedBaseUrl =
    provider === 'custom' || provider === 'ollama'
      ? (baseUrl ?? row?.base_url ?? null)
      : null;

  try {
    const models = await listProviderModels({
      provider,
      apiKey,
      baseUrl: resolvedBaseUrl,
    });
    return NextResponse.json({ models, needsKey: false });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({
        models: [],
        needsKey: err.code === 'missing_key',
        // Propagated verbatim: the wizard's gate distinguishes a
        // rejected key from an unreachable provider (ADR-005 F4).
        error: err.message,
        code: err.code,
      });
    }
    // The error object only — never the request body.
    console.error(`[${logLabel}] listing error:`, err);
    return NextResponse.json({
      models: [],
      needsKey: false,
      error: 'Could not load the model list.',
    });
  }
}

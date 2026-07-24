import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { toErrorResponse } from '@/features/auth/lib/account';
import { supabaseAdmin } from '@/features/assistant/lib/ai/admin-client';
import { encrypt } from '@/features/whatsapp/lib/encryption';
import {
  ASSISTANT_DEFAULT_MAX_OUTPUT_TOKENS,
  ASSISTANT_DEFAULT_MODEL,
  ASSISTANT_DEFAULT_SYSTEM_PROMPT,
  ASSISTANT_PROVIDERS,
  ASSISTANT_SETTING_KEY,
  isAssistantProvider,
  providerRequiresKey,
} from '@/features/assistant/lib/config';

// ============================================================
// Platform assistant key management — super-admin only.
//
// The helper agent's API key belongs to the founder/support team,
// never to tenants. It is stored AES-256-GCM encrypted inside
// `platform_settings.value` (RLS with no policies — service-role
// access only, always behind requireSuperAdmin).
//
// GET never returns the key itself, only presence metadata.
// ============================================================

interface StoredShape {
  provider?: unknown;
  model?: unknown;
  api_key?: unknown;
  base_url?: unknown;
  system_prompt?: unknown;
  temperature?: unknown;
  max_output_tokens?: unknown;
  enabled?: unknown;
}

/** GET /api/admin/assistant-config — presence metadata, never the key. */
export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { data, error } = await supabaseAdmin()
    .from('platform_settings')
    .select('value, updated_at')
    .eq('key', ASSISTANT_SETTING_KEY)
    .maybeSingle();

  if (error) {
    console.error('[admin/assistant-config GET] read failed:', error);
    return NextResponse.json(
      { error: 'Failed to load config' },
      { status: 500 }
    );
  }

  const v = (data?.value ?? null) as StoredShape | null;
  const hasKey = !!v && typeof v.api_key === 'string' && v.api_key.length > 0;
  const storedProvider = isAssistantProvider(v?.provider) ? v?.provider : null;
  return NextResponse.json({
    // Keyless providers (Ollama) count as configured once saved.
    configured:
      hasKey || (!!storedProvider && !providerRequiresKey(storedProvider)),
    enabled: v?.enabled !== false,
    provider: storedProvider,
    model: typeof v?.model === 'string' ? v.model : null,
    base_url: typeof v?.base_url === 'string' ? v.base_url : null,
    system_prompt:
      typeof v?.system_prompt === 'string' ? v.system_prompt : null,
    default_system_prompt: ASSISTANT_DEFAULT_SYSTEM_PROMPT,
    temperature: typeof v?.temperature === 'number' ? v.temperature : null,
    max_output_tokens:
      typeof v?.max_output_tokens === 'number'
        ? v.max_output_tokens
        : ASSISTANT_DEFAULT_MAX_OUTPUT_TOKENS,
    updated_at: data?.updated_at ?? null,
  });
}

/**
 * PATCH /api/admin/assistant-config
 *
 * Body: `{ provider, model?, api_key?, enabled? }`. `api_key` is
 * optional on update — omitting it keeps the stored key (so admins
 * can flip provider/model/enabled without re-entering the secret).
 */
export async function PATCH(request: Request) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as {
    provider?: unknown;
    model?: unknown;
    api_key?: unknown;
    base_url?: unknown;
    system_prompt?: unknown;
    temperature?: unknown;
    max_output_tokens?: unknown;
    enabled?: unknown;
  } | null;

  if (!body || !isAssistantProvider(body.provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${ASSISTANT_PROVIDERS.join(', ')}` },
      { status: 400 }
    );
  }
  const provider = body.provider;
  const model =
    typeof body.model === 'string' && body.model.trim().length > 0
      ? body.model.trim()
      : ASSISTANT_DEFAULT_MODEL[provider];
  const enabled = body.enabled !== false;
  const baseUrl =
    typeof body.base_url === 'string' && body.base_url.trim().length > 0
      ? body.base_url.trim()
      : null;
  // The prompt is ALWAYS stored verbatim — even when it matches the
  // shipped default — so the admin's editor is the single source of
  // truth and future default changes never silently alter a tenant's
  // live persona. Blank still means "fall back to platform default".
  // Capped so a pasted novel can't blow up every request's budget.
  const systemPrompt =
    typeof body.system_prompt === 'string' &&
    body.system_prompt.trim().length > 0
      ? body.system_prompt.trim().slice(0, 8000)
      : null;

  // Advanced generation knobs — validated, clamped, optional.
  const temperature =
    typeof body.temperature === 'number' &&
    Number.isFinite(body.temperature) &&
    body.temperature >= 0 &&
    body.temperature <= 2
      ? Math.round(body.temperature * 100) / 100
      : null;
  const maxOutputTokens =
    typeof body.max_output_tokens === 'number' &&
    Number.isInteger(body.max_output_tokens) &&
    body.max_output_tokens >= 100 &&
    body.max_output_tokens <= 8000
      ? body.max_output_tokens
      : ASSISTANT_DEFAULT_MAX_OUTPUT_TOKENS;

  // Reject junk endpoints early (mainly for self-hosted Ollama/NIM).
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
    return NextResponse.json(
      { error: 'base_url must start with http:// or https://' },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  // Preserve the existing encrypted key when none is provided.
  let encryptedKey: string | null = null;
  if (typeof body.api_key === 'string' && body.api_key.trim().length > 0) {
    encryptedKey = encrypt(body.api_key.trim());
  } else {
    const { data } = await admin
      .from('platform_settings')
      .select('value')
      .eq('key', ASSISTANT_SETTING_KEY)
      .maybeSingle();
    const existing = (data?.value ?? null) as StoredShape | null;
    if (typeof existing?.api_key === 'string' && existing.api_key.length > 0) {
      encryptedKey = existing.api_key;
    }
  }

  if (!encryptedKey && providerRequiresKey(provider)) {
    return NextResponse.json(
      { error: 'api_key is required for initial setup' },
      { status: 400 }
    );
  }

  const { error } = await admin.from('platform_settings').upsert(
    {
      key: ASSISTANT_SETTING_KEY,
      value: {
        provider,
        model,
        api_key: encryptedKey ?? '',
        base_url: baseUrl,
        system_prompt: systemPrompt,
        temperature,
        max_output_tokens: maxOutputTokens,
        enabled,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );

  if (error) {
    console.error('[admin/assistant-config PATCH] upsert failed:', error);
    return NextResponse.json(
      { error: 'Failed to save config' },
      { status: 500 }
    );
  }

  return NextResponse.json({ configured: true, enabled, provider, model });
}

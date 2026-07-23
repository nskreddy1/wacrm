import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/super-admin'
import { toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  ASSISTANT_DEFAULT_MODEL,
  ASSISTANT_SETTING_KEY,
  isAssistantProvider,
} from '@/lib/assistant/config'

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
  provider?: unknown
  model?: unknown
  api_key?: unknown
  enabled?: unknown
}

/** GET /api/admin/assistant-config — presence metadata, never the key. */
export async function GET() {
  try {
    await requireSuperAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const { data, error } = await supabaseAdmin()
    .from('platform_settings')
    .select('value, updated_at')
    .eq('key', ASSISTANT_SETTING_KEY)
    .maybeSingle()

  if (error) {
    console.error('[admin/assistant-config GET] read failed:', error)
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 })
  }

  const v = (data?.value ?? null) as StoredShape | null
  return NextResponse.json({
    configured:
      !!v && typeof v.api_key === 'string' && v.api_key.length > 0,
    enabled: v?.enabled !== false,
    provider: isAssistantProvider(v?.provider) ? v?.provider : null,
    model: typeof v?.model === 'string' ? v.model : null,
    updated_at: data?.updated_at ?? null,
  })
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
    await requireSuperAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as {
    provider?: unknown
    model?: unknown
    api_key?: unknown
    enabled?: unknown
  } | null

  if (!body || !isAssistantProvider(body.provider)) {
    return NextResponse.json(
      { error: "provider must be 'openai', 'anthropic' or 'gemini'" },
      { status: 400 },
    )
  }
  const provider = body.provider
  const model =
    typeof body.model === 'string' && body.model.trim().length > 0
      ? body.model.trim()
      : ASSISTANT_DEFAULT_MODEL[provider]
  const enabled = body.enabled !== false

  const admin = supabaseAdmin()

  // Preserve the existing encrypted key when none is provided.
  let encryptedKey: string | null = null
  if (typeof body.api_key === 'string' && body.api_key.trim().length > 0) {
    encryptedKey = encrypt(body.api_key.trim())
  } else {
    const { data } = await admin
      .from('platform_settings')
      .select('value')
      .eq('key', ASSISTANT_SETTING_KEY)
      .maybeSingle()
    const existing = (data?.value ?? null) as StoredShape | null
    if (typeof existing?.api_key === 'string' && existing.api_key.length > 0) {
      encryptedKey = existing.api_key
    }
  }

  if (!encryptedKey) {
    return NextResponse.json(
      { error: 'api_key is required for initial setup' },
      { status: 400 },
    )
  }

  const { error } = await admin.from('platform_settings').upsert(
    {
      key: ASSISTANT_SETTING_KEY,
      value: { provider, model, api_key: encryptedKey, enabled },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )

  if (error) {
    console.error('[admin/assistant-config PATCH] upsert failed:', error)
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }

  return NextResponse.json({ configured: true, enabled, provider, model })
}

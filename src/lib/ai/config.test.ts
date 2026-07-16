import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import { loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

describe('loadAiConfig env fallback (GEMINI_API_KEY)', () => {
  const ORIGINAL_ENV_KEY = process.env.GEMINI_API_KEY

  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'env-gemini-key'
  })

  afterEach(() => {
    if (ORIGINAL_ENV_KEY === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = ORIGINAL_ENV_KEY
  })

  it('no row + env key set → synthetic gemini config with keySource env', async () => {
    const config = await loadAiConfig(dbReturning(null), 'acct')
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('gemini')
    expect(config!.apiKey).toBe('env-gemini-key')
    expect(config!.keySource).toBe('env')
    expect(config!.autoReplyEnabled).toBe(true)
    expect(config!.handoffAgentId).toBeNull()
  })

  it('no row + no env key → null (not configured)', async () => {
    delete process.env.GEMINI_API_KEY
    expect(await loadAiConfig(dbReturning(null), 'acct')).toBeNull()
  })

  it('row with is_active=false → null even when env key is set (explicit off wins)', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('active row with empty api_key → env fallback', async () => {
    const config = await loadAiConfig(
      dbReturning({ ...ROW, is_active: true, api_key: '' }),
      'acct',
    )
    expect(config).not.toBeNull()
    expect(config!.keySource).toBe('env')
    expect(config!.provider).toBe('gemini')
  })

  it('active row with its own key → account key wins over env', async () => {
    const config = await loadAiConfig(
      dbReturning({ ...ROW, is_active: true }),
      'acct',
    )
    expect(config).not.toBeNull()
    expect(config!.apiKey).toBe('plain:enc-key')
    expect(config!.keySource).toBe('account')
    expect(config!.provider).toBe('openai')
  })
})

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
  })

  it('returns null when there is no row (and no env key)', async () => {
    const saved = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY
    try {
      expect(
        await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
      ).toBeNull()
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved
    }
  })
})

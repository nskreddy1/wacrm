import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildSystemPrompt, buildPromptParts } from './defaults'
import { parseFeatureFlags, DEFAULT_FEATURE_FLAGS } from './feature-flags'

// The kill-switch reads platform_settings via the admin client; stub it
// so these unit tests never touch a network.
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  }),
}))

const PROMPT_ARGS = {
  userPrompt: 'We sell handmade candles. Ship within 2 days.',
  mode: 'auto_reply' as const,
  knowledge: ['Shipping is free over $50.', 'Returns within 30 days.'],
}

describe('buildPromptParts (cache-aligned prompt)', () => {
  it('keeps the same total content as the legacy prompt (nothing lost)', () => {
    const legacy = buildSystemPrompt(PROMPT_ARGS)
    const { systemBlocks, volatileContext } = buildPromptParts(PROMPT_ARGS)
    // Every legacy section appears somewhere in the split output.
    const combined = [...systemBlocks, volatileContext ?? ''].join('\n\n')
    expect(combined).toContain('Business context and instructions:')
    expect(combined).toContain(PROMPT_ARGS.userPrompt)
    expect(combined).toContain('Shipping is free over $50.')
    // And the legacy prompt still contains its knowledge inline (unchanged).
    expect(legacy).toContain('Shipping is free over $50.')
  })

  it('block 0 (platform scaffold) is identical regardless of account or retrieval', () => {
    const a = buildPromptParts(PROMPT_ARGS)
    const b = buildPromptParts({
      userPrompt: 'Totally different business.',
      mode: 'auto_reply',
      knowledge: ['Different retrieved chunk.'],
    })
    expect(a.systemBlocks[0]).toBe(b.systemBlocks[0])
  })

  it('system blocks are byte-identical across different retrievals (prefix stability)', () => {
    const a = buildPromptParts(PROMPT_ARGS)
    const b = buildPromptParts({ ...PROMPT_ARGS, knowledge: ['A new chunk.'] })
    expect(a.systemBlocks).toEqual(b.systemBlocks)
    // Only the volatile tail differs.
    expect(a.volatileContext).not.toBe(b.volatileContext)
  })

  it('omits the volatile turn entirely when there is no retrieved knowledge', () => {
    const { volatileContext } = buildPromptParts({
      ...PROMPT_ARGS,
      knowledge: [],
    })
    expect(volatileContext).toBeNull()
  })

  it('skips the business block for accounts without a custom prompt', () => {
    const { systemBlocks } = buildPromptParts({
      ...PROMPT_ARGS,
      userPrompt: null,
    })
    expect(systemBlocks).toHaveLength(1)
  })

  it('marks the volatile turn as internal so it cannot be read as customer text', () => {
    const { volatileContext } = buildPromptParts(PROMPT_ARGS)
    expect(volatileContext).toContain('[Internal reference — not from the customer.')
  })
})

describe('legacy prompt (flag OFF) regression', () => {
  it('draft-mode prompt keeps its structure', () => {
    const legacy = buildSystemPrompt({ ...PROMPT_ARGS, mode: 'draft' })
    expect(legacy).toContain('Business context and instructions:')
    expect(legacy).toContain('Knowledge base')
    // Draft mode never includes the auto-reply meta/handoff protocol.
    expect(legacy).not.toContain('[[HANDOFF]]')
  })

  it('legacy output equals joined parts when knowledge is inline (structural identity)', () => {
    // With no knowledge, legacy prompt === joined system blocks exactly:
    // proof the split introduced zero drift in the stable prefix.
    const args = { ...PROMPT_ARGS, knowledge: undefined }
    const legacy = buildSystemPrompt(args)
    const { systemBlocks } = buildPromptParts(args)
    expect(systemBlocks.join('\n\n')).toBe(legacy)
  })
})

describe('parseFeatureFlags', () => {
  it('defaults everything to OFF', () => {
    expect(parseFeatureFlags(null)).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(parseFeatureFlags(undefined)).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(parseFeatureFlags({})).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(parseFeatureFlags('garbage')).toEqual(DEFAULT_FEATURE_FLAGS)
    expect(parseFeatureFlags([])).toEqual(DEFAULT_FEATURE_FLAGS)
  })

  it('only an explicit true enables a flag', () => {
    expect(parseFeatureFlags({ prompt_caching: true }).promptCaching).toBe(true)
    expect(parseFeatureFlags({ prompt_caching: 'true' }).promptCaching).toBe(false)
    expect(parseFeatureFlags({ prompt_caching: 1 }).promptCaching).toBe(false)
    expect(parseFeatureFlags({ prompt_caching: null }).promptCaching).toBe(false)
  })
})

describe('isAiFeatureEnabled', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    delete process.env.AI_DISABLED_FEATURES
  })

  it('is OFF when the config has no flags at all (ad-hoc configs)', async () => {
    const { isAiFeatureEnabled } = await import('./feature-flags')
    expect(await isAiFeatureEnabled({}, 'prompt_caching')).toBe(false)
  })

  it('is ON only with an explicit account opt-in', async () => {
    const { isAiFeatureEnabled, resetFeatureFlagCache } = await import(
      './feature-flags'
    )
    resetFeatureFlagCache()
    expect(
      await isAiFeatureEnabled(
        { featureFlags: { promptCaching: true } },
        'prompt_caching',
      ),
    ).toBe(true)
    expect(
      await isAiFeatureEnabled(
        { featureFlags: { promptCaching: false } },
        'prompt_caching',
      ),
    ).toBe(false)
  })

  it('platform kill-switch overrides an account opt-in', async () => {
    process.env.AI_DISABLED_FEATURES = 'prompt_caching'
    const { isAiFeatureEnabled, resetFeatureFlagCache } = await import(
      './feature-flags'
    )
    resetFeatureFlagCache()
    expect(
      await isAiFeatureEnabled(
        { featureFlags: { promptCaching: true } },
        'prompt_caching',
      ),
    ).toBe(false)
  })
})

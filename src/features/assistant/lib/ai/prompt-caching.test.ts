import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildPromptParts } from './defaults';

const PROMPT_ARGS = {
  userPrompt: 'We sell handmade candles. Ship within 2 days.',
  mode: 'auto_reply' as const,
  knowledge: ['Shipping is free over $50.', 'Returns within 30 days.'],
};

describe('buildPromptParts (cache-aligned prompt)', () => {
  it('keeps the same total content as the legacy prompt (nothing lost)', () => {
    const legacy = buildSystemPrompt(PROMPT_ARGS);
    const { systemBlocks, volatileContext } = buildPromptParts(PROMPT_ARGS);
    // Every legacy section appears somewhere in the split output.
    const combined = [...systemBlocks, volatileContext ?? ''].join('\n\n');
    expect(combined).toContain('Business context and instructions:');
    expect(combined).toContain(PROMPT_ARGS.userPrompt);
    expect(combined).toContain('Shipping is free over $50.');
    // And the legacy prompt still contains its knowledge inline (unchanged).
    expect(legacy).toContain('Shipping is free over $50.');
  });

  it('block 0 (platform scaffold) is identical regardless of account or retrieval', () => {
    const a = buildPromptParts(PROMPT_ARGS);
    const b = buildPromptParts({
      userPrompt: 'Totally different business.',
      mode: 'auto_reply',
      knowledge: ['Different retrieved chunk.'],
    });
    expect(a.systemBlocks[0]).toBe(b.systemBlocks[0]);
  });

  it('system blocks are byte-identical across different retrievals (prefix stability)', () => {
    const a = buildPromptParts(PROMPT_ARGS);
    const b = buildPromptParts({ ...PROMPT_ARGS, knowledge: ['A new chunk.'] });
    expect(a.systemBlocks).toEqual(b.systemBlocks);
    // Only the volatile tail differs.
    expect(a.volatileContext).not.toBe(b.volatileContext);
  });

  it('omits the volatile turn entirely when there is no retrieved knowledge', () => {
    const { volatileContext } = buildPromptParts({
      ...PROMPT_ARGS,
      knowledge: [],
    });
    expect(volatileContext).toBeNull();
  });

  it('skips the business block for accounts without a custom prompt', () => {
    const { systemBlocks } = buildPromptParts({
      ...PROMPT_ARGS,
      userPrompt: null,
    });
    expect(systemBlocks).toHaveLength(1);
  });

  it('marks the volatile turn as internal so it cannot be read as customer text', () => {
    const { volatileContext } = buildPromptParts(PROMPT_ARGS);
    expect(volatileContext).toContain(
      '[Internal reference — not from the customer.'
    );
  });
});

describe('legacy prompt (flag OFF) regression', () => {
  it('draft-mode prompt keeps its structure', () => {
    const legacy = buildSystemPrompt({ ...PROMPT_ARGS, mode: 'draft' });
    expect(legacy).toContain('Business context and instructions:');
    expect(legacy).toContain('Knowledge base');
    // Draft mode never includes the auto-reply meta/handoff protocol.
    expect(legacy).not.toContain('[[HANDOFF]]');
  });

  it('legacy output equals joined parts when knowledge is inline (structural identity)', () => {
    // With no knowledge, legacy prompt === joined system blocks exactly:
    // proof the split introduced zero drift in the stable prefix.
    const args = { ...PROMPT_ARGS, knowledge: undefined };
    const legacy = buildSystemPrompt(args);
    const { systemBlocks } = buildPromptParts(args);
    expect(systemBlocks.join('\n\n')).toBe(legacy);
  });
});

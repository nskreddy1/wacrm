import { describe, expect, it } from 'vitest';
import { dealInputSchema, formatPipelineError, uuidSchema } from './validation';

const pipelineId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const stageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const contactId = '77777777-7777-4777-8777-777777777777';
const ownerId = 'e3bfb053-4f5b-4439-8093-7092b5c0909d';

describe('pipeline UUID validation', () => {
  it('accepts RFC-compliant deterministic seed UUIDs', () => {
    expect(uuidSchema.parse(pipelineId)).toBe(pipelineId);
    expect(uuidSchema.parse(stageId)).toBe(stageId);
  });

  it('rejects legacy seed identifiers with invalid version and variant bits', () => {
    expect(
      uuidSchema.safeParse('cccccccc-cccc-cccc-cccc-cccccccccccc').success
    ).toBe(false);
  });

  it('accepts deal relationships backed by Supabase UUID columns', () => {
    const result = dealInputSchema.parse({
      pipelineId,
      stageId,
      contactId,
      assignedTo: ownerId,
      title: 'Qualified opportunity',
      value: 1500,
      currency: 'usd',
      probability: 40,
    });

    expect(result).toMatchObject({
      pipelineId,
      stageId,
      contactId,
      assignedTo: ownerId,
      currency: 'USD',
    });
  });

  it('formats validation failures for people instead of serializing Zod issues', () => {
    const result = dealInputSchema.safeParse({
      pipelineId,
      stageId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      title: 'Qualified opportunity',
      value: 1500,
      currency: 'USD',
      probability: 40,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatPipelineError(result.error)).toBe(
        'stageId: Select a valid record and try again'
      );
    }
  });
});

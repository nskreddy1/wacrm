import { describe, expect, it } from 'vitest';
import type { Automation } from '@/types';
import {
  filterUnifiedItems,
  mergeUnifiedItems,
  type FlowRow,
} from './unified-items';

function flow(overrides: Partial<FlowRow> = {}): FlowRow {
  return {
    id: 'flow-1',
    name: 'Flow',
    description: null,
    status: 'active',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['hi'] },
    execution_count: 3,
    last_executed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    account_id: 'acct-1',
    user_id: 'user-1',
    name: 'Rule',
    trigger_type: 'keyword_match',
    trigger_config: {},
    is_active: true,
    execution_count: 5,
    last_executed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    ...overrides,
  } as Automation;
}

describe('mergeUnifiedItems', () => {
  it('interleaves flows and automations sorted by updated_at desc', () => {
    const items = mergeUnifiedItems(
      [flow({ id: 'f1', updated_at: '2026-01-02T00:00:00Z' })],
      [
        automation({ id: 'a1', updated_at: '2026-01-03T00:00:00Z' }),
        automation({ id: 'a2', updated_at: '2026-01-01T00:00:00Z' }),
      ]
    );
    expect(
      items.map((i) => (i.kind === 'flow' ? i.flow.id : i.automation.id))
    ).toEqual(['a1', 'f1', 'a2']);
  });

  it('returns empty array for no input', () => {
    expect(mergeUnifiedItems([], [])).toEqual([]);
  });

  it('tolerates invalid dates by sorting them last', () => {
    const items = mergeUnifiedItems(
      [flow({ id: 'f1', updated_at: 'not-a-date' })],
      [automation({ id: 'a1', updated_at: '2026-01-01T00:00:00Z' })]
    );
    expect(items[0].kind).toBe('automation');
  });
});

describe('filterUnifiedItems', () => {
  const items = mergeUnifiedItems([flow()], [automation()]);

  it("'all' returns everything", () => {
    expect(filterUnifiedItems(items, 'all')).toHaveLength(2);
  });

  it("'flows' returns only flows", () => {
    const out = filterUnifiedItems(items, 'flows');
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('flow');
  });

  it("'rules' returns only automations", () => {
    const out = filterUnifiedItems(items, 'rules');
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('automation');
  });
});

import type { Automation } from '@/types';

/**
 * FlowRow was previously a private interface inside
 * src/app/(dashboard)/flows/page.tsx. It now lives here so the page,
 * cards, and tests share one definition.
 */
export interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UnifiedItem =
  | { kind: 'flow'; flow: FlowRow }
  | { kind: 'automation'; automation: Automation };

export type UnifiedFilter = 'all' | 'flows' | 'rules';

function sortTime(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Merge flows and classic automations into one list, newest updated first. */
export function mergeUnifiedItems(
  flows: FlowRow[],
  automations: Automation[]
): UnifiedItem[] {
  const items: UnifiedItem[] = [
    ...flows.map((flow): UnifiedItem => ({ kind: 'flow', flow })),
    ...automations.map((automation): UnifiedItem => ({
      kind: 'automation',
      automation,
    })),
  ];
  return items.sort((a, b) => {
    const ta = sortTime(
      a.kind === 'flow' ? a.flow.updated_at : a.automation.updated_at
    );
    const tb = sortTime(
      b.kind === 'flow' ? b.flow.updated_at : b.automation.updated_at
    );
    return tb - ta;
  });
}

export function filterUnifiedItems(
  items: UnifiedItem[],
  filter: UnifiedFilter
): UnifiedItem[] {
  if (filter === 'flows') return items.filter((i) => i.kind === 'flow');
  if (filter === 'rules') return items.filter((i) => i.kind === 'automation');
  return items;
}

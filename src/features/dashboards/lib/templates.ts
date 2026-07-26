// ============================================================
// Dashboard templates — predefined layouts a user can start
// from when creating a dashboard (Twenty-style, adapted).
//
// Templates mix the prebuilt widgets (kpi/chart/panel/target)
// with generic `graph` widgets driven by the chart catalog, so
// they double as worked examples of the generic engine.
//
// Widget ids are generated at instantiation time (crypto.randomUUID
// on the client) — templates only describe shape.
// ============================================================

import type { DashboardWidget } from './widgets';

export type TemplateWidget = Omit<DashboardWidget, 'id'>;

export interface DashboardTemplate {
  key: string;
  name: string;
  description: string;
  /** Lucide icon name rendered by the picker (kept as a string so this file stays server-safe). */
  icon: 'trending-up' | 'building-2' | 'heart-pulse' | 'headset' | 'layout-grid';
  widgets: TemplateWidget[];
}

export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    key: 'blank',
    name: 'Blank',
    description: 'Start from scratch and add your own components.',
    icon: 'layout-grid',
    widgets: [],
  },
  {
    key: 'sales',
    name: 'Sales',
    description: 'Pipeline value, win rate, revenue trend and leaderboard.',
    icon: 'trending-up',
    widgets: [
      { type: 'kpi', size: 'sm', config: { metric: 'pipelineValue' } },
      { type: 'kpi', size: 'sm', config: { metric: 'activeDeals' } },
      { type: 'kpi', size: 'sm', config: { metric: 'wonValue30d' } },
      { type: 'kpi', size: 'sm', config: { metric: 'lostCount30d' } },
      {
        type: 'graph',
        size: 'md',
        title: 'Won revenue by month',
        config: {
          chart: {
            configurationType: 'LINE_CHART',
            source: 'deals',
            measure: 'value',
            operation: 'SUM',
            groupBy: 'createdAt',
            dateGranularity: 'month',
            timeRange: '6m',
          },
        },
      },
      {
        type: 'graph',
        size: 'md',
        title: 'Open deals by stage',
        config: {
          chart: {
            configurationType: 'BAR_CHART',
            source: 'deals',
            measure: 'value',
            operation: 'SUM',
            groupBy: 'stage',
            orderBy: 'value_desc',
          },
        },
      },
      { type: 'panel', size: 'md', config: { panel: 'performers' } },
      {
        type: 'graph',
        size: 'md',
        title: 'Deals by status',
        config: {
          chart: {
            configurationType: 'PIE_CHART',
            source: 'deals',
            measure: 'count',
            operation: 'COUNT',
            groupBy: 'status',
          },
        },
      },
    ],
  },
  {
    key: 'real-estate',
    name: 'Real estate',
    description: 'Listings pipeline, lead sources, viewings and follow-ups.',
    icon: 'building-2',
    widgets: [
      { type: 'kpi', size: 'sm', config: { metric: 'newContacts30d' } },
      { type: 'kpi', size: 'sm', config: { metric: 'activeDeals' } },
      { type: 'kpi', size: 'sm', config: { metric: 'pipelineValue' } },
      { type: 'kpi', size: 'sm', config: { metric: 'responseRatePct' } },
      {
        type: 'graph',
        size: 'md',
        title: 'Leads by source',
        config: {
          chart: {
            configurationType: 'PIE_CHART',
            source: 'contacts',
            measure: 'count',
            operation: 'COUNT',
            groupBy: 'source',
            timeRange: '90d',
          },
        },
      },
      {
        type: 'graph',
        size: 'md',
        title: 'New enquiries per week',
        config: {
          chart: {
            configurationType: 'BAR_CHART',
            source: 'contacts',
            measure: 'count',
            operation: 'COUNT',
            groupBy: 'createdAt',
            dateGranularity: 'week',
            timeRange: '90d',
          },
        },
      },
      { type: 'panel', size: 'md', config: { panel: 'appointments' } },
      { type: 'panel', size: 'md', config: { panel: 'tasks' } },
    ],
  },
  {
    key: 'healthcare',
    name: 'Healthcare',
    description: 'Patient contacts, appointments and response times.',
    icon: 'heart-pulse',
    widgets: [
      { type: 'kpi', size: 'sm', config: { metric: 'newContacts30d' } },
      { type: 'kpi', size: 'sm', config: { metric: 'openConversations' } },
      { type: 'kpi', size: 'sm', config: { metric: 'responseRatePct' } },
      { type: 'kpi', size: 'sm', config: { metric: 'messages7d' } },
      {
        type: 'graph',
        size: 'md',
        title: 'Appointments per week',
        config: {
          chart: {
            configurationType: 'BAR_CHART',
            source: 'appointments',
            measure: 'count',
            operation: 'COUNT',
            groupBy: 'startsAt',
            dateGranularity: 'week',
            timeRange: '90d',
          },
        },
      },
      {
        type: 'graph',
        size: 'md',
        title: 'Appointments by status',
        config: {
          chart: {
            configurationType: 'PIE_CHART',
            source: 'appointments',
            measure: 'count',
            operation: 'COUNT',
            groupBy: 'status',
            timeRange: '90d',
          },
        },
      },
      { type: 'panel', size: 'md', config: { panel: 'appointments' } },
      { type: 'panel', size: 'md', config: { panel: 'activity' } },
    ],
  },
  {
    key: 'support',
    name: 'Support',
    description: 'Conversation load, channels and team workload.',
    icon: 'headset',
    widgets: [
      { type: 'kpi', size: 'sm', config: { metric: 'openConversations' } },
      { type: 'kpi', size: 'sm', config: { metric: 'unassigned' } },
      { type: 'kpi', size: 'sm', config: { metric: 'responseRatePct' } },
      { type: 'kpi', size: 'sm', config: { metric: 'messages7d' } },
      {
        type: 'graph',
        size: 'md',
        title: 'Conversations by status',
        config: {
          chart: {
            configurationType: 'PIE_CHART',
            source: 'conversations',
            measure: 'count',
            operation: 'COUNT',
            groupBy: 'status',
            timeRange: '30d',
          },
        },
      },
      { type: 'chart', size: 'md', config: { kind: 'volume' } },
      { type: 'panel', size: 'md', config: { panel: 'team' } },
      { type: 'panel', size: 'md', config: { panel: 'activity' } },
    ],
  },
];

export function getTemplate(key: string): DashboardTemplate | undefined {
  return DASHBOARD_TEMPLATES.find((t) => t.key === key);
}

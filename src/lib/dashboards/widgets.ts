// ============================================================
// Custom dashboard widget model + registry.
//
// A dashboard is a jsonb array of DashboardWidget rows stored in
// user_dashboards.widgets. Every widget renders from the SAME
// /api/v1/dashboard overview payload — widgets are pure client-side
// projections of that data, so adding one never costs extra queries.
//
// Shared by: /api/dashboards (validation) and the dashboard UI
// (picker, config forms, renderers).
// ============================================================

export const WIDGET_SIZES = ['sm', 'md', 'lg', 'full'] as const
export type WidgetSize = (typeof WIDGET_SIZES)[number]

export const WIDGET_TYPES = ['kpi', 'chart', 'target', 'panel'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]

// ------------------------------------------------------------
// KPI metrics — single-number cards (with delta when available).
// Keys project into DashboardKpis / PipelineSummary fields.
// ------------------------------------------------------------

export const KPI_METRICS = {
  openConversations: {
    label: 'Open conversations',
    description: 'Conversations currently open',
    format: 'number',
    hasDelta: true,
  },
  unassigned: {
    label: 'Unassigned conversations',
    description: 'Open conversations without an owner',
    format: 'number',
    hasDelta: false,
  },
  newContacts30d: {
    label: 'New contacts (30d)',
    description: 'Contacts added in the last 30 days',
    format: 'number',
    hasDelta: true,
  },
  pipelineValue: {
    label: 'Pipeline value',
    description: 'Total value of open deals',
    format: 'currency',
    hasDelta: false,
  },
  activeDeals: {
    label: 'Active deals',
    description: 'Open deals across all stages',
    format: 'number',
    hasDelta: false,
  },
  messages7d: {
    label: 'Messages (7d)',
    description: 'Messages sent + received last 7 days',
    format: 'number',
    hasDelta: true,
  },
  responseRatePct: {
    label: 'Response rate',
    description: 'Inbound conversations that got a reply (7d)',
    format: 'percent',
    hasDelta: false,
  },
  wonValue30d: {
    label: 'Won value (30d)',
    description: 'Value of deals won in the last 30 days',
    format: 'currency',
    hasDelta: false,
  },
  wonCount30d: {
    label: 'Deals won (30d)',
    description: 'Deals won in the last 30 days',
    format: 'number',
    hasDelta: false,
  },
  lostCount30d: {
    label: 'Deals lost (30d)',
    description: 'Deals lost in the last 30 days',
    format: 'number',
    hasDelta: false,
  },
} as const

export type KpiMetric = keyof typeof KPI_METRICS

// ------------------------------------------------------------
// Charts — time series / distribution visualizations.
// ------------------------------------------------------------

export const CHART_KINDS = {
  volume: {
    label: 'Message volume',
    description: 'Daily messages by channel (14d)',
  },
  growth: {
    label: 'Contact growth',
    description: 'Total contacts and daily additions (30d)',
  },
  pipeline: {
    label: 'Open deals by stage',
    description: 'Deal count and value per pipeline stage',
  },
  channelShare: {
    label: 'Channel share',
    description: 'Message split by channel (7d)',
  },
  broadcast: {
    label: 'Broadcast funnel',
    description: 'Sent, delivered, read, replied, failed',
  },
} as const

export type ChartKind = keyof typeof CHART_KINDS

// ------------------------------------------------------------
// Target meters — gauge of a metric against a user-set goal.
// ------------------------------------------------------------

export const TARGET_METRICS = {
  newContacts30d: { label: 'New contacts (30d)', format: 'number' },
  messages7d: { label: 'Messages (7d)', format: 'number' },
  wonValue30d: { label: 'Won value (30d)', format: 'currency' },
  wonCount30d: { label: 'Deals won (30d)', format: 'number' },
  activeDeals: { label: 'Active deals', format: 'number' },
  responseRatePct: { label: 'Response rate (%)', format: 'percent' },
} as const

export type TargetMetric = keyof typeof TARGET_METRICS

// ------------------------------------------------------------
// Panels — prebuilt list/table blocks reused from the overview.
// ------------------------------------------------------------

export const PANEL_KINDS = {
  tasks: { label: 'Open tasks', description: 'Your open tasks with due dates' },
  appointments: {
    label: 'Upcoming appointments',
    description: 'Next scheduled appointments',
  },
  activity: {
    label: 'Recent activity',
    description: 'Latest events across the workspace',
  },
  team: {
    label: 'Team workload',
    description: 'Open and resolved conversations per member',
  },
  broadcasts: {
    label: 'Recent broadcasts',
    description: 'Latest campaigns with delivery stats',
  },
} as const

export type PanelKind = keyof typeof PANEL_KINDS

// ------------------------------------------------------------
// Widget instance stored in user_dashboards.widgets.
// ------------------------------------------------------------

export interface DashboardWidget {
  /** Client-generated uuid — stable identity for dnd + updates. */
  id: string
  type: WidgetType
  size: WidgetSize
  /** Optional custom title; falls back to the registry label. */
  title?: string
  config: {
    /** kpi + target */
    metric?: KpiMetric | TargetMetric
    /** chart */
    kind?: ChartKind
    /** panel */
    panel?: PanelKind
    /** target */
    goal?: number
  }
}

export const MAX_WIDGETS_PER_DASHBOARD = 24
export const MAX_DASHBOARDS_PER_USER = 12

/** Default size per widget type when added from the picker. */
export const DEFAULT_SIZE: Record<WidgetType, WidgetSize> = {
  kpi: 'sm',
  chart: 'md',
  target: 'sm',
  panel: 'md',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate + normalize one widget coming from the client. Returns
 * null when the shape is unusable (unknown type/metric etc.), which
 * callers drop silently — a forward-compat guard so old rows survive
 * registry changes.
 */
export function sanitizeWidget(raw: unknown): DashboardWidget | null {
  if (!isRecord(raw)) return null
  const { id, type, size, title, config } = raw

  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null
  if (typeof type !== 'string' || !(WIDGET_TYPES as readonly string[]).includes(type)) return null
  const widgetType = type as WidgetType

  const widgetSize: WidgetSize =
    typeof size === 'string' && (WIDGET_SIZES as readonly string[]).includes(size)
      ? (size as WidgetSize)
      : DEFAULT_SIZE[widgetType]

  const cfg = isRecord(config) ? config : {}
  const out: DashboardWidget = { id, type: widgetType, size: widgetSize, config: {} }

  if (typeof title === 'string' && title.trim().length > 0) {
    out.title = title.trim().slice(0, 80)
  }

  switch (widgetType) {
    case 'kpi': {
      const metric = cfg.metric
      if (typeof metric !== 'string' || !(metric in KPI_METRICS)) return null
      out.config.metric = metric as KpiMetric
      break
    }
    case 'chart': {
      const kind = cfg.kind
      if (typeof kind !== 'string' || !(kind in CHART_KINDS)) return null
      out.config.kind = kind as ChartKind
      break
    }
    case 'target': {
      const metric = cfg.metric
      if (typeof metric !== 'string' || !(metric in TARGET_METRICS)) return null
      const goal = typeof cfg.goal === 'number' && Number.isFinite(cfg.goal) ? cfg.goal : 0
      if (goal <= 0 || goal > 1_000_000_000) return null
      out.config.metric = metric as TargetMetric
      out.config.goal = goal
      break
    }
    case 'panel': {
      const panel = cfg.panel
      if (typeof panel !== 'string' || !(panel in PANEL_KINDS)) return null
      out.config.panel = panel as PanelKind
      break
    }
  }

  return out
}

/** Validate a whole widgets array; drops invalid entries, dedupes ids. */
export function sanitizeWidgets(raw: unknown): DashboardWidget[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DashboardWidget[] = []
  for (const entry of raw) {
    if (out.length >= MAX_WIDGETS_PER_DASHBOARD) break
    const w = sanitizeWidget(entry)
    if (!w || seen.has(w.id)) continue
    seen.add(w.id)
    out.push(w)
  }
  return out
}

/** Registry-driven display title for a widget. */
export function widgetTitle(w: DashboardWidget): string {
  if (w.title) return w.title
  switch (w.type) {
    case 'kpi':
      return w.config.metric && w.config.metric in KPI_METRICS
        ? KPI_METRICS[w.config.metric as KpiMetric].label
        : 'KPI'
    case 'chart':
      return w.config.kind ? CHART_KINDS[w.config.kind].label : 'Chart'
    case 'target':
      return w.config.metric && w.config.metric in TARGET_METRICS
        ? `${TARGET_METRICS[w.config.metric as TargetMetric].label} target`
        : 'Target meter'
    case 'panel':
      return w.config.panel ? PANEL_KINDS[w.config.panel].label : 'Panel'
  }
}

// ============================================================
// Canonical dashboard overview contract.
//
// Produced by getDashboardOverview (supabase-repository.ts),
// served by /api/v1/dashboard, and rendered by
// components/dashboard/dashboard-workspace.tsx.
// ============================================================

/**
 * Real messaging channels in the product:
 * - conversations: whatsapp | email  (channel_kind enum)
 * - broadcasts:    whatsapp | sms
 */
export type Channel = 'whatsapp' | 'sms' | 'email';

export type BroadcastStatus =
  'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

export type ActivityKind =
  'message' | 'broadcast' | 'deal' | 'contact' | 'appointment' | 'task';

export type DashboardKpis = {
  openConversations: number;
  /** New conversations last 7d vs previous 7d, percent (null = no baseline). */
  openConversationsDelta: number | null;
  unassigned: number;
  newContacts30d: number;
  /** Contacts added last 30d vs previous 30d, percent (null = no baseline). */
  newContactsDelta: number | null;
  pipelineValue: number;
  pipelineCurrency: string;
  activeDeals: number;
  messages7d: number;
  /** Messages last 7d vs previous 7d, percent (null = no baseline). */
  messagesDelta: number | null;
  /** Share of conversations with inbound activity (7d) that got a reply. */
  responseRatePct: number | null;
};

export type ChannelSummary = {
  channel: Channel;
  openConversations: number;
  messages7d: number;
  inbound7d: number;
  outbound7d: number;
};

export type VolumePoint = {
  /** ISO date (yyyy-mm-dd), oldest first. */
  day: string;
  whatsapp: number;
  sms: number;
  email: number;
};

export type BroadcastSummary = {
  totals: {
    sent: number;
    delivered: number;
    read: number;
    replied: number;
    failed: number;
  };
  recent: Array<{
    id: string;
    name: string;
    channel: Channel;
    status: BroadcastStatus;
    totalRecipients: number;
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    createdAt: string;
  }>;
};

export type PipelineSummary = {
  stages: Array<{ id: string; name: string; count: number; value: number }>;
  wonValue30d: number;
  wonCount30d: number;
  lostCount30d: number;
};

export type TeamMemberSummary = {
  userId: string;
  name: string;
  open: number;
  resolved7d: number;
};

/** Monthly sales outcomes, oldest first (last 6 months incl. current). */
export type SalesTrendPoint = {
  /** ISO month (yyyy-mm). */
  month: string;
  wonValue: number;
  wonCount: number;
  lostCount: number;
};

/** Per-user sales leaderboard (last 30 days + current open book). */
export type PerformerSummary = {
  userId: string;
  name: string;
  wonValue30d: number;
  wonCount30d: number;
  openDeals: number;
  openValue: number;
};

/** Workspace task workload counters (not limited to the tasks list). */
export type TaskStats = {
  open: number;
  overdue: number;
  dueToday: number;
  completed7d: number;
};

export type GrowthPoint = {
  /** ISO date (yyyy-mm-dd), oldest first. */
  day: string;
  total: number;
  added: number;
};

export type ActivityEntry = {
  id: string;
  title: string;
  time: string;
  type: ActivityKind;
  href: string;
};

export type UpcomingAppointment = {
  id: string;
  contact: string;
  /** Catalog item name or appointment title. */
  service: string;
  startsAt: string;
  location: string | null;
};

export type OpenTask = {
  id: string;
  title: string;
  dueAt: string | null;
  priority: 'low' | 'medium' | 'high';
  contact: string | null;
  overdue: boolean;
};

/** "Needs attention" panel — each row links to where the work happens. */
export type AttentionItem = {
  key: 'unassigned' | 'overdue_tasks' | 'failed_broadcasts' | 'stalled_deals';
  label: string;
  count: number;
  href: string;
};

export type DashboardOverview = {
  kpis: DashboardKpis;
  channels: ChannelSummary[];
  /** 14 days of message volume, oldest first. */
  volume: VolumePoint[];
  broadcasts: BroadcastSummary;
  pipeline: PipelineSummary;
  team: TeamMemberSummary[];
  /** 6 months of sales outcomes, oldest first. */
  salesTrend: SalesTrendPoint[];
  /** Top users by won value (30d), best first. */
  performers: PerformerSummary[];
  taskStats: TaskStats;
  /** 30 days of contact growth, oldest first. */
  contactsGrowth: GrowthPoint[];
  activity: ActivityEntry[];
  appointments: UpcomingAppointment[];
  tasks: OpenTask[];
  attention: AttentionItem[];
};

import type { AccountRole } from '@/features/auth/lib/roles';

export type PipelineMode = 'board' | 'list' | 'sheet';
export type DealPriority = 'low' | 'normal' | 'high' | 'hot';
export type StageTone = 'blue' | 'cyan' | 'amber' | 'green' | 'red';

export interface PipelineMember {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: AccountRole;
}

export interface PipelineContact {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string;
}

export interface PipelineRecord {
  id: string;
  accountId: string;
  name: string;
  position: number;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  color: string;
  tone: StageTone;
}

export interface PipelineDeal {
  id: string;
  accountId: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  catalogItemId: string | null;
  customValues: Record<string, string>;
  assignedTo: string | null;
  title: string;
  value: number;
  currency: string;
  company: string | null;
  priority: DealPriority;
  probability: number;
  source: string | null;
  activity: string | null;
  nextStep: string | null;
  description: string | null;
  due: string | null;
  status: 'open' | 'won' | 'lost';
  position: number;
  createdAt: string;
  updatedAt: string;
  contact: PipelineContact | null;
  owner: PipelineMember | null;
}

export interface DealItem {
  id: string;
  dealId: string;
  catalogItemId: string | null;
  name: string;
  listPrice: number;
  quantity: number;
  discountPct: number;
  position: number;
}

export interface PipelineSavedView {
  id: string;
  accountId: string;
  pipelineId: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
  visibleFields: string[];
  favorite: boolean;
  position: number;
}

export interface SubPipeline {
  id: string;
  accountId: string;
  pipelineId: string;
  name: string;
  position: number;
  dealIds: string[];
}

export interface PipelineSnapshot {
  accountId: string;
  pipeline: PipelineRecord;
  pipelines: PipelineRecord[];
  stages: PipelineStage[];
  deals: PipelineDeal[];
  savedViews: PipelineSavedView[];
  subPipelines: SubPipeline[];
  contacts: PipelineContact[];
  members: PipelineMember[];
}

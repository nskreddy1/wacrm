import type { PipelineRecord, PipelineSnapshot } from './domain';

export type { PipelineDeal, PipelineSnapshot, PipelineStage } from './domain';

export interface PipelineRepository {
  listPipelines(): Promise<PipelineRecord[]>;
  getSnapshot(pipelineId?: string): Promise<PipelineSnapshot | null>;
}

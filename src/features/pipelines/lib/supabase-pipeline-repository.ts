import {
  getCurrentAccount,
  type AccountContext,
} from '@/features/auth/lib/account';
import type { PipelineRecord, PipelineSnapshot } from './domain';
import {
  mapContact,
  mapDeal,
  mapMember,
  mapSavedView,
  mapStage,
  mapSubPipeline,
} from './mappers';
import type { PipelineRepository } from './pipeline-repository';

type Row = Record<string, unknown>;

async function optionalRows(
  query: PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>
): Promise<Row[]> {
  const { data, error } = await query;
  if (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    error?.code === 'PGRST204'
  )
    return [];
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

function pipelineFromRow(row: Row): PipelineRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    name: String(row.name),
    position: Number(row.position ?? 0),
  };
}

export class SupabasePipelineRepository implements PipelineRepository {
  constructor(private readonly context?: AccountContext) {}

  private async account() {
    return this.context ?? getCurrentAccount();
  }

  async listPipelines(): Promise<PipelineRecord[]> {
    const { supabase, accountId } = await this.account();
    const { data, error } = await supabase
      .from('pipelines')
      .select('*')
      .eq('account_id', accountId)
      .order('position')
      .order('created_at');
    if (error?.code === '42703') {
      const fallback = await supabase
        .from('pipelines')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at');
      if (fallback.error) throw new Error(fallback.error.message);
      return ((fallback.data ?? []) as Row[]).map(pipelineFromRow);
    }
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(pipelineFromRow);
  }

  async getSnapshot(pipelineId?: string): Promise<PipelineSnapshot | null> {
    const context = await this.account();
    const { supabase, accountId } = context;
    const pipelines = await this.listPipelines();
    const pipeline = pipelineId
      ? pipelines.find((item) => item.id === pipelineId)
      : pipelines[0];
    if (!pipeline) return null;

    const [
      stageRows,
      dealRows,
      savedViewRows,
      subPipelineRows,
      membershipRows,
      contactRows,
      memberRows,
    ] = await Promise.all([
      optionalRows(
        supabase
          .from('pipeline_stages')
          .select('*')
          .eq('pipeline_id', pipeline.id)
          .order('position')
      ),
      optionalRows(
        supabase
          .from('deals')
          .select(
            '*, contact:contacts(id,name,company,email,phone), assignee:profiles!deals_assigned_to_fkey(id,user_id,full_name,email,avatar_url,account_role)'
          )
          .eq('account_id', accountId)
          .eq('pipeline_id', pipeline.id)
          .order('position')
          .order('created_at', { ascending: false })
      ),
      optionalRows(
        supabase
          .from('pipeline_saved_views')
          .select('*')
          .eq('account_id', accountId)
          .eq('pipeline_id', pipeline.id)
          .order('position')
      ),
      optionalRows(
        supabase
          .from('sub_pipelines')
          .select('*')
          .eq('account_id', accountId)
          .eq('pipeline_id', pipeline.id)
          .order('position')
      ),
      optionalRows(
        supabase
          .from('sub_pipeline_deals')
          .select('sub_pipeline_id,deal_id,position')
          .eq('account_id', accountId)
          .order('position')
      ),
      optionalRows(
        supabase
          .from('contacts')
          .select('id,name,company,email,phone')
          .eq('account_id', accountId)
          .order('name')
      ),
      optionalRows(
        supabase
          .from('profiles')
          .select('id,user_id,full_name,email,avatar_url,account_role')
          .eq('account_id', accountId)
          .order('full_name')
      ),
    ]);

    const deals = dealRows.map(mapDeal);
    const subPipelines = subPipelineRows.map((row) =>
      mapSubPipeline(row, membershipRows)
    );
    if (subPipelines.length === 0) {
      subPipelines.push({
        id: pipeline.id,
        accountId,
        pipelineId: pipeline.id,
        name: pipeline.name,
        position: 0,
        dealIds: deals.map((deal) => deal.id),
      });
    }

    return {
      accountId,
      pipeline,
      pipelines,
      stages: stageRows.map(mapStage),
      deals,
      savedViews: savedViewRows.map(mapSavedView),
      subPipelines,
      contacts: contactRows.map(mapContact),
      members: memberRows.map(mapMember),
    };
  }
}

export const pipelineRepository: PipelineRepository =
  new SupabasePipelineRepository();

'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/features/auth/lib/account';
import { pipelinePath } from '@/lib/routes/dashboard-routes';
import type { DealItem, PipelineDeal, SubPipeline } from './domain';
import { mapDeal, mapDealItem } from './mappers';
import {
  dealFieldLayoutSchema,
  dealInputSchema,
  dealItemsSaveSchema,
  formatPipelineError,
  savedViewInputSchema,
  subPipelineInputSchema,
  uuidSchema,
  type DealFieldLayout,
  type DealInput,
} from './validation';

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string };

function fail(error: unknown): ActionResult<never> {
  return { ok: false, error: formatPipelineError(error) };
}

async function verifyPipeline(
  accountId: string,
  pipelineId: string,
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase']
) {
  const { data } = await supabase
    .from('pipelines')
    .select('id')
    .eq('id', pipelineId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) throw new Error('Pipeline not found');
}

async function verifyStage(
  pipelineId: string,
  stageId: string,
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase']
) {
  const { data } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .maybeSingle();
  if (!data) throw new Error('Stage not found');
}

function dealRow(input: DealInput, accountId: string, userId: string) {
  return {
    account_id: accountId,
    user_id: userId,
    pipeline_id: input.pipelineId,
    stage_id: input.stageId,
    contact_id: input.contactId ?? null,
    catalog_item_id: input.catalogItemId ?? null,
    assigned_to: input.assignedTo ?? null,
    title: input.title,
    value: input.value,
    currency: input.currency,
    company: input.company ?? null,
    priority: input.priority,
    probability: input.probability,
    lead_source: input.source ?? null,
    last_activity: input.activity ?? null,
    next_step: input.nextStep ?? null,
    description: input.description ?? null,
    notes: input.description ?? null,
    expected_close_date: input.due ?? null,
    status: input.status,
    position: input.position,
    custom_values: input.customValues ?? {},
  };
}

export async function saveDealAction(
  raw: unknown,
  subPipelineId?: string
): Promise<ActionResult<PipelineDeal>> {
  try {
    const input = dealInputSchema.parse(raw);
    if (subPipelineId) uuidSchema.parse(subPipelineId);
    const { supabase, accountId, userId } = await requireRole('agent');
    await verifyPipeline(accountId, input.pipelineId, supabase);
    await verifyStage(input.pipelineId, input.stageId, supabase);
    const row = dealRow(input, accountId, userId);
    const query = input.id
      ? supabase
          .from('deals')
          .update(row)
          .eq('id', input.id)
          .eq('account_id', accountId)
          .eq('pipeline_id', input.pipelineId)
      : supabase.from('deals').insert(row);
    const { data, error } = await query
      .select(
        '*, contact:contacts(id,name,company,email,phone), assignee:profiles!deals_assigned_to_fkey(id,user_id,full_name,email,avatar_url,account_role)'
      )
      .single();
    if (error) throw new Error(error.message);
    if (!input.id && subPipelineId) {
      const { data: subPipeline } = await supabase
        .from('sub_pipelines')
        .select('id')
        .eq('id', subPipelineId)
        .eq('account_id', accountId)
        .eq('pipeline_id', input.pipelineId)
        .maybeSingle();
      if (!subPipeline) throw new Error('Board not found');
      const { error: membershipError } = await supabase
        .from('sub_pipeline_deals')
        .insert({
          account_id: accountId,
          sub_pipeline_id: subPipelineId,
          deal_id: data.id,
          position: input.position,
        });
      if (membershipError) {
        await supabase
          .from('deals')
          .delete()
          .eq('id', data.id)
          .eq('account_id', accountId);
        throw new Error(membershipError.message);
      }
    }
    revalidatePath(pipelinePath(accountId, input.pipelineId, 'board'));
    return { ok: true, data: mapDeal(data as Record<string, unknown>) };
  } catch (error) {
    return fail(error);
  }
}

export async function moveDealAction(
  dealId: string,
  pipelineId: string,
  stageId: string
): Promise<ActionResult<PipelineDeal>> {
  try {
    uuidSchema.parse(dealId);
    uuidSchema.parse(pipelineId);
    uuidSchema.parse(stageId);
    const { supabase, accountId } = await requireRole('agent');
    await verifyPipeline(accountId, pipelineId, supabase);
    await verifyStage(pipelineId, stageId, supabase);
    const { data, error } = await supabase
      .from('deals')
      .update({ stage_id: stageId })
      .eq('id', dealId)
      .eq('account_id', accountId)
      .eq('pipeline_id', pipelineId)
      .select(
        '*, contact:contacts(id,name,company,email,phone), assignee:profiles!deals_assigned_to_fkey(id,user_id,full_name,email,avatar_url,account_role)'
      )
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, data: mapDeal(data as Record<string, unknown>) };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteDealsAction(
  pipelineId: string,
  dealIds: string[]
): Promise<ActionResult> {
  try {
    uuidSchema.parse(pipelineId);
    dealIds.forEach((id) => uuidSchema.parse(id));
    const { supabase, accountId } = await requireRole('agent');
    const { error } = await supabase
      .from('deals')
      .delete()
      .eq('account_id', accountId)
      .eq('pipeline_id', pipelineId)
      .in('id', dealIds);
    if (error) throw new Error(error.message);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function listDealItemsAction(
  pipelineId: string,
  dealId: string
): Promise<ActionResult<DealItem[]>> {
  try {
    uuidSchema.parse(pipelineId);
    uuidSchema.parse(dealId);
    const { supabase, accountId } = await requireRole('viewer');
    const { data, error } = await supabase
      .from('deal_items')
      .select('*')
      .eq('account_id', accountId)
      .eq('deal_id', dealId)
      .order('position');
    if (error) throw new Error(error.message);
    return {
      ok: true,
      data: (data ?? []).map((row) =>
        mapDealItem(row as Record<string, unknown>)
      ),
    };
  } catch (error) {
    return fail(error);
  }
}

// Replace-all save keeps ordering and deletions simple for a small line-item list
export async function saveDealItemsAction(
  raw: unknown
): Promise<ActionResult<DealItem[]>> {
  try {
    const input = dealItemsSaveSchema.parse(raw);
    const { supabase, accountId } = await requireRole('agent');
    await verifyPipeline(accountId, input.pipelineId, supabase);
    const { data: deal } = await supabase
      .from('deals')
      .select('id')
      .eq('id', input.dealId)
      .eq('account_id', accountId)
      .eq('pipeline_id', input.pipelineId)
      .maybeSingle();
    if (!deal) throw new Error('Deal not found');
    const { error: deleteError } = await supabase
      .from('deal_items')
      .delete()
      .eq('account_id', accountId)
      .eq('deal_id', input.dealId);
    if (deleteError) throw new Error(deleteError.message);
    if (input.items.length === 0) return { ok: true, data: [] };
    const rows = input.items.map((item, index) => ({
      account_id: accountId,
      deal_id: input.dealId,
      catalog_item_id: item.catalogItemId ?? null,
      name: item.name,
      list_price: item.listPrice,
      quantity: item.quantity,
      discount_pct: item.discountPct,
      position: index,
    }));
    const { data, error } = await supabase
      .from('deal_items')
      .insert(rows)
      .select('*');
    if (error) throw new Error(error.message);
    revalidatePath(pipelinePath(accountId, input.pipelineId, 'board'));
    return {
      ok: true,
      data: (data ?? []).map((row) =>
        mapDealItem(row as Record<string, unknown>)
      ),
    };
  } catch (error) {
    return fail(error);
  }
}

export async function getDealFieldLayoutAction(
  pipelineId: string
): Promise<ActionResult<DealFieldLayout>> {
  try {
    uuidSchema.parse(pipelineId);
    const { supabase, accountId } = await requireRole('viewer');
    const { data, error } = await supabase
      .from('deal_field_settings')
      .select('layout')
      .eq('account_id', accountId)
      .eq('pipeline_id', pipelineId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { ok: true, data: dealFieldLayoutSchema.parse(data?.layout ?? {}) };
  } catch (error) {
    return fail(error);
  }
}

export async function saveDealFieldLayoutAction(
  pipelineId: string,
  raw: unknown
): Promise<ActionResult<DealFieldLayout>> {
  try {
    uuidSchema.parse(pipelineId);
    const layout = dealFieldLayoutSchema.parse(raw);
    const { supabase, accountId, userId } = await requireRole('agent');
    await verifyPipeline(accountId, pipelineId, supabase);
    const { error } = await supabase.from('deal_field_settings').upsert({
      account_id: accountId,
      pipeline_id: pipelineId,
      layout,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    revalidatePath(pipelinePath(accountId, pipelineId, 'board'));
    return { ok: true, data: layout };
  } catch (error) {
    return fail(error);
  }
}

export async function createSavedViewAction(
  raw: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = savedViewInputSchema.parse(raw);
    const { supabase, accountId, userId } = await requireRole('agent');
    await verifyPipeline(accountId, input.pipelineId, supabase);
    const { data, error } = await supabase
      .from('pipeline_saved_views')
      .insert({
        account_id: accountId,
        pipeline_id: input.pipelineId,
        created_by: userId,
        name: input.name,
        filters: input.filters,
        sort: input.sort,
        visible_fields: input.visibleFields,
        is_favorite: input.favorite,
        position: input.position,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function createSubPipelineAction(
  raw: unknown
): Promise<ActionResult<SubPipeline>> {
  try {
    const input = subPipelineInputSchema.parse(raw);
    const { supabase, accountId, userId } = await requireRole('agent');
    await verifyPipeline(accountId, input.pipelineId, supabase);
    const { data, error } = await supabase
      .from('sub_pipelines')
      .insert({
        account_id: accountId,
        pipeline_id: input.pipelineId,
        created_by: userId,
        name: input.name,
        position: input.position,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return {
      ok: true,
      data: {
        id: data.id,
        accountId,
        pipelineId: data.pipeline_id,
        name: data.name,
        position: data.position,
        dealIds: [],
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function reorderSubPipelinesAction(
  pipelineId: string,
  items: Pick<SubPipeline, 'id' | 'name' | 'position'>[]
): Promise<ActionResult> {
  try {
    uuidSchema.parse(pipelineId);
    const { supabase, accountId } = await requireRole('agent');
    await verifyPipeline(accountId, pipelineId, supabase);
    for (const item of items) {
      uuidSchema.parse(item.id);
      const { error } = await supabase
        .from('sub_pipelines')
        .update({ name: item.name.trim(), position: item.position })
        .eq('id', item.id)
        .eq('account_id', accountId)
        .eq('pipeline_id', pipelineId);
      if (error) throw new Error(error.message);
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

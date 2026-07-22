import type { DealPriority, PipelineContact, PipelineDeal, PipelineMember, PipelineSavedView, PipelineStage, StageTone, SubPipeline } from "./domain"

const tones: StageTone[] = ["blue", "cyan", "amber", "green", "red"]

type Row = Record<string, unknown>

function relation<T extends Row>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null
  return value && typeof value === "object" ? value as T : null
}

function nullable(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

export function mapContact(row: Row): PipelineContact {
  return {
    id: String(row.id),
    name: nullable(row.name) ?? "Unknown contact",
    company: nullable(row.company),
    email: nullable(row.email),
    phone: nullable(row.phone) ?? "",
  }
}

export function mapMember(row: Row): PipelineMember {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: nullable(row.full_name) ?? nullable(row.email) ?? "Unknown member",
    email: nullable(row.email),
    avatarUrl: nullable(row.avatar_url),
    role: (row.account_role ?? "viewer") as PipelineMember["role"],
  }
}

export function mapStage(row: Row, index = 0): PipelineStage {
  return {
    id: String(row.id),
    pipelineId: String(row.pipeline_id),
    name: String(row.name),
    position: Number(row.position ?? index),
    color: String(row.color ?? "#3b82f6"),
    tone: tones[index % tones.length],
  }
}

export function mapDeal(row: Row): PipelineDeal {
  const contact = relation<Row>(row.contact)
  const owner = relation<Row>(row.assignee)
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    pipelineId: String(row.pipeline_id),
    stageId: String(row.stage_id),
    contactId: nullable(row.contact_id),
    catalogItemId: nullable(row.catalog_item_id),
    customValues: (row.custom_values && typeof row.custom_values === "object" ? row.custom_values : {}) as Record<string, string>,
    assignedTo: nullable(row.assigned_to),
    title: String(row.title),
    value: Number(row.value ?? 0),
    currency: String(row.currency ?? "USD"),
    company: nullable(row.company) ?? nullable(contact?.company),
    priority: (row.priority ?? "normal") as DealPriority,
    probability: Number(row.probability ?? 0),
    source: nullable(row.lead_source),
    activity: nullable(row.last_activity),
    nextStep: nullable(row.next_step),
    description: nullable(row.description) ?? nullable(row.notes),
    due: nullable(row.expected_close_date),
    status: (row.status ?? "open") as PipelineDeal["status"],
    position: Number(row.position ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
    contact: contact ? mapContact(contact) : null,
    owner: owner ? mapMember(owner) : null,
  }
}

export function mapSavedView(row: Row): PipelineSavedView {
  return {
    id: String(row.id), accountId: String(row.account_id), pipelineId: String(row.pipeline_id), name: String(row.name),
    filters: (row.filters ?? {}) as Record<string, unknown>, sort: (row.sort ?? {}) as Record<string, unknown>,
    visibleFields: Array.isArray(row.visible_fields) ? row.visible_fields.map(String) : [], favorite: Boolean(row.is_favorite), position: Number(row.position ?? 0),
  }
}

export function mapSubPipeline(row: Row, memberships: Row[]): SubPipeline {
  return {
    id: String(row.id), accountId: String(row.account_id), pipelineId: String(row.pipeline_id), name: String(row.name), position: Number(row.position ?? 0),
    dealIds: memberships.filter((item) => item.sub_pipeline_id === row.id).sort((a, b) => Number(a.position) - Number(b.position)).map((item) => String(item.deal_id)),
  }
}

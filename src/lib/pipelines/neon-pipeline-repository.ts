import "server-only"

import { and, asc, desc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { contacts, deals, pipelineSavedViews, pipelines, pipelineStages, profiles, subPipelineDeals, subPipelines } from "@/lib/db/schema"
import type { NeonAccountContext } from "@/lib/neon/account"
import type { PipelineRecord, PipelineSnapshot } from "./domain"
import type { PipelineRepository } from "./pipeline-repository"

export class NeonPipelineRepository implements PipelineRepository {
  constructor(private readonly context: NeonAccountContext) {}

  async listPipelines(): Promise<PipelineRecord[]> {
    const rows = await db.select().from(pipelines)
      .where(eq(pipelines.accountId, this.context.accountId))
      .orderBy(asc(pipelines.position), asc(pipelines.createdAt))
    return rows.map((row) => ({ id: row.id, accountId: row.accountId, name: row.name, position: row.position }))
  }

  async getSnapshot(pipelineId?: string): Promise<PipelineSnapshot | null> {
    const allPipelines = await this.listPipelines()
    const pipeline = pipelineId ? allPipelines.find((item) => item.id === pipelineId) : allPipelines[0]
    if (!pipeline) return null
    const scopedPipeline = and(eq(pipelines.accountId, this.context.accountId), eq(pipelines.id, pipeline.id))
    const [verified] = await db.select({ id: pipelines.id }).from(pipelines).where(scopedPipeline).limit(1)
    if (!verified) return null

    const [stageRows, dealRows, viewRows, subRows, membershipRows, contactRows, memberRows] = await Promise.all([
      db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pipeline.id)).orderBy(asc(pipelineStages.position)),
      db.select().from(deals).where(and(eq(deals.accountId, this.context.accountId), eq(deals.pipelineId, pipeline.id))).orderBy(asc(deals.position), desc(deals.createdAt)),
      db.select().from(pipelineSavedViews).where(and(eq(pipelineSavedViews.accountId, this.context.accountId), eq(pipelineSavedViews.pipelineId, pipeline.id))).orderBy(asc(pipelineSavedViews.position)),
      db.select().from(subPipelines).where(and(eq(subPipelines.accountId, this.context.accountId), eq(subPipelines.pipelineId, pipeline.id))).orderBy(asc(subPipelines.position)),
      db.select().from(subPipelineDeals).where(eq(subPipelineDeals.accountId, this.context.accountId)).orderBy(asc(subPipelineDeals.position)),
      db.select().from(contacts).where(eq(contacts.accountId, this.context.accountId)).orderBy(asc(contacts.name)),
      db.select().from(profiles).where(eq(profiles.accountId, this.context.accountId)).orderBy(asc(profiles.fullName)),
    ])

    const contactMap = new Map(contactRows.map((row) => [row.id, row]))
    const memberMap = new Map(memberRows.map((row) => [row.id, row]))
    const mappedDeals = dealRows.map((row) => {
      const contact = row.contactId ? contactMap.get(row.contactId) : undefined
      const owner = row.assignedTo ? memberMap.get(row.assignedTo) : undefined
      return {
        id: row.id, accountId: row.accountId, pipelineId: row.pipelineId, stageId: row.stageId,
        contactId: row.contactId, assignedTo: row.assignedTo, title: row.title, value: Number(row.value),
        currency: row.currency ?? "USD", company: row.company ?? contact?.company ?? null,
        priority: row.priority as "low" | "normal" | "high" | "hot", probability: row.probability,
        source: row.leadSource, activity: row.lastActivity, nextStep: row.nextStep,
        description: row.description ?? row.notes, due: row.expectedCloseDate,
        status: (row.status ?? "open") as "open" | "won" | "lost", position: row.position,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        contact: contact ? { id: contact.id, name: contact.name ?? "Unknown contact", company: contact.company, email: contact.email, phone: contact.phone } : null,
        owner: owner ? { id: owner.id, userId: owner.userId, name: owner.fullName, email: owner.email, avatarUrl: owner.avatarUrl, role: owner.accountRole as "owner" | "admin" | "agent" | "viewer" } : null,
      }
    })
    const mappedSubs = subRows.map((row) => ({ id: row.id, accountId: row.accountId, pipelineId: row.pipelineId, name: row.name, position: row.position, dealIds: membershipRows.filter((item) => item.subPipelineId === row.id).map((item) => item.dealId) }))
    if (!mappedSubs.length) mappedSubs.push({ id: pipeline.id, accountId: this.context.accountId, pipelineId: pipeline.id, name: pipeline.name, position: 0, dealIds: mappedDeals.map((deal) => deal.id) })

    return {
      accountId: this.context.accountId, pipeline, pipelines: allPipelines,
      stages: stageRows.map((row, index) => ({ id: row.id, pipelineId: row.pipelineId, name: row.name, position: row.position, color: row.color, tone: (["blue", "cyan", "amber", "green", "red"] as const)[index % 5] })),
      deals: mappedDeals,
      savedViews: viewRows.map((row) => ({ id: row.id, accountId: row.accountId, pipelineId: row.pipelineId, name: row.name, filters: row.filters as Record<string, unknown>, sort: row.sort as Record<string, unknown>, visibleFields: row.visibleFields, favorite: row.isFavorite, position: row.position })),
      subPipelines: mappedSubs,
      contacts: contactRows.map((row) => ({ id: row.id, name: row.name ?? "Unknown contact", company: row.company, email: row.email, phone: row.phone })),
      members: memberRows.map((row) => ({ id: row.id, userId: row.userId, name: row.fullName, email: row.email, avatarUrl: row.avatarUrl, role: row.accountRole as "owner" | "admin" | "agent" | "viewer" })),
    }
  }
}

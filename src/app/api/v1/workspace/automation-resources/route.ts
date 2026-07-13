import { NextResponse } from "next/server"

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account"
import { getDataSource } from "@/lib/data/runtime"
import { demoStages } from "@/lib/demo/crm-data"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()
  if (source === "mock") {
    return NextResponse.json({ data: { tags: [{ id: "tag-vip", name: "VIP" }, { id: "tag-lead", name: "Lead" }], templates: [], customFields: [], pipelines: [{ id: "sales", name: "Sales Pipeline" }], stages: demoStages.map((stage, position) => ({ id: stage.id, name: stage.name, pipeline_id: "sales", position })), members: [] }, meta: { source } })
  }
  try {
    const context = await getCurrentAccount()
    const [tags, templates, customFields, pipelines, members] = await Promise.all([
      context.supabase.from("tags").select("*").eq("account_id", context.accountId).order("name"),
      context.supabase.from("message_templates").select("*").eq("account_id", context.accountId).eq("status", "APPROVED").order("name"),
      context.supabase.from("custom_fields").select("*").eq("account_id", context.accountId).order("field_name"),
      context.supabase.from("pipelines").select("id, name").eq("account_id", context.accountId).order("name"),
      context.supabase.from("profiles").select("user_id, full_name, email, avatar_url, account_role").eq("account_id", context.accountId).order("full_name"),
    ])
    const firstError = [tags.error, templates.error, customFields.error, pipelines.error, members.error].find(Boolean)
    if (firstError) throw firstError
    const pipelineIds = (pipelines.data ?? []).map((pipeline) => pipeline.id)
    const stages = pipelineIds.length
      ? await context.supabase.from("pipeline_stages").select("id, name, pipeline_id, position").in("pipeline_id", pipelineIds).order("position")
      : { data: [], error: null }
    if (stages.error) throw stages.error
    return NextResponse.json({ data: { tags: tags.data ?? [], templates: templates.data ?? [], customFields: customFields.data ?? [], pipelines: pipelines.data ?? [], stages: stages.data ?? [], members: members.data ?? [] }, meta: { source } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

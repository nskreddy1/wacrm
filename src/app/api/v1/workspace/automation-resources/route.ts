import { NextResponse } from "next/server"

import { getDataSource } from "@/lib/data/runtime"
import { demoStages } from "@/lib/demo/crm-data"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const source = getDataSource()
  if (source === "mock") {
    return NextResponse.json({ data: { tags: [{ id: "tag-vip", name: "VIP" }, { id: "tag-lead", name: "Lead" }], templates: [], customFields: [], pipelines: [{ id: "sales", name: "Sales Pipeline" }], stages: demoStages.map((stage, position) => ({ id: stage.id, name: stage.name, pipeline_id: "sales", position })), members: [] }, meta: { source } })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 })
  const [tags, templates, customFields, pipelines, stages] = await Promise.all([
    supabase.from("tags").select("*").order("name"),
    supabase.from("message_templates").select("*").eq("status", "APPROVED").order("name"),
    supabase.from("custom_fields").select("*").order("field_name"),
    supabase.from("pipelines").select("id, name").order("name"),
    supabase.from("pipeline_stages").select("id, name, pipeline_id, position").order("position"),
  ])
  return NextResponse.json({ data: { tags: tags.data ?? [], templates: templates.data ?? [], customFields: customFields.data ?? [], pipelines: pipelines.data ?? [], stages: stages.data ?? [], members: [] }, meta: { source } })
}

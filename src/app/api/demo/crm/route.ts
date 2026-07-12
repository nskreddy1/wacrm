import { NextResponse } from "next/server"
import { dashboardData, demoDeals, demoSession, demoStages } from "@/lib/demo/crm-data"

export async function GET() {
  return NextResponse.json({
    data: { session: demoSession, dashboard: dashboardData, pipeline: { stages: demoStages, deals: demoDeals } },
    meta: { source: "seeded-demo", generatedAt: new Date().toISOString() },
  })
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { dealId?: string; stageId?: string }
  if (!body.dealId || !body.stageId || !demoStages.some((stage) => stage.id === body.stageId)) {
    return NextResponse.json({ error: { code: "INVALID_MOVE", message: "A valid deal and stage are required." } }, { status: 400 })
  }
  return NextResponse.json({ data: { dealId: body.dealId, stageId: body.stageId, simulated: true } })
}

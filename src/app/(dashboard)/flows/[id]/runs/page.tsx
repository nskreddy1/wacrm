import { redirect } from "next/navigation"

export default async function LegacyFlowRunsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/automations/flows/${id}/runs`)
}

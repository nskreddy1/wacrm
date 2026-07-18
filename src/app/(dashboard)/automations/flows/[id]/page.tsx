"use client"

import { useParams, useRouter } from "next/navigation"
import useSWR from "swr"
import { RefreshCw } from "lucide-react"

import { FlowEditorShell } from "@/components/flows/flow-editor-shell"
import { FeatureLoading, FeatureState } from "@/components/ui/feature-state"
import type { FlowNodeRow, FlowRow } from "@/lib/flows/types"

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? "Could not load automation")
  return body
}

export default function UnifiedFlowEditorPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data, error, mutate } = useSWR<{ flow: FlowRow; nodes: FlowNodeRow[] }>(
    params.id ? `/api/flows/${params.id}` : null,
    fetcher,
  )

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <FeatureState
          icon={RefreshCw}
          title="Automation not available"
          description={error.message}
          action={{ label: "Retry", onClick: () => mutate() }}
          secondaryAction={
            <button
              type="button"
              className="text-sm font-medium text-primary hover:underline"
              onClick={() => router.push("/automations")}
            >
              Back to automations
            </button>
          }
        />
      </div>
    )
  }

  if (!data) return <FeatureLoading label="Loading automation builder" />

  return <FlowEditorShell initialFlow={data.flow} initialNodes={data.nodes ?? []} />
}

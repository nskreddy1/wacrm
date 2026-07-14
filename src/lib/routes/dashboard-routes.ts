import type { PipelineMode } from "@/lib/pipelines/domain"

export type ContactViewMode = "list" | "sheet" | "cards"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ENCODED_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export function isOpaqueId(value: string) {
  return UUID_PATTERN.test(value) || ENCODED_ID_PATTERN.test(value)
}

/**
 * Canonical pipelines URL. All state (pipeline, view mode, sub-pipeline,
 * saved view) is carried by query params on the clean `/pipelines` path.
 */
export function pipelinePath(_accountId: string, pipelineId: string, mode: PipelineMode = "board", state?: { subPipeline?: string; savedView?: string }) {
  const params = new URLSearchParams()
  if (pipelineId) params.set("pipeline", pipelineId)
  if (mode !== "board") params.set("view", mode)
  if (state?.subPipeline) params.set("sub_pipeline", state.subPipeline)
  if (state?.savedView) params.set("saved_view", state.savedView)
  const query = params.toString()
  return `/pipelines${query ? `?${query}` : ""}`
}

/**
 * Canonical contacts URL. All state (view mode, saved view, open contact)
 * is carried by query params on the clean `/contacts` path.
 */
export function contactsPath(_accountId?: string, state?: { mode?: ContactViewMode; view?: string; contact?: string }) {
  const params = new URLSearchParams()
  if (state?.mode && state.mode !== "list") params.set("mode", state.mode)
  if (state?.view && state.view !== "all") params.set("view", state.view)
  if (state?.contact) params.set("contact", state.contact)
  const query = params.toString()
  return `/contacts${query ? `?${query}` : ""}`
}

import type { PipelineMode } from "@/lib/pipelines/domain"

export type ContactViewMode = "list" | "sheet" | "cards"
export type DealViewMode = "kanban" | "list" | "sheet"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ENCODED_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isUuid(value: string) {
  return UUID_PATTERN.test(value)
}

export function isOpaqueId(value: string) {
  return UUID_PATTERN.test(value) || ENCODED_ID_PATTERN.test(value)
}

function segment(value: string) {
  return encodeURIComponent(value)
}

export function enterpriseHomePath(accountId: string) {
  return `/bigin/org/${segment(accountId)}/home`
}

export function enterpriseContactsPath(accountId: string, mode: ContactViewMode = "list", savedViewId = "all") {
  return `${enterpriseHomePath(accountId)}/contacts/${mode}/${segment(savedViewId)}`
}

export function enterpriseContactPath(accountId: string, contactId: string, state?: { view?: string; mode?: ContactViewMode }) {
  const params = new URLSearchParams()
  if (state?.view) params.set("view", state.view)
  if (state?.mode) params.set("mode", state.mode)
  const query = params.toString()
  return `${enterpriseHomePath(accountId)}/contacts/${segment(contactId)}${query ? `?${query}` : ""}`
}

function dealMode(mode: PipelineMode): DealViewMode {
  return mode === "board" ? "kanban" : mode
}

export function pipelineModeFromRoute(mode: string): PipelineMode | null {
  if (mode === "kanban" || mode === "board") return "board"
  if (mode === "list" || mode === "sheet") return mode
  return null
}

export function enterpriseDealsPath(accountId: string, pipelineId: string, mode: PipelineMode = "board", state?: { subPipeline?: string; savedView?: string }) {
  const savedViewId = state?.savedView ?? pipelineId
  const params = new URLSearchParams({ pipeline: pipelineId })
  if (state?.subPipeline) params.set("sub_pipeline", state.subPipeline)
  return `${enterpriseHomePath(accountId)}/deals/${dealMode(mode)}/${segment(savedViewId)}?${params.toString()}`
}

export function orgPath(accountId: string, module = "dashboard") {
  return `/org/${segment(accountId)}/${module}`
}

export function pipelinePath(_accountId: string, pipelineId: string, mode: PipelineMode = "board", state?: { subPipeline?: string; savedView?: string }) {
  const params = new URLSearchParams()
  if (pipelineId) params.set("pipeline", pipelineId)
  if (mode !== "board") params.set("view", mode)
  if (state?.subPipeline) params.set("sub_pipeline", state.subPipeline)
  if (state?.savedView) params.set("saved_view", state.savedView)
  const query = params.toString()
  return `/pipelines${query ? `?${query}` : ""}`
}

export function contactsPath(_accountId?: string, state?: { mode?: ContactViewMode; view?: string; contact?: string }) {
  const params = new URLSearchParams()
  if (state?.mode && state.mode !== "list") params.set("mode", state.mode)
  if (state?.view && state.view !== "all") params.set("view", state.view)
  if (state?.contact) params.set("contact", state.contact)
  const query = params.toString()
  return `/contacts${query ? `?${query}` : ""}`
}

export function accountIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:bigin\/)?org\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function isModulePath(pathname: string, module: string) {
  return pathname.includes(`/home/${module}/`) || pathname.includes(`/${module}/`) || pathname === `/${module}`
}

export function dashboardHref(_accountId: string | null, href: string) {
  return href
}

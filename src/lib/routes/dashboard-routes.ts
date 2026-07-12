import type { PipelineMode } from "@/lib/pipelines/domain"

export function orgPath(accountId: string, module = "dashboard") {
  return `/org/${encodeURIComponent(accountId)}/${module}`
}

export function pipelinePath(accountId: string, pipelineId: string, mode: PipelineMode = "board", state?: { subPipeline?: string; savedView?: string }) {
  const path = `${orgPath(accountId, "pipelines")}/${encodeURIComponent(pipelineId)}/${mode}`
  const params = new URLSearchParams()
  if (state?.subPipeline) params.set("subPipeline", state.subPipeline)
  if (state?.savedView) params.set("savedView", state.savedView)
  return params.size ? `${path}?${params}` : path
}

export function contactsPath(accountId: string) {
  return orgPath(accountId, "contacts/list")
}

export function accountIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/org\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function dashboardHref(accountId: string | null, href: string) {
  if (!accountId) return href
  if (href === "/pipelines") return orgPath(accountId, "pipelines")
  if (href === "/contacts") return contactsPath(accountId)
  return orgPath(accountId, href.replace(/^\//, ""))
}

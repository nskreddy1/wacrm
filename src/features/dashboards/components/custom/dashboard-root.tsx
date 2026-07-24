"use client"

// ============================================================
// Dashboard root — Zoho-style multi-dashboard shell.
//
// A switcher offers the built-in "Overview" (the existing
// DashboardWorkspace, untouched) plus the user's personal
// dashboards from /api/dashboards. Custom dashboards get a
// toolbar: Edit layout, rename, delete.
// ============================================================

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  Check,
  ChevronDown,
  LayoutDashboard,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { useDashboardOverview } from "@/features/dashboards/hooks/use-dashboard-overview"
import type { DashboardWidget } from "@/features/dashboards/lib/widgets"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { DashboardWorkspace } from "../dashboard-workspace"
import { Skeleton } from "../skeleton"
import { CustomDashboard } from "./custom-dashboard"

interface DashboardRow {
  id: string
  name: string
  widgets: DashboardWidget[]
  position: number
  created_at: string
  updated_at: string
}

const OVERVIEW_ID = "overview"

async function jsonFetcher(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error("Request failed")
  return res.json()
}

export function DashboardRoot() {
  const { data, isLoading, mutate } = useSWR<{ dashboards: DashboardRow[] }>(
    "/api/dashboards",
    jsonFetcher,
  )
  const dashboards = useMemo(() => data?.dashboards ?? [], [data])

  const [selectedId, setSelectedId] = useState<string>(OVERVIEW_ID)
  const [editing, setEditing] = useState(false)
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null)
  const [nameDraft, setNameDraft] = useState("")
  const [busy, setBusy] = useState(false)

  // Overview data is fetched once here and shared with custom
  // dashboards, so switching tabs is instant.
  const { overview, refresh } = useDashboardOverview()

  const selected = dashboards.find((d) => d.id === selectedId) ?? null
  const isOverview = selectedId === OVERVIEW_ID || !selected

  async function createDashboard() {
    const name = nameDraft.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? "Failed to create dashboard")
      await mutate()
      setSelectedId(body.dashboard.id as string)
      setEditing(true)
      setDialog(null)
      setNameDraft("")
      toast.success(`Dashboard "${name}" created`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create dashboard")
    } finally {
      setBusy(false)
    }
  }

  async function renameDashboard() {
    if (!selected) return
    const name = nameDraft.trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await fetch(`/api/dashboards/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error()
      await mutate()
      setDialog(null)
      setNameDraft("")
    } catch {
      toast.error("Failed to rename dashboard")
    } finally {
      setBusy(false)
    }
  }

  async function deleteDashboard() {
    if (!selected) return
    setBusy(true)
    try {
      const res = await fetch(`/api/dashboards/${selected.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setSelectedId(OVERVIEW_ID)
      setEditing(false)
      setDialog(null)
      await mutate()
      toast.success("Dashboard deleted")
    } catch {
      toast.error("Failed to delete dashboard")
    } finally {
      setBusy(false)
    }
  }

  /** Keep the SWR cache aligned with widgets saved by CustomDashboard. */
  function handleWidgetsSaved(widgets: DashboardWidget[]) {
    void mutate(
      (current) =>
        current
          ? {
              dashboards: current.dashboards.map((d) =>
                d.id === selectedId ? { ...d, widgets } : d,
              ),
            }
          : current,
      { revalidate: false },
    )
  }

  const switcher = (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" className="gap-1.5" />}
        >
          <LayoutDashboard className="size-4 text-primary" aria-hidden="true" />
          <span className="max-w-[180px] truncate">{isOverview ? "Overview" : selected.name}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Dashboards</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                setSelectedId(OVERVIEW_ID)
                setEditing(false)
              }}
            >
              <span className="flex-1 truncate">Overview</span>
              {isOverview && <Check className="size-4" aria-hidden="true" />}
            </DropdownMenuItem>
            {dashboards.map((d) => (
              <DropdownMenuItem
                key={d.id}
                onClick={() => {
                  setSelectedId(d.id)
                  setEditing(false)
                }}
              >
                <span className="flex-1 truncate">{d.name}</span>
                {selectedId === d.id && <Check className="size-4" aria-hidden="true" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setNameDraft("")
              setDialog("create")
            }}
          >
            <Plus className="size-4" aria-hidden="true" /> New dashboard
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {!isOverview && (
        <>
          <Button
            variant={editing ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? (
              <>
                <Check className="size-4" aria-hidden="true" /> Done
              </>
            ) : (
              <>
                <Pencil className="size-3.5" aria-hidden="true" /> Edit layout
              </>
            )}
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => refresh()}>
            <RotateCw className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Refresh data</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Dashboard actions"
                />
              }
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setNameDraft(selected.name)
                  setDialog("rename")
                }}
              >
                <Pencil className="size-4" aria-hidden="true" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
                <Trash2 className="size-4" aria-hidden="true" /> Delete dashboard
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Switcher bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2 sm:px-6 lg:px-8">
        {switcher}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1">
        {isOverview ? (
          <DashboardWorkspace />
        ) : (
          <div className="app-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain">
            <div className="mx-auto flex max-w-[1500px] flex-col p-4 sm:p-6 lg:p-8">
              {isLoading || !overview ? (
                <div className="grid grid-cols-12 gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton
                      key={i}
                      className={i < 4 ? "col-span-12 h-36 rounded-xl sm:col-span-6 xl:col-span-3" : "col-span-12 h-72 rounded-xl xl:col-span-6"}
                    />
                  ))}
                </div>
              ) : (
                <CustomDashboard
                  dashboardId={selected.id}
                  initialWidgets={selected.widgets}
                  editing={editing}
                  overview={overview}
                  refresh={refresh}
                  onWidgetsSaved={handleWidgetsSaved}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create / rename dialog */}
      <Dialog
        open={dialog === "create" || dialog === "rename"}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialog === "create" ? "New dashboard" : "Rename dashboard"}</DialogTitle>
            <DialogDescription>
              {dialog === "create"
                ? "Create a personal dashboard and add the components you need."
                : "Give this dashboard a new name."}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="e.g. Deals dashboard"
            maxLength={60}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault()
                void (dialog === "create" ? createDashboard() : renameDashboard())
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void (dialog === "create" ? createDashboard() : renameDashboard())}
              disabled={busy || !nameDraft.trim()}
            >
              {dialog === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete dashboard</DialogTitle>
            <DialogDescription>
              {`"${selected?.name ?? ""}" and its layout will be permanently removed. Your data is not affected.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteDashboard()} disabled={busy}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

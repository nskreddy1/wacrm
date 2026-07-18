"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Clock,
  Copy,
  FileText,
  Loader2,
  MessageCircle,
  MoreVertical,
  Pencil,
  PhoneCall,
  PlayCircle,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  Zap,
} from "lucide-react"

import type { Automation } from "@/types"
import { useCan } from "@/hooks/use-can"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import { formatRelative, triggerMeta } from "@/lib/automations/trigger-meta"
import { cn } from "@/lib/utils"
import { pageContainerClassName } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FeatureLoading, FeatureState } from "@/components/ui/feature-state"
import { GatedButton } from "@/components/ui/gated-button"
import { Switch } from "@/components/ui/switch"

const TEMPLATE_ORDER: TemplateSlug[] = [
  "welcome_message",
  "out_of_office",
  "lead_qualifier",
  "follow_up_reminder",
]

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  out_of_office: Clock,
  lead_qualifier: Users,
  follow_up_reminder: PhoneCall,
}

export default function AutomationsPage() {
  const router = useRouter()
  const canCreate = useCan("send-messages")
  const t = useTranslations("Automations.list")
  const [automations, setAutomations] = useState<Automation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setError(null)
    try {
      const response = await fetch("/api/automations", { cache: "no-store" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? "Failed to load automations")
      setAutomations((payload.automations ?? []) as Automation[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations")
    }
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch("/api/automations", { cache: "no-store" })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error ?? "Failed to load automations")
        if (!cancelled) setAutomations((payload.automations ?? []) as Automation[])
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load automations")
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  async function toggleActive(automation: Automation, next: boolean) {
    setAutomations((current) =>
      current?.map((item) =>
        item.id === automation.id ? { ...item, is_active: next } : item,
      ) ?? current,
    )
    const response = await fetch(`/api/automations/${automation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    })
    if (!response.ok) {
      setAutomations((current) =>
        current?.map((item) =>
          item.id === automation.id ? { ...item, is_active: !next } : item,
        ) ?? current,
      )
      const body = await response.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.updateError"))
      return
    }
    toast.success(next ? t("toasts.activated") : t("toasts.paused"))
  }

  async function duplicate(automation: Automation) {
    const response = await fetch(`/api/automations/${automation.id}/duplicate`, {
      method: "POST",
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.duplicateError"))
      return
    }
    toast.success(t("toasts.duplicated"))
    load()
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const response = await fetch(`/api/automations/${pendingDelete.id}`, {
      method: "DELETE",
    })
    setDeleting(false)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.deleteError"))
      return
    }
    toast.success(t("toasts.deleted"))
    setPendingDelete(null)
    load()
  }

  function startBlank() {
    setCreateOpen(false)
    router.push("/automations/new")
  }

  function startFromTemplate(slug: TemplateSlug) {
    setCreateOpen(false)
    router.push(`/automations/new?template=${slug}`)
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <FeatureState
          icon={RefreshCw}
          title="Automation workspace unavailable"
          description={`${error} Your rules have not been changed. Retry the secure connection to continue.`}
          action={{ label: t("retry"), onClick: load }}
        />
      </div>
    )
  }

  if (automations === null) return <FeatureLoading label="Loading automation rules" />

  return (
    <div className={cn(pageContainerClassName, "flex flex-col gap-6")}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create automations"
          onClick={() => setCreateOpen(true)}
        >
          <Plus data-icon="inline-start" />
          {t("create")}
        </GatedButton>
      </header>

      {automations.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} canCreate={canCreate} t={t} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              onToggle={(next) => toggleActive(automation, next)}
              onEdit={() => router.push(`/automations/${automation.id}/edit`)}
              onDuplicate={() => duplicate(automation)}
              onLogs={() => router.push(`/automations/${automation.id}/logs`)}
              onDelete={() => setPendingDelete(automation)}
              t={t}
            />
          ))}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-popover text-popover-foreground sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createDesc")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("startTemplate")}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATE_ORDER.map((slug) => {
                const template = AUTOMATION_TEMPLATES[slug]
                const Icon = TEMPLATE_ICON[slug]
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => startFromTemplate(slug)}
                    className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted active:scale-[0.99] motion-reduce:transform-none"
                  >
                    <Icon className="size-5 text-primary" aria-hidden />
                    <span className="text-sm font-semibold text-popover-foreground">
                      {template.name}
                    </span>
                    <span className="text-xs leading-relaxed text-muted-foreground">
                      {template.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("startBlank")}
            </p>
            <button
              type="button"
              onClick={startBlank}
              className="flex items-center gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted active:scale-[0.99] motion-reduce:transform-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                <Plus className="size-5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-semibold text-popover-foreground">
                  {t("blankTitle")}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {t("blankDesc")}
                </span>
              </span>
            </button>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDesc", { name: pendingDelete?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Trash2 data-icon="inline-start" />
              )}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmptyState({
  onCreate,
  canCreate,
  t,
}: {
  onCreate: () => void
  canCreate: boolean
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Zap className="size-6 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="mt-4 text-base font-medium text-foreground">{t("emptyTitle")}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{t("emptyDesc")}</p>
      <GatedButton
        canAct={canCreate}
        gateReason="create automations"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus data-icon="inline-start" />
        {t("createFirst")}
      </GatedButton>
    </div>
  )
}

function AutomationCard({
  automation,
  onToggle,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
  t,
}: {
  automation: Automation
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onLogs: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const meta = triggerMeta(automation.trigger_type)

  return (
    <li className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Zap className="size-4 shrink-0 text-primary" aria-hidden />
          <h2 className="truncate text-sm font-semibold text-foreground">{automation.name}</h2>
        </div>
        <Badge variant={automation.is_active ? "default" : "secondary"}>
          <PlayCircle data-icon="inline-start" />
          {automation.is_active ? t("statusActive") : t("statusPaused")}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 min-h-8 text-xs text-muted-foreground">
        {automation.description || meta.label}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant="outline">{meta.label}</Badge>
        <span className="tabular-nums">
          {automation.execution_count === 1
            ? t("runs", { count: automation.execution_count })
            : t("runsPlural", { count: automation.execution_count })}
        </span>
        <span aria-hidden>·</span>
        <span>{t("lastRun", { time: formatRelative(automation.last_executed_at) })}</span>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
        <Switch
          checked={automation.is_active}
          onCheckedChange={(value) => onToggle(!!value)}
          aria-label={automation.is_active ? t("deactivate") : t("activate")}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t("openMenu", { name: automation.name })}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted"
          >
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy />
                {t("duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogs}>
                <FileText />
                {t("viewLogs")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

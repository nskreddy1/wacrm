"use client"

import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Check, ChevronDown, Loader2, Pencil, Plus, Save, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/**
 * Generic record editor primitives, extracted from the Create Contact design.
 * Every "create / edit record" surface (contacts, deals, companies, products,
 * activities…) should compose these so the whole app shares one look.
 */

export function recordOwnerInitials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?"
}

// ---------------------------------------------------------------- RecordSheet
export function RecordSheet({ open, title, description, saving = false, readonly = false, isCreate = false, customizeLabel = "Customize Fields", children, onOpenChange, onSubmit, onCancel, onEdit, onCustomize }: {
  open: boolean
  title: string
  description?: string
  saving?: boolean
  readonly?: boolean
  isCreate?: boolean
  customizeLabel?: string
  children: ReactNode
  onOpenChange: (open: boolean) => void
  onSubmit: (event: FormEvent) => void
  onCancel?: () => void
  onEdit?: () => void
  onCustomize?: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-hidden bg-background p-0 data-[side=right]:sm:w-[min(720px,50vw)] data-[side=right]:sm:max-w-none">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="flex-row items-center border-b px-8 py-4 text-left">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-xl font-semibold tracking-tight">{title}</SheetTitle>
              <SheetDescription className="sr-only">{description ?? title}</SheetDescription>
            </div>
            {readonly && onEdit ? <Button type="button" variant="outline" size="sm" onClick={onEdit}><Pencil data-icon="inline-start" />Edit</Button> : null}
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-8 px-8 py-6">{children}</div>
          </ScrollArea>

          <SheetFooter className="flex-row items-center justify-between border-t bg-background px-8 py-3">
            {onCustomize ? <Button type="button" variant="link" className="h-auto px-0 text-primary" onClick={onCustomize}>{customizeLabel}</Button> : <span />}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" className="rounded-full px-6" onClick={onCancel ?? (() => onOpenChange(false))} disabled={saving}>Cancel</Button>
              {!readonly ? (
                <Button type="submit" className="rounded-full px-6" disabled={saving}>
                  {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : isCreate ? <Check data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  {saving ? "Saving" : "Save"}
                </Button>
              ) : null}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// -------------------------------------------------------------- RecordSection
export function RecordSection({ id, title, actions, children }: { id: string; title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6" aria-labelledby={`${id}-heading`}>
      <div className="flex items-center justify-between gap-4">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------- RecordField
export function RecordField({ label, labelSlot, htmlFor, error, children }: { label?: string; labelSlot?: ReactNode; htmlFor?: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      {labelSlot ?? <label htmlFor={htmlFor} className="text-sm font-medium sm:flex sm:w-36 sm:justify-end sm:text-right">{label}</label>}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {children}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------- RecordCollapsible
export function RecordCollapsible({ title, open, onOpenChange, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-2 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-safe:transition-transform motion-safe:duration-150">
        <span>{title}</span>
        <ChevronDown className="motion-safe:transition-transform motion-safe:duration-200 group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-safe:transition-[height,opacity] motion-safe:duration-200">
        <div className="flex flex-col gap-5 pt-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---------------------------------------------------------- RecordOwnerPicker
export function RecordOwnerPicker({ owners, value, currentUserId = "", disabled = false, onChange }: {
  owners: { userId: string; name: string }[]
  value: string
  currentUserId?: string
  disabled?: boolean
  onChange: (userId: string) => void
}) {
  const selected = owners.find((owner) => owner.userId === value) ?? null
  return (
    <div className="flex items-center gap-3 text-sm">
      <span id="record-owner-label">Owner</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<button type="button" aria-labelledby="record-owner-label" disabled={disabled} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-70" />}
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{recordOwnerInitials(selected?.name ?? "?")}</span>
          {selected?.name ?? "Unassigned"}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {owners.length === 0 ? <DropdownMenuItem disabled>No team members found</DropdownMenuItem> : owners.map((owner) => (
            <DropdownMenuItem key={owner.userId} onClick={() => onChange(owner.userId)}>
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{recordOwnerInitials(owner.name)}</span>
              <span className="flex-1 truncate">{owner.name}{owner.userId === currentUserId ? " (You)" : ""}</span>
              {owner.userId === value ? <Check className="size-4 text-primary" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// --------------------------------------------------------------- RecordLookup
// Bigin-style lookup: input-like trigger, search box, option list, optional
// "+ New X" quick-create row at the bottom.
export function RecordLookup({ id, value, options, placeholder = "", icon, createLabel, disabled = false, allowCustom = false, onSelect, onCreateNew }: {
  id?: string
  value: string | null
  options: { id: string; label: string; hint?: string }[]
  placeholder?: string
  icon?: ReactNode
  createLabel?: string
  disabled?: boolean
  /** When true, the typed search text can be used directly as the value (free-text lookups like Company). */
  allowCustom?: boolean
  onSelect: (id: string | null) => void
  onCreateNew?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selected = options.find((option) => option.id === value) ?? null
  // Free-text lookups show the raw value when it doesn't match an option
  const display = selected?.label ?? (allowCustom && value ? value : null)
  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return options
    return options.filter((option) => option.label.toLowerCase().includes(trimmed))
  }, [options, query])
  const trimmedQuery = query.trim()
  const exactMatch = options.some((option) => option.label.toLowerCase() === trimmedQuery.toLowerCase())

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery("") }}>
      <PopoverTrigger
        render={<button type="button" id={id} disabled={disabled} className={cn("flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-sm shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60", !selected && "text-muted-foreground")} />}
      >
        <span className="truncate">{display ?? placeholder}</span>
        {icon ?? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="h-9 pr-8" aria-label="Search options" />
            <Search className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto p-1" role="listbox" aria-label={placeholder || "Options"}>
          {value ? (
            <button type="button" className="flex w-full items-center rounded-sm px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted" onClick={() => { onSelect(null); setOpen(false) }}>
              Clear selection
            </button>
          ) : null}
          {allowCustom && trimmedQuery && !exactMatch ? (
            <button type="button" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-muted" onClick={() => { onSelect(trimmedQuery); setOpen(false) }}>
              <Plus className="size-4" aria-hidden="true" />Use &quot;{trimmedQuery}&quot;
            </button>
          ) : null}
          {filtered.length === 0 && !(allowCustom && trimmedQuery) ? <p className="px-3 py-2 text-sm text-muted-foreground">No matches found.</p> : filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              className={cn("flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-muted", option.id === value && "bg-muted/60 font-medium")}
              onClick={() => { onSelect(option.id); setOpen(false) }}
            >
              <span className="truncate">{option.label}</span>
              {option.hint ? <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span> : null}
            </button>
          ))}
        </div>
        {createLabel && onCreateNew ? (
          <div className="border-t p-1">
            <button type="button" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-muted" onClick={() => { setOpen(false); onCreateNew() }}>
              <Plus className="size-4" aria-hidden="true" />{createLabel}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------- QuickCreateDialog
// Bigin's "Quick Create: X" centered modal used from within another editor.
export function QuickCreateDialog({ open, entity, saving = false, children, onOpenChange, onSubmit, onCustomize }: {
  open: boolean
  entity: string
  saving?: boolean
  children: ReactNode
  onOpenChange: (open: boolean) => void
  onSubmit: (event: FormEvent) => void
  onCustomize?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <form onSubmit={(event) => { event.stopPropagation(); onSubmit(event) }} className="flex flex-col">
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="text-lg font-semibold">Quick Create: {entity}</DialogTitle>
            <DialogDescription className="sr-only">Quickly create a {entity.toLowerCase()} without leaving this form</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5 px-6 py-6">{children}</div>
          <DialogFooter className="flex-row items-center justify-between border-t px-6 py-3">
            {onCustomize ? <Button type="button" variant="link" className="h-auto px-0 text-primary" onClick={onCustomize}>Customize Fields</Button> : <span />}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" className="rounded-full px-6" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" className="rounded-full px-6" disabled={saving}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}{saving ? "Saving" : "Save"}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

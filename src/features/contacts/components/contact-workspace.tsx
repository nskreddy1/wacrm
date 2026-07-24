"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Filter, Grid2X2, List, MoreHorizontal, Pencil, RefreshCw, Search, SheetIcon, SlidersHorizontal, Trash2, Upload, UserPlus, Users, X } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ContactField, WorkspaceContact } from "@/lib/data/contacts/types"
import { cn } from "@/lib/utils"
import { sheetTable } from "@/components/shared/sheet-table"
import { contactsPath, type ContactViewMode } from "@/lib/routes/dashboard-routes"
import { ContactFilterBuilder } from "@/features/contacts/components/contact-filter-builder"
import { ContactRecordSheet, type ContactSheetState } from "@/features/contacts/components/contact-record-sheet"
import { CustomFieldsManager } from "@/features/contacts/components/custom-fields-manager"
import { ImportModal } from "@/features/contacts/components/import-modal"
import { FeatureLoading, FeatureState } from "@/components/ui/feature-state"
import { countRules, emptyFilterGroup, flattenRules, matchesFilter, summarizeRule, type FilterGroup } from "@/lib/data/contacts/filters"
import { downloadCsv } from "@/lib/download-csv"

type Store = {
  contacts: WorkspaceContact[]
  fields: ContactField[]
  preferences: { visible: string[]; order: string[]; frozen: string[]; widths: Record<string, number> }
  owners?: { userId: string; name: string; avatarUrl: string | null }[]
  currentUserId?: string
}
type View = ContactViewMode
type Sort = { field: string; direction: "asc" | "desc" } | null
async function api(method: string, body: unknown) {
  const response = await fetch("/api/v1/workspace/contacts", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message ?? "Request failed")
  return payload.data
}

function valueText(value: WorkspaceContact["values"][string]) {
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return String(value ?? "")
}

export function ContactWorkspace({ initialView = "list", savedViewId = "all", initialContactId }: { initialView?: View; savedViewId?: string; initialContactId?: string }) {
  const router = useRouter()
  const { data, error, isLoading, mutate } = useSWR<{ data: Store }>(`/api/v1/workspace/contacts?view=${encodeURIComponent(savedViewId)}&mode=${initialView}`)
  const store = data?.data
  const view = initialView
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>({ field: "name", direction: "asc" })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [detailDismissed, setDetailDismissed] = useState(false)
  const detail = !detailDismissed ? (store?.contacts.find((contact) => contact.id === initialContactId) ?? null) : null
  const [contactSheet, setContactSheet] = useState<ContactSheetState>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [fieldsManagerOpen, setFieldsManagerOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<FilterGroup>(() => emptyFilterGroup())
  const [visibleFieldIds, setVisibleFieldIds] = useState<string[]>([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (store && visibleFieldIds.length === 0) setVisibleFieldIds(store.preferences.visible)
  }, [store, visibleFieldIds.length])

  // Open the record sheet client-side; update the URL shallowly so the link
  // stays shareable without triggering a full server page render.
  function openContact(contact: WorkspaceContact) {
    setContactSheet({ mode: "view", contact })
    window.history.pushState(null, "", contactsPath(undefined, { contact: contact.id, view: savedViewId, mode: view }))
  }

  const orderedFields = useMemo(() => {
    if (!store) return []
    const byId = new Map(store.fields.map((field) => [field.id, field]))
    return store.preferences.order.map((id) => byId.get(id)).filter(Boolean) as ContactField[]
  }, [store])
  const visibleFields = orderedFields.filter((field) => visibleFieldIds.includes(field.id))
  const filtered = useMemo(() => {
    if (!store) return []
    const term = query.trim().toLowerCase()
    const searched = term ? store.contacts.filter((contact) => Object.values(contact.values).some((value) => valueText(value).toLowerCase().includes(term))) : [...store.contacts]
    const rows = searched.filter((contact) => matchesFilter(contact, store.fields, filters))
    if (sort) rows.sort((a, b) => valueText(a.values[sort.field]).localeCompare(valueText(b.values[sort.field]), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1))
    return rows
  }, [store, query, sort, filters])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const rows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const allSelected = rows.length > 0 && rows.every((contact) => selected.has(contact.id))
  const hasRefinements = Boolean(query.trim()) || countRules(filters) > 0
  const showPagination = filtered.length > 10

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  function toggleSelected(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  function toggleCurrentPage() {
    setSelected((current) => {
      const next = new Set(current)
      for (const contact of rows) {
        if (allSelected) next.delete(contact.id)
        else next.add(contact.id)
      }
      return next
    })
  }
  function cycleSort(field: string) { setSort((current) => !current || current.field !== field ? { field, direction: "asc" } : current.direction === "asc" ? { field, direction: "desc" } : null) }

  async function saveCell(contact: WorkspaceContact, field: ContactField, raw: string | boolean) {
    let value: string | number | boolean = raw
    if (field.type === "number" || field.type === "currency") value = Number(raw) || 0
    setSaving(`${contact.id}:${field.id}`)
    const previous = data
    await mutate({ data: { ...store!, contacts: store!.contacts.map((item) => item.id === contact.id ? { ...item, values: { ...item.values, [field.id]: value } } : item) } }, false)
    try { await api("PATCH", { id: contact.id, values: { [field.id]: value } }); await mutate() }
    catch (saveError) { await mutate(previous, false); toast.error(saveError instanceof Error ? saveError.message : "Unable to save") }
    finally { setSaving(null); setEditing(null) }
  }

  async function deleteSelected() {
    setDeleting(true)
    try {
      await api("DELETE", { ids: [...selected] })
      const deletedCount = selected.size
      setSelected(new Set())
      setConfirmBulkDelete(false)
      await mutate()
      toast.success(`${deletedCount} ${deletedCount === 1 ? "contact" : "contacts"} deleted`)
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Unable to delete contacts")
    } finally {
      setDeleting(false)
    }
  }
  function exportCurrentResults() {
    const exported = downloadCsv("contacts-current-results.csv", [visibleFields.map((field) => field.label), ...filtered.map((contact) => visibleFields.map((field) => valueText(contact.values[field.id])))])
    if (exported) toast.success(`Exported ${filtered.length} ${filtered.length === 1 ? "contact" : "contacts"}`)
  }
  async function setVisible(fieldId: string, checked: boolean) {
    const previous = visibleFieldIds
    const visible = checked ? Array.from(new Set([...visibleFieldIds, fieldId])) : visibleFieldIds.filter((id) => id !== fieldId)
    setVisibleFieldIds(visible)
    try { await api("PATCH", { kind: "preferences", preferences: { visible } }) }
    catch (preferenceError) { setVisibleFieldIds(previous); toast.error(preferenceError instanceof Error ? preferenceError.message : "Unable to update displayed columns") }
  }
  async function showAllFields() {
    const previous = visibleFieldIds
    const visible = orderedFields.map((field) => field.id)
    setVisibleFieldIds(visible)
    try { await api("PATCH", { kind: "preferences", preferences: { visible } }) }
    catch (preferenceError) { setVisibleFieldIds(previous); toast.error(preferenceError instanceof Error ? preferenceError.message : "Unable to show all columns") }
  }

  if (error) return <div className="flex min-h-[60vh] items-center justify-center p-6"><FeatureState icon={RefreshCw} title="Contact workspace unavailable" description="We couldn't securely load this account's contacts. No records were changed; retry the request to reconnect." action={{ label: "Retry", onClick: () => void mutate() }} /></div>
  if (isLoading || !store) return <div className="p-6"><FeatureLoading label="Loading enterprise contacts" /></div>

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Search contacts" aria-label="Search contacts" className="pl-8 pr-8" />
          {query && <Button variant="ghost" size="icon-xs" className="absolute right-1.5 top-1/2 -translate-y-1/2" onClick={() => { setQuery(""); setPage(0) }} aria-label="Clear contact search"><X /></Button>}
        </div>
        <Button variant={countRules(filters) ? "secondary" : "outline"} size="sm" onClick={() => setFilterOpen(true)}><Filter data-icon="inline-start" /> Filter{countRules(filters) > 0 && <Badge variant="secondary">{countRules(filters)}</Badge>}</Button>
        <Tabs value={view} onValueChange={(value) => router.replace(contactsPath(undefined, { mode: value as View, view: savedViewId }))}><TabsList aria-label="Contact view"><TabsTrigger value="list" aria-label="List view" title="List view"><List /></TabsTrigger><TabsTrigger value="sheet" aria-label="Editable sheet view" title="Editable sheet view"><SheetIcon /></TabsTrigger><TabsTrigger value="cards" aria-label="Card view" title="Card view"><Grid2X2 /></TabsTrigger></TabsList></Tabs>
        <Popover><PopoverTrigger render={<Button variant="outline" size="sm" aria-label="Choose displayed columns" />}><Columns3 data-icon="inline-start" /> <span className="hidden md:inline">Columns</span></PopoverTrigger><PopoverContent align="end" className="w-80 p-0"><div className="flex items-center justify-between p-3"><div><p className="font-medium">Displayed columns</p><p className="text-xs text-muted-foreground">Personal display preference · {visibleFields.length} of {orderedFields.length}</p></div><Button variant="ghost" size="sm" disabled={visibleFields.length === orderedFields.length} onClick={showAllFields}>Show all</Button></div><Separator /><ScrollArea className="h-72"><div className="flex flex-col gap-1 p-2">{orderedFields.map((field) => <label key={field.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"><Checkbox checked={visibleFieldIds.includes(field.id)} disabled={field.id === "name"} onCheckedChange={(checked) => setVisible(field.id, Boolean(checked))} /><span className="flex-1 text-sm">{field.label}</span><Badge variant="secondary">{field.type.replace("_", " ")}</Badge></label>)}</div></ScrollArea><Separator /><p className="p-3 text-xs text-muted-foreground">Name is required and always displayed. Manage the field schema from More actions.</p></PopoverContent></Popover>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More contact actions" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64"><DropdownMenuGroup><p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Data</p><DropdownMenuItem onClick={() => setImportOpen(true)}><Upload /> Import CSV</DropdownMenuItem><DropdownMenuItem disabled={filtered.length === 0 || visibleFields.length === 0} onClick={exportCurrentResults}><Download /> Export current results<span className="ml-auto text-xs text-muted-foreground">{filtered.length}</span></DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Workspace setup</p><DropdownMenuItem onClick={() => setFieldsManagerOpen(true)}><SlidersHorizontal /> Manage custom fields</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
        <Button size="sm" className="ml-auto shadow-xs sm:ml-0" onClick={() => setContactSheet({ mode: "create" })}><UserPlus data-icon="inline-start" /> Create contact</Button>
      </div>

      {countRules(filters) > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2"><span className="text-xs font-medium text-muted-foreground">Active filters</span>{flattenRules(filters).map((rule) => <Badge key={rule.id} variant="outline" className="gap-1 bg-background">{summarizeRule(rule, store.fields)}</Badge>)}<Button variant="ghost" size="sm" onClick={() => setFilterOpen(true)}>Edit</Button><Button variant="ghost" size="sm" onClick={() => { setFilters(emptyFilterGroup()); setPage(0) }}>Clear all</Button></div>}

      {selected.size > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-2 text-sm"><strong>{selected.size} selected</strong><span className="hidden text-muted-foreground sm:inline">Bulk actions apply only to selected contacts.</span><Button variant="destructive" size="sm" className="ml-auto" onClick={() => setConfirmBulkDelete(true)}><Trash2 data-icon="inline-start" /> Delete selected</Button><Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}><X data-icon="inline-start" /> Clear selection</Button></div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {(view === "list" || view === "sheet") && <table className={sheetTable.table}><thead className={sheetTable.thead}><tr><th className={cn(sheetTable.th, "w-12 p-3")}><Checkbox checked={allSelected} onCheckedChange={toggleCurrentPage} aria-label={allSelected ? "Deselect contacts on this page" : "Select contacts on this page"} /></th>{visibleFields.map((field) => <th key={field.id} style={{ minWidth: store.preferences.widths[field.id] ?? field.width }} className={sheetTable.th}><button className="flex w-full items-center gap-2" onClick={() => cycleSort(field.id)}>{field.label}{sort?.field === field.id && (sort.direction === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}</button></th>)}<th className={cn(sheetTable.th, "w-12 border-r-0 p-2")}><span className="sr-only">Row actions</span></th></tr></thead><tbody>{rows.map((contact) => <tr key={contact.id} className={cn(sheetTable.row, selected.has(contact.id) && sheetTable.rowSelected)}><td className={cn(sheetTable.td, "p-3")}><Checkbox checked={selected.has(contact.id)} onCheckedChange={() => toggleSelected(contact.id)} aria-label={`Select ${valueText(contact.values.name)}`} /></td>{visibleFields.map((field) => { const active = editing?.id === contact.id && editing.field === field.id; const saveKey = `${contact.id}:${field.id}`; return <td key={field.id} className={sheetTable.tdFlush} onDoubleClick={() => view === "sheet" && !field.readOnly && setEditing({ id: contact.id, field: field.id })}>{active ? field.type === "single_select" ? <select autoFocus defaultValue={valueText(contact.values[field.id])} onBlur={(event) => saveCell(contact, field, event.target.value)} onChange={(event) => saveCell(contact, field, event.target.value)} className="h-10 w-full bg-background px-3 outline-none">{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <Input autoFocus defaultValue={valueText(contact.values[field.id])} onBlur={(event) => saveCell(contact, field, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Tab") saveCell(contact, field, event.currentTarget.value); if (event.key === "Escape") setEditing(null) }} className="h-10 rounded-none border-0 ring-inset" /> : <button className={cn("flex h-10 w-full items-center px-3 text-left", view === "sheet" && "cursor-cell", field.id === "name" && "font-medium text-primary")} onClick={() => view === "list" ? openContact(contact) : setEditing({ id: contact.id, field: field.id })}>{saving === saveKey ? "Saving…" : field.type === "currency" ? `$${Number(contact.values[field.id] ?? 0).toLocaleString()}` : valueText(contact.values[field.id]) || "—"}</button>}</td>})}<td className={cn(sheetTable.td, "border-r-0 p-1")}><Button variant="ghost" size="icon-sm" onClick={() => setContactSheet({ mode: "view", contact })} aria-label="Open contact"><MoreHorizontal /></Button></td></tr>)}</tbody></table>}

        {view === "cards" && <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((contact) => <article key={contact.id} className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs"><div className="flex items-start gap-3"><Checkbox checked={selected.has(contact.id)} onCheckedChange={() => toggleSelected(contact.id)} aria-label={`Select ${valueText(contact.values.name)}`} /><Avatar><AvatarFallback>{valueText(contact.values.name).split(" ").map((part) => part[0]).slice(0, 2).join("")}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><button className="truncate font-semibold hover:text-primary" onClick={() => setContactSheet({ mode: "view", contact })}>{valueText(contact.values.name)}</button><p className="truncate text-sm text-muted-foreground">{valueText(contact.values.company)}</p></div><Button variant="ghost" size="icon-sm" title="Edit contact" aria-label={`Edit ${valueText(contact.values.name)}`} onClick={() => setContactSheet({ mode: "edit", contact })}><Pencil /></Button></div><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Email</p><p className="truncate">{valueText(contact.values.email)}</p></div><div><p className="text-xs text-muted-foreground">Phone</p><p>{valueText(contact.values.phone)}</p></div><div><p className="text-xs text-muted-foreground">Location</p><p>{valueText(contact.values.city)}</p></div><div><p className="text-xs text-muted-foreground">Value</p><p>${Number(contact.values.value ?? 0).toLocaleString()}</p></div></div></article>)}</div>}
        {filtered.length === 0 && <div className="flex min-h-80 items-center justify-center p-6"><FeatureState icon={hasRefinements ? Search : Users} title={hasRefinements ? "No contacts match" : "No contacts yet"} description={hasRefinements ? "Clear search or filters to broaden these results." : "Create a contact now, or import a CSV when you have an existing list."} action={{ label: hasRefinements ? "Clear search and filters" : "Create contact", onClick: () => { if (hasRefinements) { setQuery(""); setFilters(emptyFilterGroup()); setPage(0) } else setContactSheet({ mode: "create" }) } }} /></div>}
      </div>

      <footer className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-t bg-card px-4 py-2 text-xs shadow-xs"><span aria-live="polite">{hasRefinements ? "Matching contacts" : "Total contacts"} <strong>{filtered.length}</strong></span>{showPagination && <><label className="ml-auto" htmlFor="contacts-page-size">Rows per page</label><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(0) }}><SelectTrigger id="contacts-page-size" size="sm" aria-label="Rows per page"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[10,20,50,100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectGroup></SelectContent></Select><span aria-live="polite">{safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} of {filtered.length}</span><Button variant="ghost" size="icon-sm" disabled={safePage === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} aria-label="Previous page"><ChevronLeft /></Button><Button variant="ghost" size="icon-sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))} aria-label="Next page"><ChevronRight /></Button></>}</footer>

      {filterOpen && <ContactFilterBuilder open={filterOpen} fields={orderedFields} value={filters} onOpenChange={setFilterOpen} onApply={(value) => { setFilters(value); setPage(0) }} onClear={() => { setFilters(emptyFilterGroup()); setPage(0) }} />}
      <ContactRecordSheet state={contactSheet ?? (detail ? { mode: "view", contact: detail } : null)} fields={orderedFields} preferences={store.preferences} owners={store.owners ?? []} currentUserId={store.currentUserId ?? ""} onOpenChange={(open) => { if (!open) { setContactSheet(null); setDetailDismissed(true); if (window.location.search.includes("contact=")) window.history.replaceState(null, "", contactsPath(undefined, { mode: view, view: savedViewId })) } }} onSaved={() => mutate()} />
      <ImportModal open={importOpen} onOpenChange={setImportOpen} onImported={() => void mutate()} />
      <CustomFieldsManager open={fieldsManagerOpen} onOpenChange={(open) => { setFieldsManagerOpen(open); if (!open) void mutate() }} />
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogMedia><Trash2 /></AlertDialogMedia><AlertDialogTitle>Delete {selected.size} {selected.size === 1 ? "contact" : "contacts"}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the selected records. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleting} onClick={() => void deleteSelected()}>{deleting ? "Deleting…" : "Delete contacts"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

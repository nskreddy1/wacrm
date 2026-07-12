"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Filter, Grid2X2, List, MoreHorizontal, Plus, Search, SheetIcon, SlidersHorizontal, Trash2, Upload, X } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ContactField, DemoContact, FieldType } from "@/lib/demo/contact-repository"
import { cn } from "@/lib/utils"
import { ContactFilterBuilder } from "@/components/contacts/contact-filter-builder"
import { countRules, emptyFilterGroup, flattenRules, matchesFilter, summarizeRule, type FilterGroup } from "@/lib/demo/contact-filters"

type Store = { contacts: DemoContact[]; fields: ContactField[]; preferences: { visible: string[]; order: string[]; frozen: string[]; widths: Record<string, number> } }
type View = "list" | "sheet" | "cards"
type Sort = { field: string; direction: "asc" | "desc" } | null
const fetcher = (url: string) => fetch(url).then(async (response) => { if (!response.ok) throw new Error("Unable to load contacts"); return response.json() })

async function api(method: string, body: unknown) {
  const response = await fetch("/api/demo/contacts", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message ?? "Request failed")
  return payload.data
}

function valueText(value: DemoContact["values"][string]) {
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return String(value ?? "")
}

export function ContactWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<{ data: Store }>("/api/demo/contacts", fetcher)
  const store = data?.data
  const [view, setView] = useState<View>("list")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>({ field: "name", direction: "asc" })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [detail, setDetail] = useState<DemoContact | null>(null)
  const [contactOpen, setContactOpen] = useState(false)
  const [fieldOpen, setFieldOpen] = useState(false)
  const [newContact, setNewContact] = useState({ name: "", email: "", phone: "", company: "" })
  const [newField, setNewField] = useState<{ label: string; type: FieldType; options: string }>({ label: "", type: "text", options: "" })
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<FilterGroup>(() => emptyFilterGroup())

  const orderedFields = useMemo(() => {
    if (!store) return []
    const byId = new Map(store.fields.map((field) => [field.id, field]))
    return store.preferences.order.map((id) => byId.get(id)).filter(Boolean) as ContactField[]
  }, [store])
  const visibleFields = orderedFields.filter((field) => store?.preferences.visible.includes(field.id))
  const filtered = useMemo(() => {
    if (!store) return []
    const term = query.trim().toLowerCase()
    const searched = term ? store.contacts.filter((contact) => Object.values(contact.values).some((value) => valueText(value).toLowerCase().includes(term))) : [...store.contacts]
    const rows = searched.filter((contact) => matchesFilter(contact, store.fields, filters))
    if (sort) rows.sort((a, b) => valueText(a.values[sort.field]).localeCompare(valueText(b.values[sort.field]), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1))
    return rows
  }, [store, query, sort, filters])
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const rows = filtered.slice(page * pageSize, page * pageSize + pageSize)
  const allSelected = rows.length > 0 && rows.every((contact) => selected.has(contact.id))

  function toggleSelected(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  function cycleSort(field: string) { setSort((current) => !current || current.field !== field ? { field, direction: "asc" } : current.direction === "asc" ? { field, direction: "desc" } : null) }

  async function saveCell(contact: DemoContact, field: ContactField, raw: string | boolean) {
    let value: string | number | boolean = raw
    if (field.type === "number" || field.type === "currency") value = Number(raw) || 0
    setSaving(`${contact.id}:${field.id}`)
    const previous = data
    await mutate({ data: { ...store!, contacts: store!.contacts.map((item) => item.id === contact.id ? { ...item, values: { ...item.values, [field.id]: value } } : item) } }, false)
    try { await api("PATCH", { id: contact.id, values: { [field.id]: value } }); await mutate() }
    catch (saveError) { await mutate(previous, false); toast.error(saveError instanceof Error ? saveError.message : "Unable to save") }
    finally { setSaving(null); setEditing(null) }
  }

  async function addContact() {
    try { await api("POST", { values: newContact }); setContactOpen(false); setNewContact({ name: "", email: "", phone: "", company: "" }); await mutate(); toast.success("Contact created") }
    catch (createError) { toast.error(createError instanceof Error ? createError.message : "Unable to create contact") }
  }
  async function addField() {
    if (!newField.label.trim()) return
    try { await api("POST", { kind: "field", field: { label: newField.label, type: newField.type, options: newField.options.split(",").map((item) => item.trim()).filter(Boolean) } }); setFieldOpen(false); setNewField({ label: "", type: "text", options: "" }); await mutate(); toast.success("Field created") }
    catch (fieldError) { toast.error(fieldError instanceof Error ? fieldError.message : "Unable to create field") }
  }
  async function deleteSelected() { await api("DELETE", { ids: [...selected] }); setSelected(new Set()); await mutate(); toast.success("Contacts deleted") }
  async function setVisible(fieldId: string, checked: boolean) {
    if (!store) return
    const visible = checked ? Array.from(new Set([...store.preferences.visible, fieldId])) : store.preferences.visible.filter((id) => id !== fieldId)
    await mutate({ data: { ...store, preferences: { ...store.preferences, visible } } }, false)
    await api("PATCH", { kind: "preferences", preferences: { visible } })
  }
  async function showAllFields() {
    if (!store) return
    const visible = orderedFields.map((field) => field.id)
    await mutate({ data: { ...store, preferences: { ...store.preferences, visible } } }, false)
    await api("PATCH", { kind: "preferences", preferences: { visible } })
  }

  if (error) return <div className="flex min-h-96 items-center justify-center text-sm text-destructive">Unable to load the contact workspace.</div>
  if (isLoading || !store) return <div className="flex min-h-96 items-center justify-center text-sm text-muted-foreground">Loading enterprise contacts…</div>

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
        <Button variant={countRules(filters) ? "secondary" : "outline"} size="sm" onClick={() => setFilterOpen(true)}><Filter data-icon="inline-start" /> Filter{countRules(filters) > 0 && <Badge variant="secondary">{countRules(filters)}</Badge>}</Button>
        <Select defaultValue="all"><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All contacts</SelectItem><SelectItem value="customers">Customers</SelectItem><SelectItem value="leads">Open leads</SelectItem></SelectGroup></SelectContent></Select>
        <div className="relative min-w-48 flex-1 sm:max-w-sm"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Search all fields" className="pl-8" /></div>
        <Tabs value={view} onValueChange={(value) => setView(value as View)}><TabsList><TabsTrigger value="list" aria-label="List view"><List /></TabsTrigger><TabsTrigger value="sheet" aria-label="Sheet view"><SheetIcon /></TabsTrigger><TabsTrigger value="cards" aria-label="Cards view"><Grid2X2 /></TabsTrigger></TabsList></Tabs>
        <Popover><PopoverTrigger render={<Button variant="outline" size="icon-sm" aria-label="Displayed columns" />}><Columns3 /></PopoverTrigger><PopoverContent align="end" className="w-80 p-0"><div className="flex items-center justify-between p-3"><div><p className="font-medium">Displayed columns</p><p className="text-xs text-muted-foreground">{visibleFields.length} of {orderedFields.length} visible</p></div><Button variant="ghost" size="sm" onClick={showAllFields}>Show all</Button></div><Separator /><ScrollArea className="h-72"><div className="flex flex-col gap-1 p-2">{orderedFields.map((field) => <label key={field.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"><Checkbox checked={store.preferences.visible.includes(field.id)} disabled={field.id === "name"} onCheckedChange={(checked) => setVisible(field.id, Boolean(checked))} /><span className="flex-1 text-sm">{field.label}</span><Badge variant="secondary">{field.type.replace("_", " ")}</Badge></label>)}</div></ScrollArea><Separator /><div className="p-2"><Button variant="outline" className="w-full" onClick={() => setFieldOpen(true)}><Plus data-icon="inline-start" /> Create field</Button></div></PopoverContent></Popover>
        <Button size="sm" onClick={() => setContactOpen(true)}><Plus data-icon="inline-start" /> Contact</Button>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More contact actions" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem><Upload /> Import CSV</DropdownMenuItem><DropdownMenuItem onClick={() => { const csv = [visibleFields.map((f) => f.label), ...filtered.map((c) => visibleFields.map((f) => valueText(c.values[f.id])))].map((r) => r.join(",")).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "contacts.csv"; a.click() }}><Download /> Export CSV</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setFieldOpen(true)}><SlidersHorizontal /> Manage fields</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>

      {countRules(filters) > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2"><span className="text-xs font-medium text-muted-foreground">Active filters</span>{flattenRules(filters).map((rule) => <Badge key={rule.id} variant="outline" className="gap-1 bg-background">{summarizeRule(rule, store.fields)}</Badge>)}<Button variant="ghost" size="sm" onClick={() => setFilterOpen(true)}>Edit</Button><Button variant="ghost" size="sm" onClick={() => { setFilters(emptyFilterGroup()); setPage(0) }}>Clear all</Button></div>}

      {selected.size > 0 && <div className="flex items-center gap-2 border-b bg-muted px-3 py-2 text-sm"><strong>{selected.size} selected</strong><Button variant="destructive" size="sm" onClick={deleteSelected}><Trash2 data-icon="inline-start" /> Delete</Button><Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}><X data-icon="inline-start" /> Clear</Button></div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {(view === "list" || view === "sheet") && <table className="min-w-full border-separate border-spacing-0 text-sm"><thead className="sticky top-0 z-10 bg-card"><tr><th className="w-12 border-b border-r p-3"><Checkbox checked={allSelected} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))} aria-label="Select all visible contacts" /></th>{visibleFields.map((field) => <th key={field.id} style={{ minWidth: store.preferences.widths[field.id] ?? field.width }} className="border-b border-r px-3 py-2 text-left font-medium"><button className="flex w-full items-center gap-2" onClick={() => cycleSort(field.id)}>{field.label}{sort?.field === field.id && (sort.direction === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}</button></th>)}<th className="w-12 border-b p-2"><Button variant="ghost" size="icon-sm" onClick={() => setFieldOpen(true)} aria-label="Create field"><Plus /></Button></th></tr></thead><tbody>{rows.map((contact) => <tr key={contact.id} className={cn("group hover:bg-muted/40", selected.has(contact.id) && "bg-muted/60")}><td className="border-b border-r p-3"><Checkbox checked={selected.has(contact.id)} onCheckedChange={() => toggleSelected(contact.id)} aria-label={`Select ${valueText(contact.values.name)}`} /></td>{visibleFields.map((field) => { const active = editing?.id === contact.id && editing.field === field.id; const saveKey = `${contact.id}:${field.id}`; return <td key={field.id} className="border-b border-r p-0" onDoubleClick={() => view === "sheet" && !field.readOnly && setEditing({ id: contact.id, field: field.id })}>{active ? field.type === "single_select" ? <select autoFocus defaultValue={valueText(contact.values[field.id])} onBlur={(event) => saveCell(contact, field, event.target.value)} onChange={(event) => saveCell(contact, field, event.target.value)} className="h-10 w-full bg-background px-3 outline-none">{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <Input autoFocus defaultValue={valueText(contact.values[field.id])} onBlur={(event) => saveCell(contact, field, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Tab") saveCell(contact, field, event.currentTarget.value); if (event.key === "Escape") setEditing(null) }} className="h-10 rounded-none border-0 ring-inset" /> : <button className={cn("flex h-10 w-full items-center px-3 text-left", view === "sheet" && "cursor-cell", field.id === "name" && "font-medium text-primary")} onClick={() => view === "list" ? setDetail(contact) : setEditing({ id: contact.id, field: field.id })}>{saving === saveKey ? "Saving…" : field.type === "currency" ? `$${Number(contact.values[field.id] ?? 0).toLocaleString()}` : valueText(contact.values[field.id]) || "—"}</button>}</td>})}<td className="border-b p-1"><Button variant="ghost" size="icon-sm" onClick={() => setDetail(contact)} aria-label="Open contact"><MoreHorizontal /></Button></td></tr>)}</tbody></table>}

        {view === "cards" && <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((contact) => <article key={contact.id} className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs"><div className="flex items-start gap-3"><Checkbox checked={selected.has(contact.id)} onCheckedChange={() => toggleSelected(contact.id)} aria-label={`Select ${valueText(contact.values.name)}`} /><Avatar><AvatarFallback>{valueText(contact.values.name).split(" ").map((part) => part[0]).slice(0, 2).join("")}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><button className="truncate font-semibold hover:text-primary" onClick={() => setDetail(contact)}>{valueText(contact.values.name)}</button><p className="truncate text-sm text-muted-foreground">{valueText(contact.values.company)}</p></div><Badge variant="secondary">{valueText(contact.values.lifecycle)}</Badge></div><div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Email</p><p className="truncate">{valueText(contact.values.email)}</p></div><div><p className="text-xs text-muted-foreground">Phone</p><p>{valueText(contact.values.phone)}</p></div><div><p className="text-xs text-muted-foreground">Location</p><p>{valueText(contact.values.city)}</p></div><div><p className="text-xs text-muted-foreground">Value</p><p>${Number(contact.values.value ?? 0).toLocaleString()}</p></div></div></article>)}</div>}
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-4 border-t bg-card px-4 py-2 text-xs"><span>Total contacts <strong>{filtered.length}</strong></span><span className="hidden sm:inline">Customers <strong>{filtered.filter((c) => c.values.lifecycle === "Customer").length}</strong></span><span className="ml-auto">Rows</span><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(0) }}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[10,20,50,100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectGroup></SelectContent></Select><span>{filtered.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span><Button variant="ghost" size="icon-sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft /></Button><Button variant="ghost" size="icon-sm" disabled={page >= totalPages - 1} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight /></Button></footer>

      {filterOpen && <ContactFilterBuilder open={filterOpen} fields={orderedFields} value={filters} onOpenChange={setFilterOpen} onApply={(value) => { setFilters(value); setPage(0) }} onClear={() => { setFilters(emptyFilterGroup()); setPage(0) }} />}
      <Dialog open={contactOpen} onOpenChange={setContactOpen}><DialogContent><DialogHeader><DialogTitle>Add contact</DialogTitle><DialogDescription>Create a record shared by every contact view.</DialogDescription></DialogHeader><div className="flex flex-col gap-3">{Object.keys(newContact).map((key) => <Input key={key} value={newContact[key as keyof typeof newContact]} onChange={(event) => setNewContact((current) => ({ ...current, [key]: event.target.value }))} placeholder={key[0].toUpperCase() + key.slice(1)} />)}</div><DialogFooter><Button variant="outline" onClick={() => setContactOpen(false)}>Cancel</Button><Button onClick={addContact}>Create contact</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={fieldOpen} onOpenChange={setFieldOpen}><DialogContent><DialogHeader><DialogTitle>Create custom field</DialogTitle><DialogDescription>Add up to 100 typed fields. Dropdown options should be comma separated.</DialogDescription></DialogHeader><div className="flex flex-col gap-3"><Input value={newField.label} onChange={(event) => setNewField((current) => ({ ...current, label: event.target.value }))} placeholder="Field label" /><Select value={newField.type} onValueChange={(value) => setNewField((current) => ({ ...current, type: value as FieldType }))}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["text","number","date","email","phone","url","single_select","multi_select","checkbox","currency"].map((type) => <SelectItem key={type} value={type}>{type.replace("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select>{(newField.type === "single_select" || newField.type === "multi_select") && <Input value={newField.options} onChange={(event) => setNewField((current) => ({ ...current, options: event.target.value }))} placeholder="Lead, Qualified, Customer" />}</div><DialogFooter><Button variant="outline" onClick={() => setFieldOpen(false)}>Cancel</Button><Button onClick={addField}>Create field</Button></DialogFooter></DialogContent></Dialog>
      <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}><SheetContent className="sm:max-w-lg"><SheetHeader><SheetTitle>{detail ? valueText(detail.values.name) : "Contact details"}</SheetTitle><SheetDescription>Enterprise contact record</SheetDescription></SheetHeader>{detail && <ScrollArea className="h-[calc(100vh-8rem)]"><div className="flex flex-col gap-4 p-4">{orderedFields.map((field) => <div key={field.id} className="flex items-start justify-between gap-4 border-b pb-3"><span className="text-sm text-muted-foreground">{field.label}</span><span className="max-w-64 text-right text-sm font-medium">{valueText(detail.values[field.id]) || "—"}</span></div>)}</div></ScrollArea>}</SheetContent></Sheet>
    </div>
  )
}

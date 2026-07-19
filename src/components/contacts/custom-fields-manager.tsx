"use client"

import { useState } from "react"
import useSWR from "swr"
import { Database, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ContactField, FieldType } from "@/lib/data/contacts/types"

type Store = { data: { fields: ContactField[] } }
const fieldTypes: FieldType[] = ["text", "number", "date", "email", "phone", "url", "single_select", "multi_select", "checkbox", "currency"]

async function request(method: string, body: unknown) {
  const response = await fetch("/api/v1/workspace/contacts", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message ?? "Request failed")
  return payload.data
}

export function CustomFieldsPanel() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card text-primary"><Database className="size-5" /></div>
        <div><p className="text-sm font-semibold">Contact field catalogue</p><p className="text-xs text-muted-foreground">Create, edit, and remove account-wide contact fields.</p></div>
      </div>
      <Button variant="outline" onClick={() => setOpen(true)}><Sparkles data-icon="inline-start" /> Manage fields</Button>
      <CustomFieldsManager open={open} onOpenChange={setOpen} />
    </div>
  )
}

export function CustomFieldsManager({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, mutate } = useSWR<Store>(open ? "/api/v1/workspace/contacts?fields=1" : null)
  const fields = data?.data.fields.filter((field) => field.custom) ?? []
  const [label, setLabel] = useState("")
  const [type, setType] = useState<FieldType>("text")
  const [options, setOptions] = useState("")
  const [editing, setEditing] = useState<ContactField | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!label.trim()) return
    setBusy(true)
    try {
      const field = { label: label.trim(), type, options: options.split(",").map((item) => item.trim()).filter(Boolean) }
      await request(editing ? "PATCH" : "POST", editing ? { kind: "field", id: editing.id, field } : { kind: "field", field })
      toast.success(editing ? "Custom field updated" : "Custom field created")
      setLabel(""); setType("text"); setOptions(""); setEditing(null)
      await mutate()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save field") }
    finally { setBusy(false) }
  }

  async function remove(field: ContactField) {
    if (!window.confirm(`Delete “${field.label}” and all saved values?`)) return
    try { await request("DELETE", { kind: "field", ids: [field.id] }); await mutate(); toast.success("Custom field deleted") }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to delete field") }
  }

  function startEdit(field: ContactField) {
    setEditing(field); setLabel(field.label); setType(field.type); setOptions(field.options?.join(", ") ?? "")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-lg border bg-primary text-primary-foreground"><Database className="size-5" /></div><div><DialogTitle>Custom contact fields</DialogTitle><DialogDescription>Create typed fields used in contact sheets, tables, filters, and imports.</DialogDescription></div></div></DialogHeader>
        <ScrollArea className="min-h-0 flex-1"><div className="grid gap-6 p-6 md:grid-cols-[1fr_1.25fr]">
          <section className="flex flex-col gap-4 rounded-xl border bg-muted/20 p-4"><div><h3 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" /> {editing ? "Edit field" : "New field"}</h3><p className="text-xs text-muted-foreground">Choose a label and data type.</p></div><label className="flex flex-col gap-2 text-sm font-medium">Field label<Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Customer tier" /></label><label className="flex flex-col gap-2 text-sm font-medium">Field type<Select value={type} onValueChange={(value) => setType(value as FieldType)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{fieldTypes.map((item) => <SelectItem key={item} value={item}>{item.replace("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select></label>{(type === "single_select" || type === "multi_select") && <label className="flex flex-col gap-2 text-sm font-medium">Options<Input value={options} onChange={(event) => setOptions(event.target.value)} placeholder="Lead, Qualified, Customer" /><span className="text-xs font-normal text-muted-foreground">Separate choices with commas.</span></label>}<div className="flex gap-2"><Button onClick={save} disabled={busy || !label.trim()}>{busy ? <Loader2 className="animate-spin" /> : editing ? <Pencil /> : <Plus />}{editing ? "Save field" : "Add field"}</Button>{editing && <Button variant="ghost" onClick={() => { setEditing(null); setLabel(""); setType("text"); setOptions("") }}>Cancel</Button>}</div></section>
          <section className="flex min-w-0 flex-col gap-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Workspace fields</h3><p className="text-xs text-muted-foreground">{fields.length} custom fields</p></div></div>{!data ? <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div> : fields.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><Sparkles className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No custom fields</p><p className="mt-1 text-xs text-muted-foreground">Create your first field to extend every contact record.</p></div> : <div className="flex flex-col gap-2">{fields.map((field) => <div key={field.id} className="flex items-center gap-3 rounded-lg border bg-card p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{field.label}</p><Badge variant="secondary" className="mt-1">{field.type.replace("_", " ")}</Badge></div><Button variant="ghost" size="icon-sm" onClick={() => startEdit(field)} aria-label={`Edit ${field.label}`}><Pencil /></Button><Button variant="ghost" size="icon-sm" onClick={() => remove(field)} aria-label={`Delete ${field.label}`}><Trash2 /></Button></div>)}</div>}</section>
        </div></ScrollArea>
        <DialogFooter className="border-t px-6 py-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

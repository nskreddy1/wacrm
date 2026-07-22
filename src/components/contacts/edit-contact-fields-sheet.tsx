"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, GripVertical, Info, Loader2, Pencil, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { ContactField, ContactPreferences, FieldType } from "@/lib/data/contacts/types"
import { isReservedContactField, validateFieldDefinition } from "@/lib/data/contacts/validation"

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Single Line",
  number: "Number",
  date: "Date",
  email: "Email",
  phone: "Phone",
  url: "URL",
  single_select: "Pick List",
  multi_select: "Multi Select",
  checkbox: "Checkbox",
  currency: "Currency",
}

const MAX_CUSTOM_FIELDS = 10

async function request(method: string, body: unknown) {
  const response = await fetch("/api/v1/workspace/contacts", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message ?? "Request failed")
  return payload.data
}

export function EditContactFieldsSheet({
  open,
  fields,
  preferences,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  fields: ContactField[]
  preferences: ContactPreferences
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<unknown> | void
}) {
  const [used, setUsed] = useState<string[]>([])
  const [initialized, setInitialized] = useState(false)
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)

  // Stacked panel state: create a new custom field or edit an existing one
  const [panel, setPanel] = useState<{ mode: "create" } | { mode: "edit"; fieldId: string } | null>(null)
  const [label, setLabel] = useState("")
  const [type, setType] = useState<FieldType>("text")
  const [options, setOptions] = useState("")
  const [mandatory, setMandatory] = useState(false)
  const [noDuplicates, setNoDuplicates] = useState(false)
  const [formError, setFormError] = useState("")
  const [creating, setCreating] = useState(false)

  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields])

  if (open && !initialized) {
    const ordered = preferences.order.filter((id) => preferences.visible.includes(id) && fieldById.has(id))
    const missing = preferences.visible.filter((id) => !ordered.includes(id) && fieldById.has(id))
    setUsed([...ordered, ...missing])
    setInitialized(true)
  }
  if (!open && initialized) {
    setInitialized(false)
    setPanel(null)
    setSearch("")
  }

  const unused = useMemo(
    () => fields.filter((field) => !used.includes(field.id) && field.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),
    [fields, used, search],
  )
  // Only fields the user created count toward the limit — auto-provisioned
  // form fields (Title, Description, Street, City, Other Phones) are excluded.
  const usedCustomCount = used.filter((id) => {
    const field = fieldById.get(id)
    return field?.custom && !isReservedContactField(field.label)
  }).length

  function openPanel(target: { mode: "create" } | { mode: "edit"; fieldId: string }) {
    const editing = target.mode === "edit" ? fieldById.get(target.fieldId) : null
    setLabel(editing?.label ?? "")
    setType(editing?.type ?? "text")
    setOptions(editing?.options?.join(", ") ?? "")
    setMandatory(editing?.required === true)
    setNoDuplicates(editing?.unique === true)
    setFormError("")
    setPanel(target)
  }

  function moveField(sourceId: string, targetId: string) {
    setUsed((current) => {
      const next = current.filter((id) => id !== sourceId)
      const index = next.indexOf(targetId)
      next.splice(index < 0 ? next.length : index, 0, sourceId)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const order = [...used, ...preferences.order.filter((id) => !used.includes(id))]
      await request("PATCH", { kind: "preferences", preferences: { visible: used, order } })
      toast.success("Contact fields updated")
      await onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save fields")
    } finally {
      setSaving(false)
    }
  }

  async function saveField(addAnother: boolean) {
    const editingId = panel?.mode === "edit" ? panel.fieldId : undefined
    let definition: ReturnType<typeof validateFieldDefinition>
    try {
      definition = validateFieldDefinition({ label, type, options: options.split(",").map((item) => item.trim()).filter(Boolean) }, fields, editingId)
      setFormError("")
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Check the field details")
      return
    }
    if (!editingId && usedCustomCount >= MAX_CUSTOM_FIELDS) {
      setFormError(`You can use up to ${MAX_CUSTOM_FIELDS} custom fields.`)
      return
    }
    setCreating(true)
    try {
      const payload = { ...definition, required: mandatory, unique: noDuplicates }
      if (editingId) {
        await request("PATCH", { kind: "field", id: editingId, field: payload })
        toast.success("Custom field updated")
        await onSaved()
        setPanel(null)
      } else {
        const created = (await request("POST", { kind: "field", field: payload })) as ContactField
        toast.success("Custom field created")
        await onSaved()
        if (created?.id) setUsed((current) => [...current, created.id])
        setLabel("")
        setType("text")
        setOptions("")
        setMandatory(false)
        setNoDuplicates(false)
        if (!addAnother) setPanel(null)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save field")
    } finally {
      setCreating(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-hidden bg-background p-0 data-[side=right]:sm:w-[min(1080px,78vw)] data-[side=right]:sm:max-w-none">
        <div className="relative flex min-h-0 flex-1 flex-col">
          <SheetHeader className="border-b px-8 py-4 text-left">
            <SheetTitle className="text-xl font-semibold tracking-tight">Edit Contact Fields</SheetTitle>
            <SheetDescription className="sr-only">Choose, reorder, and create the fields shown on contact records</SheetDescription>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
            {/* Used fields */}
            <ScrollArea className="min-h-0 border-r">
              <div className="flex flex-col gap-4 px-8 py-6">
                <h2 className="text-lg font-semibold">Contact Information</h2>
                <ul className="flex flex-col gap-2">
                  {used.map((id) => {
                    const field = fieldById.get(id)
                    if (!field) return null
                    return (
                      <li
                        key={id}
                        draggable
                        onDragStart={() => setDragId(id)}
                        onDragEnd={() => setDragId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          if (dragId && dragId !== id) moveField(dragId, id)
                          setDragId(null)
                        }}
                        className={`group flex items-center gap-2 ${dragId === id ? "opacity-50" : ""}`}
                      >
                        <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/60 group-hover:text-muted-foreground" aria-hidden="true" />
                        <div className="flex h-11 flex-1 items-center justify-between rounded-lg border bg-card px-3">
                          <span className="text-sm font-medium">{field.label}{field.required ? <span aria-hidden="true" className="ml-0.5 text-destructive">*</span> : null}</span>
                          <span className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}{field.unique ? "  (Unique)" : ""}</span>
                        </div>
                        {field.custom && !isReservedContactField(field.label) ? (
                          <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Edit ${field.label}`} onClick={() => openPanel({ mode: "edit", fieldId: id })}>
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Remove ${field.label}`} onClick={() => setUsed((current) => current.filter((item) => item !== id))}>
                              <span aria-hidden="true" className="flex size-4 items-center justify-center rounded-full bg-destructive/15 text-destructive">−</span>
                            </Button>
                          </span>
                        ) : (
                          <span className="w-16" aria-hidden="true" />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </ScrollArea>

            {/* Unused fields rail */}
            <ScrollArea className="min-h-0 bg-muted/20">
              <div className="flex flex-col gap-4 px-6 py-6">
                <Button type="button" variant="outline" className="self-start rounded-full border-primary/40 text-primary hover:bg-primary/5 hover:text-primary" onClick={() => openPanel({ mode: "create" })}>
                  <Plus data-icon="inline-start" /> Custom Field
                </Button>
                <div className="flex flex-col gap-3">
                  <h3 className="font-semibold">Unused Fields</h3>
                  <div className="relative">
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="h-10 pr-9" aria-label="Search unused fields" />
                    <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                  <ul className="flex flex-col gap-2">
                    {unused.length === 0 ? (
                      <li className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No unused fields</li>
                    ) : (
                      unused.map((field) => (
                        <li key={field.id}>
                          <button
                            type="button"
                            onClick={() => setUsed((current) => [...current, field.id])}
                            className="flex h-11 w-full items-center gap-2 rounded-lg border bg-card px-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                          >
                            <GripVertical className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                            <span className="flex-1 truncate text-sm font-medium">{field.label}</span>
                            <span className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[field.type]}</span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            </ScrollArea>
          </div>

          <SheetFooter className="flex-row items-center justify-between border-t bg-background px-8 py-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              Used Custom Fields: <span className="font-semibold text-foreground">{usedCustomCount}/{MAX_CUSTOM_FIELDS}</span>
            </p>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" className="rounded-full px-6" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
              <Button type="button" className="rounded-full px-6" onClick={save} disabled={saving}>
                {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                Save
              </Button>
            </div>
          </SheetFooter>

          {/* Stacked Create / Edit Custom Field panel */}
          <div
            aria-hidden={!panel}
            className={`absolute inset-y-0 right-0 z-10 flex w-full flex-col bg-background shadow-2xl transition-transform duration-300 ease-out sm:w-[min(560px,90%)] sm:border-l ${panel ? "translate-x-0" : "pointer-events-none translate-x-full"}`}
          >
            <div className="flex items-center gap-3 border-b px-8 py-4">
              <h2 className="text-xl font-semibold tracking-tight">{panel?.mode === "edit" ? "Edit Custom Field" : "Create Custom Field"}</h2>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">Contacts</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
              <div className="grid grid-cols-[7rem_1fr] items-center gap-4 rounded-lg border px-4 py-3 focus-within:border-primary">
                <label htmlFor="new-field-label" className="text-sm font-medium">Field Label</label>
                <Input
                  id="new-field-label"
                  value={label}
                  maxLength={80}
                  onChange={(event) => { setLabel(event.target.value); setFormError("") }}
                  placeholder="Enter Field Label"
                  className="border-0 p-0 shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="grid grid-cols-[7rem_1fr] items-center gap-4 rounded-lg border px-4 py-3">
                <span id="new-field-type-label" className="text-sm font-medium">Field Type</span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<button type="button" aria-labelledby="new-field-type-label" className="flex w-full items-center justify-between text-left text-sm" />}
                  >
                    <span className={type ? "" : "text-muted-foreground"}>{FIELD_TYPE_LABELS[type]}</span>
                    <ChevronDown className="size-4 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((item) => (
                      <DropdownMenuItem key={item} onClick={() => { setType(item); setFormError("") }}>
                        <span className="flex-1">{FIELD_TYPE_LABELS[item]}</span>
                        {item === type ? <Check className="size-4 text-primary" /> : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {(type === "single_select" || type === "multi_select") ? (
                <div className="grid grid-cols-[7rem_1fr] items-center gap-4 rounded-lg border px-4 py-3 focus-within:border-primary">
                  <label htmlFor="new-field-options" className="text-sm font-medium">Options</label>
                  <Input
                    id="new-field-options"
                    value={options}
                    onChange={(event) => { setOptions(event.target.value); setFormError("") }}
                    placeholder="Lead, Qualified, Customer"
                    className="border-0 p-0 shadow-none focus-visible:ring-0"
                  />
                </div>
              ) : null}
              <div className="flex flex-col gap-3 pt-1">
                <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
                  <input type="checkbox" checked={mandatory} onChange={(event) => setMandatory(event.target.checked)} className="size-4 accent-primary" />
                  Mandatory Field
                </label>
                <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
                  <input type="checkbox" checked={noDuplicates} onChange={(event) => setNoDuplicates(event.target.checked)} className="size-4 accent-primary" />
                  Do not allow duplicate values
                  <span title="Two contacts cannot share the same value for this field"><Info className="size-3.5 text-muted-foreground" aria-hidden="true" /></span>
                </label>
              </div>
              {formError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p> : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-8 py-3">
              <Button type="button" variant="outline" className="rounded-full px-6" onClick={() => { setPanel(null); setFormError("") }} disabled={creating}>Cancel</Button>
              {panel?.mode !== "edit" ? (
                <Button type="button" variant="outline" className="rounded-full border-primary/40 px-6 text-primary hover:bg-primary/5 hover:text-primary" onClick={() => saveField(true)} disabled={creating || !label.trim()}>Save &amp; New</Button>
              ) : null}
              <Button type="button" className="rounded-full px-6" onClick={() => saveField(false)} disabled={creating || !label.trim()}>
                {creating ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

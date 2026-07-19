"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Building2, Check, Loader2, Mail, Pencil, Save, Sparkles, UserRound, X } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InternationalPhoneInput, validInternationalPhone } from "@/components/contacts/international-phone-input"
import type { ContactField, ContactValue, WorkspaceContact } from "@/lib/data/contacts/types"

export type ContactSheetState = { mode: "create" | "view" | "edit"; contact?: WorkspaceContact } | null

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "NC"
}

export function ContactRecordSheet({ state, fields, onOpenChange, onSaved }: { state: ContactSheetState; fields: ContactField[]; onOpenChange: (open: boolean) => void; onSaved: () => Promise<unknown> | void }) {
  const contact = state?.contact
  const [mode, setMode] = useState<"create" | "view" | "edit">(state?.mode ?? "view")
  const [values, setValues] = useState<Record<string, ContactValue>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const customFields = useMemo(() => fields.filter((field) => field.custom), [fields])

  useEffect(() => {
    setMode(state?.mode ?? "view")
    setValues(Object.fromEntries(fields.map((field) => [field.id, contact?.values[field.id] ?? ""])))
    setErrors({})
  }, [state, contact, fields])

  const name = String(values.name ?? contact?.values.name ?? "New contact")
  const readonly = mode === "view"

  function setValue(field: string, value: ContactValue) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: "" }))
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!String(values.name ?? "").trim()) next.name = "Enter the contact’s full name."
    if (!String(values.phone ?? "").trim() && !String(values.email ?? "").trim()) {
      next.phone = "Add a phone number or email address."
      next.email = "Add an email address or phone number."
    }
    const phone = String(values.phone ?? "").trim()
    if (phone && !validInternationalPhone(phone)) next.phone = "Choose a country and enter a valid phone number."
    const email = String(values.email ?? "").trim()
    if (email && !/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter a valid email address."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      const response = await fetch("/api/v1/workspace/contacts", {
        method: contact ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contact ? { id: contact.id, values } : { values }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message ?? "Unable to save contact")
      toast.success(contact ? "Contact updated" : "Contact created")
      await onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save contact")
    } finally {
      setSaving(false)
    }
  }

  function renderField(field: ContactField) {
    const value = String(values[field.id] ?? "")
    if (readonly) return <div key={field.id} className="flex items-start justify-between gap-6 border-b py-3"><span className="text-sm text-muted-foreground">{field.label}</span><span className="max-w-sm text-right text-sm font-medium text-foreground">{value || "—"}</span></div>
    if (field.type === "checkbox") return <label key={field.id} className="flex items-center justify-between rounded-lg border p-3 text-sm font-medium"><span>{field.label}</span><input type="checkbox" checked={Boolean(values[field.id])} onChange={(event) => setValue(field.id, event.target.checked)} className="size-4 accent-primary" /></label>
    if ((field.type === "single_select" || field.type === "multi_select") && field.options?.length) return <label key={field.id} className="flex flex-col gap-2"><span className="text-sm font-medium">{field.label}</span><select className="h-11 rounded-md border bg-background px-3 text-sm" value={value} onChange={(event) => setValue(field.id, event.target.value)}><option value="">Select an option</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select></label>
    return <label key={field.id} className="flex flex-col gap-2"><span className="text-sm font-medium">{field.label}</span><Input type={field.type === "number" || field.type === "currency" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text"} value={value} onChange={(event) => setValue(field.id, event.target.value)} placeholder={`Enter ${field.label.toLowerCase()}`} className="h-11" /></label>
  }

  return (
    <Sheet open={Boolean(state)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="shrink-0 border-b px-5 py-5 text-left sm:px-6">
          <div className="flex items-start gap-4 pr-8">
            <Avatar className="size-12 border shadow-xs"><AvatarFallback className="bg-primary text-primary-foreground">{initials(name)}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><SheetTitle className="truncate text-xl">{mode === "create" ? "Create contact" : name}</SheetTitle><Badge variant="secondary" className="gap-1"><Sparkles className="size-3" /> Contact record</Badge></div><SheetDescription>{mode === "view" ? "Contact details and workspace data" : "Start with a name and either a phone number or email. Add business data only when needed."}</SheetDescription></div>
            {mode === "view" && <Button variant="outline" size="sm" onClick={() => setMode("edit")}><Pencil data-icon="inline-start" /> Edit</Button>}
          </div>
        </SheetHeader>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="shrink-0 border-b px-5 sm:px-6"><TabsList className="h-12 bg-transparent p-0"><TabsTrigger value="details">Details</TabsTrigger><TabsTrigger value="custom">Custom fields <Badge variant="outline">{customFields.length}</Badge></TabsTrigger></TabsList></div>
            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="details" className="m-0 flex flex-col gap-6 p-5 sm:p-6">
                <section className="flex flex-col gap-4"><div><h3 className="flex items-center gap-2 font-semibold"><UserRound className="size-4 text-primary" /> Identity</h3><p className="text-sm text-muted-foreground">Primary details used across your workspace.</p></div>{readonly ? <>{renderField(fields.find((field) => field.id === "name")!)}{renderField(fields.find((field) => field.id === "company")!)}</> : <div className="grid gap-4 sm:grid-cols-2"><label className="flex flex-col gap-2 sm:col-span-2"><span className="text-sm font-medium">Full name *</span><div className="relative"><UserRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={String(values.name ?? "")} onChange={(event) => setValue("name", event.target.value)} className="h-11 pl-9" aria-invalid={Boolean(errors.name)} placeholder="e.g. Priya Sharma" /></div>{errors.name && <span className="text-xs text-destructive">{errors.name}</span>}</label><label className="flex flex-col gap-2 sm:col-span-2"><span className="text-sm font-medium">Company</span><div className="relative"><Building2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={String(values.company ?? "")} onChange={(event) => setValue("company", event.target.value)} className="h-11 pl-9" placeholder="Company or organization" /></div></label></div>}</section>
                <Separator />
                <section className="flex flex-col gap-4"><div><h3 className="flex items-center gap-2 font-semibold"><Mail className="size-4 text-primary" /> Communication</h3><p className="text-sm text-muted-foreground">Use an international number or a verified email.</p></div>{readonly ? <>{renderField(fields.find((field) => field.id === "phone")!)}{renderField(fields.find((field) => field.id === "email")!)}</> : <div className="grid gap-4"><label className="flex flex-col gap-2"><span className="text-sm font-medium">Phone number</span><InternationalPhoneInput value={String(values.phone ?? "")} onChange={(value) => setValue("phone", value)} invalid={Boolean(errors.phone)} />{errors.phone ? <span className="text-xs text-destructive">{errors.phone}</span> : <span className="text-xs text-muted-foreground">Search any country flag and dial code.</span>}</label><label className="flex flex-col gap-2"><span className="text-sm font-medium">Email address</span><div className="relative"><Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="email" value={String(values.email ?? "")} onChange={(event) => setValue("email", event.target.value)} className="h-11 pl-9" aria-invalid={Boolean(errors.email)} placeholder="name@company.com" /></div>{errors.email && <span className="text-xs text-destructive">{errors.email}</span>}</label></div>}</section>
              </TabsContent>
              <TabsContent value="custom" className="m-0 flex flex-col gap-4 p-5 sm:p-6"><div><h3 className="font-semibold">Custom business data</h3><p className="text-sm text-muted-foreground">Optional fields configured from More actions appear here.</p></div>{customFields.length ? <div className="grid gap-4 sm:grid-cols-2">{customFields.map(renderField)}</div> : <div className="rounded-xl border border-dashed p-8 text-center"><Sparkles className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No custom fields yet</p><p className="mt-1 text-sm text-muted-foreground">Close this sheet and choose More actions, then Manage custom fields.</p></div>}</TabsContent>
            </ScrollArea>
          </Tabs>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-card px-5 py-4 sm:px-6"><p className="hidden text-xs text-muted-foreground sm:block">{contact ? `Updated ${new Date(contact.updatedAt).toLocaleDateString()}` : "New workspace record"}</p><div className="ml-auto flex gap-2"><Button type="button" variant="outline" onClick={() => mode === "edit" ? setMode("view") : onOpenChange(false)} disabled={saving}><X data-icon="inline-start" /> {mode === "edit" ? "Cancel edit" : "Close"}</Button>{!readonly && <Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" data-icon="inline-start" /> : mode === "create" ? <Check data-icon="inline-start" /> : <Save data-icon="inline-start" />}{saving ? "Saving" : mode === "create" ? "Create contact" : "Save changes"}</Button>}</div></div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

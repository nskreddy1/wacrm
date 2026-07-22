"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Building2, Check, ChevronDown, Loader2, Mail, Pencil, Phone, Save, UserRound, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { InternationalPhoneInput, validInternationalPhone } from "@/components/contacts/international-phone-input"
import type { ContactField, ContactValue, WorkspaceContact } from "@/lib/data/contacts/types"

export type ContactSheetState = { mode: "create" | "view" | "edit"; contact?: WorkspaceContact } | null

export function ContactRecordSheet({ state, fields, onOpenChange, onSaved }: { state: ContactSheetState; fields: ContactField[]; onOpenChange: (open: boolean) => void; onSaved: () => Promise<unknown> | void }) {
  const contact = state?.contact
  const [mode, setMode] = useState<"create" | "view" | "edit">(state?.mode ?? "view")
  const [values, setValues] = useState<Record<string, ContactValue>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)
  const [additionalOpen, setAdditionalOpen] = useState(false)
  const customFields = useMemo(() => fields.filter((field) => field.custom), [fields])

  useEffect(() => {
    // The same mounted sheet instance serves different records, so opening a
    // new record must atomically reset its draft before the user can edit it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(state?.mode ?? "view")
    setValues(Object.fromEntries(fields.map((field) => [field.id, contact?.values[field.id] ?? ""])))
    setErrors({})
  }, [state, contact, fields])

  const readonly = mode === "view"
  const name = String(values.name ?? contact?.values.name ?? "New contact")

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

  function renderCustomField(field: ContactField) {
    const value = String(values[field.id] ?? "")
    return (
      <Field key={field.id}>
        <FieldLabel htmlFor={`contact-${field.id}`}>{field.label}</FieldLabel>
        <Input id={`contact-${field.id}`} value={value} onChange={(event) => setValue(field.id, event.target.value)} disabled={readonly} />
      </Field>
    )
  }

  return (
    <Sheet open={Boolean(state)} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-hidden bg-background p-0 sm:max-w-[52rem]">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="flex-row items-center border-b px-6 py-4 text-left">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-xl font-semibold tracking-tight">{mode === "create" ? "Create Contact" : readonly ? name : "Edit Contact"}</SheetTitle>
              <SheetDescription className="sr-only">{mode === "create" ? "Create a contact record" : "View or edit this contact record"}</SheetDescription>
            </div>
            {readonly ? <Button type="button" variant="outline" size="sm" onClick={() => setMode("edit")}><Pencil data-icon="inline-start" />Edit</Button> : null}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Close contact panel" onClick={() => onOpenChange(false)}><X /></Button>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-8 px-6 py-7 sm:px-8">
              <section className="flex flex-col gap-5" aria-labelledby="contact-information-heading">
                <div className="flex items-center justify-between gap-4">
                  <h2 id="contact-information-heading" className="text-base font-semibold">Contact Information</h2>
                  <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">Owner</span><span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 font-medium"><span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{name.slice(0, 2).toUpperCase()}</span>You</span></div>
                </div>

                <FieldGroup className="gap-5">
                  <Field orientation="responsive" data-invalid={Boolean(errors.name)}>
                    <FieldLabel htmlFor="contact-name" className="sm:w-36 sm:justify-end">Full Name</FieldLabel>
                    <div className="flex flex-1 flex-col gap-1.5"><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="contact-name" autoFocus={!readonly} value={String(values.name ?? "")} onChange={(event) => setValue("name", event.target.value)} disabled={readonly} aria-invalid={Boolean(errors.name)} className="pl-9" placeholder="Contact name" /></div><FieldError>{errors.name}</FieldError></div>
                  </Field>
                  <Field orientation="responsive" data-invalid={Boolean(errors.email)}>
                    <FieldLabel htmlFor="contact-email" className="sm:w-36 sm:justify-end">Email</FieldLabel>
                    <div className="flex flex-1 flex-col gap-1.5"><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="contact-email" type="email" value={String(values.email ?? "")} onChange={(event) => setValue("email", event.target.value)} disabled={readonly} aria-invalid={Boolean(errors.email)} className="pl-9" placeholder="name@company.com" /></div><FieldError>{errors.email}</FieldError></div>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor="contact-company" className="sm:w-36 sm:justify-end">Company Name</FieldLabel>
                    <div className="relative flex-1"><Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="contact-company" value={String(values.company ?? "")} onChange={(event) => setValue("company", event.target.value)} disabled={readonly} className="pl-9" placeholder="Company or organization" /></div>
                  </Field>
                  <Field orientation="responsive" data-invalid={Boolean(errors.phone)}>
                    <FieldLabel className="sm:w-36 sm:justify-end"><Phone aria-hidden="true" />Mobile</FieldLabel>
                    <div className="flex flex-1 flex-col gap-1.5"><InternationalPhoneInput value={String(values.phone ?? "")} onChange={(value) => setValue("phone", value)} invalid={Boolean(errors.phone)} disabled={readonly} /><FieldError>{errors.phone}</FieldError></div>
                  </Field>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor="contact-description" className="sm:w-36 sm:justify-end">Description</FieldLabel>
                    <Textarea id="contact-description" value={String(values.description ?? "")} onChange={(event) => setValue("description", event.target.value)} disabled={readonly} rows={3} placeholder="A few words about this contact" className="min-h-20 flex-1 resize-none" />
                  </Field>
                </FieldGroup>
              </section>

              <Collapsible open={addressOpen} onOpenChange={setAddressOpen} className="border-t pt-5">
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-2 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-safe:transition-transform motion-safe:duration-150"><span>Address Information</span><ChevronDown className="motion-safe:transition-transform motion-safe:duration-200 group-data-panel-open:rotate-180" /></CollapsibleTrigger>
                <CollapsibleContent className="data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-safe:transition-[height,opacity] motion-safe:duration-200"><FieldGroup className="grid gap-4 pt-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="contact-street">Street</FieldLabel><Input id="contact-street" value={String(values.street ?? "")} onChange={(event) => setValue("street", event.target.value)} disabled={readonly} /></Field><Field><FieldLabel htmlFor="contact-city">City</FieldLabel><Input id="contact-city" value={String(values.city ?? "")} onChange={(event) => setValue("city", event.target.value)} disabled={readonly} /></Field></FieldGroup></CollapsibleContent>
              </Collapsible>

              <Collapsible open={additionalOpen} onOpenChange={setAdditionalOpen} className="border-t pt-5">
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-2 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-safe:transition-transform motion-safe:duration-150"><span>Additional Information</span><ChevronDown className="motion-safe:transition-transform motion-safe:duration-200 group-data-panel-open:rotate-180" /></CollapsibleTrigger>
                <CollapsibleContent className="data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-safe:transition-[height,opacity] motion-safe:duration-200"><FieldGroup className="grid gap-4 pt-4 sm:grid-cols-2">{customFields.length ? customFields.map(renderCustomField) : <p className="text-sm text-muted-foreground sm:col-span-2">No custom fields have been configured.</p>}</FieldGroup></CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>

          <SheetFooter className="flex-row items-center justify-between border-t bg-background px-6 py-3 sm:px-8">
            <p className="text-xs text-muted-foreground">{customFields.length} custom field{customFields.length === 1 ? "" : "s"}</p>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={() => mode === "edit" ? setMode("view") : onOpenChange(false)} disabled={saving}>Cancel</Button>
              {!readonly ? <Button type="submit" disabled={saving}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : mode === "create" ? <Check data-icon="inline-start" /> : <Save data-icon="inline-start" />}{saving ? "Saving" : "Save"}</Button> : null}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

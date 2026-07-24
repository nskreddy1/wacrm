"use client"

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Building2, Check, ChevronDown, Loader2, MinusCircle, Pencil, PlusCircle, Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { InternationalPhoneInput, validInternationalPhone } from "@/features/contacts/components/international-phone-input"
import { EditContactFieldsSheet } from "@/features/contacts/components/edit-contact-fields-sheet"
import type { ContactField, ContactOwner, ContactPreferences, ContactValue, WorkspaceContact } from "@/lib/data/contacts/types"

export type ContactSheetState = { mode: "create" | "view" | "edit"; contact?: WorkspaceContact } | null

const PHONE_TYPES = ["Mobile", "Home Phone", "Work Phone", "Phone"] as const

// These labels are rendered as dedicated inputs in the form; hide them from
// the generic "Additional Information" custom-field list to avoid duplicates.
const RESERVED_FIELD_LABELS = new Set(["title", "description", "street", "city", "other phones"])

function ownerInitials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?"
}

export function ContactRecordSheet({ state, fields, preferences, owners = [], currentUserId = "", onOpenChange, onSaved }: { state: ContactSheetState; fields: ContactField[]; preferences?: ContactPreferences; owners?: ContactOwner[]; currentUserId?: string; onOpenChange: (open: boolean) => void; onSaved: () => Promise<unknown> | void }) {
  const contact = state?.contact
  const [mode, setMode] = useState<"create" | "view" | "edit">(state?.mode ?? "view")
  const [values, setValues] = useState<Record<string, ContactValue>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [ownerId, setOwnerId] = useState("")
  const [phoneType, setPhoneType] = useState<(typeof PHONE_TYPES)[number]>("Mobile")
  const [extraPhones, setExtraPhones] = useState<string[]>([])
  const [addressOpen, setAddressOpen] = useState(false)
  const [additionalOpen, setAdditionalOpen] = useState(false)
  const [fieldsEditorOpen, setFieldsEditorOpen] = useState(false)
  const customFields = useMemo(() => fields.filter((field) => field.custom && !RESERVED_FIELD_LABELS.has(field.label.toLocaleLowerCase())), [fields])

  useEffect(() => {
    // The same mounted sheet instance serves different records, so opening a
    // new record must atomically reset its draft before the user can edit it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(state?.mode ?? "view")
    const nextValues = Object.fromEntries(fields.map((field) => [field.id, contact?.values[field.id] ?? ""]))
    const fullName = String(contact?.values.name ?? "").trim()
    const [firstName = "", ...lastNameParts] = fullName.split(/\s+/)
    setValues({
      ...nextValues,
      firstName,
      lastName: lastNameParts.join(" "),
      title: contact?.values.title ?? "",
      description: contact?.values.description ?? "",
      street: contact?.values.street ?? "",
      city: contact?.values.city ?? "",
    })
    setExtraPhones(
      String(contact?.values.otherPhones ?? "")
        .split(",")
        .map((phone) => phone.trim())
        .filter(Boolean),
    )
    setOwnerId(contact?.ownerId || currentUserId)
    setErrors({})
  }, [state, contact, fields, currentUserId])

  const readonly = mode === "view"
  const displayName = [values.firstName, values.lastName].map(String).filter(Boolean).join(" ") || String(contact?.values.name ?? "New contact")
  const selectedOwner = owners.find((owner) => owner.userId === ownerId) ?? null

  function setValue(field: string, value: ContactValue) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: "" }))
  }

  function validate() {
    const next: Record<string, string> = {}
    if (!String(values.firstName ?? "").trim()) next.firstName = "Enter the contact’s first name."
    if (!String(values.lastName ?? "").trim()) next.lastName = "Enter the contact’s last name."
    if (!String(values.phone ?? "").trim() && !String(values.email ?? "").trim()) {
      next.phone = "Add a phone number or email address."
      next.email = "Add an email address or phone number."
    }
    const phone = String(values.phone ?? "").trim()
    if (phone && !validInternationalPhone(phone)) next.phone = "Choose a country and enter a valid phone number."
    extraPhones.forEach((extra, index) => {
      if (extra.trim() && !validInternationalPhone(extra.trim())) next[`extraPhone-${index}`] = "Enter a valid phone number."
    })
    const email = String(values.email ?? "").trim()
    if (email && !/^\S+@\S+\.\S+$/.test(email)) next.email = "Enter a valid email address."
    for (const field of customFields) {
      if (field.required && !String(values[field.id] ?? "").trim()) next[field.id] = `${field.label} is required.`
    }
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
        body: JSON.stringify((() => {
          const payloadValues = {
            ...values,
            name: [values.firstName, values.lastName].map(String).filter(Boolean).join(" "),
            otherPhones: extraPhones.map((phone) => phone.trim()).filter(Boolean).join(", "),
            ownerId,
          }
          return contact ? { id: contact.id, values: payloadValues } : { values: payloadValues }
        })()),
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
    const inputId = `contact-${field.id}`
    let control: ReactNode
    if (field.type === "checkbox") {
      const checked = value === "true" || value === "Yes"
      control = (
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-labelledby={`${inputId}-label`}
          disabled={readonly}
          onClick={() => setValue(field.id, checked ? "false" : "true")}
          className="flex size-5 items-center justify-center rounded border border-input bg-background transition-colors data-[checked=true]:border-primary data-[checked=true]:bg-primary data-[checked=true]:text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
          data-checked={checked}
        >
          {checked ? <Check className="size-3.5" /> : null}
        </button>
      )
    } else if ((field.type === "single_select" || field.type === "multi_select") && field.options?.length) {
      control = (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<button type="button" id={inputId} disabled={readonly} className="flex h-11 w-full items-center justify-between rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50" />}
          >
            <span className={value ? "" : "text-muted-foreground"}>{value || "Select an option"}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {field.options.map((option) => (
              <DropdownMenuItem key={option} onClick={() => setValue(field.id, option)}>
                <span className="flex-1">{option}</span>
                {option === value ? <Check className="size-4 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    } else {
      const htmlType = field.type === "number" || field.type === "currency" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : field.type === "url" ? "url" : "text"
      control = <Input id={inputId} type={htmlType} value={value} onChange={(event) => setValue(field.id, event.target.value)} disabled={readonly} className="h-11 flex-1" />
    }
    return (
      <Field key={field.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
        <FieldLabel id={`${inputId}-label`} htmlFor={inputId} className="sm:w-36 sm:justify-end">{field.label}</FieldLabel>
        {control}
      </Field>
    )
  }

  return (
    <Sheet open={Boolean(state)} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-hidden bg-background p-0 data-[side=right]:sm:w-[min(720px,50vw)] data-[side=right]:sm:max-w-none">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="flex-row items-center border-b px-8 py-4 text-left">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-xl font-semibold tracking-tight">{mode === "create" ? "Create Contact" : readonly ? displayName : "Edit Contact"}</SheetTitle>
              <SheetDescription className="sr-only">{mode === "create" ? "Create a contact record" : "View or edit this contact record"}</SheetDescription>
            </div>
            {readonly ? <Button type="button" variant="outline" size="sm" onClick={() => setMode("edit")}><Pencil data-icon="inline-start" />Edit</Button> : null}
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-8 px-8 py-6">
              <section className="flex flex-col gap-6" aria-labelledby="contact-information-heading">
                <div className="flex items-center justify-between gap-4">
                  <h2 id="contact-information-heading" className="text-lg font-semibold">Contact Information</h2>
                  <div className="flex items-center gap-3 text-sm">
                    <span id="contact-owner-label">Owner</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<button type="button" aria-labelledby="contact-owner-label" disabled={readonly} className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-70" />}
                      >
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{ownerInitials(selectedOwner?.name ?? "?")}</span>
                        {selectedOwner?.name ?? "Unassigned"}
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        {owners.length === 0 ? <DropdownMenuItem disabled>No team members found</DropdownMenuItem> : owners.map((owner) => (
                          <DropdownMenuItem key={owner.userId} onClick={() => setOwnerId(owner.userId)}>
                            <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{ownerInitials(owner.name)}</span>
                            <span className="flex-1 truncate">{owner.name}{owner.userId === currentUserId ? " (You)" : ""}</span>
                            {owner.userId === ownerId ? <Check className="size-4 text-primary" /> : null}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <FieldGroup className="gap-5">
                  <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4" data-invalid={Boolean(errors.firstName)}>
                    <FieldLabel htmlFor="contact-first-name" className="sm:w-36 sm:justify-end">First Name</FieldLabel>
                    <div className="flex flex-1 flex-col gap-1.5"><Input id="contact-first-name" autoFocus={!readonly} value={String(values.firstName ?? "")} onChange={(event) => setValue("firstName", event.target.value)} disabled={readonly} aria-invalid={Boolean(errors.firstName)} className="h-11" /><FieldError>{errors.firstName}</FieldError></div>
                  </Field>
                  <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4" data-invalid={Boolean(errors.lastName)}>
                    <FieldLabel htmlFor="contact-last-name" className="sm:w-36 sm:justify-end">Last Name</FieldLabel>
                    <div className="flex flex-1 flex-col gap-1.5"><Input id="contact-last-name" value={String(values.lastName ?? "")} onChange={(event) => setValue("lastName", event.target.value)} disabled={readonly} aria-invalid={Boolean(errors.lastName)} className="h-11" /><FieldError>{errors.lastName}</FieldError></div>
                  </Field>
                  <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                    <FieldLabel htmlFor="contact-title" className="sm:w-36 sm:justify-end">Title</FieldLabel>
                    <Input id="contact-title" value={String(values.title ?? "")} onChange={(event) => setValue("title", event.target.value)} disabled={readonly} className="h-11 flex-1" />
                  </Field>
                  <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4" data-invalid={Boolean(errors.email)}>
                    <FieldLabel htmlFor="contact-email" className="sm:w-36 sm:justify-end">Email</FieldLabel>
                    <div className="flex flex-1 flex-col gap-1.5"><Input id="contact-email" type="email" value={String(values.email ?? "")} onChange={(event) => setValue("email", event.target.value)} disabled={readonly} aria-invalid={Boolean(errors.email)} className="h-11" /><FieldError>{errors.email}</FieldError></div>
                  </Field>
                  <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                    <FieldLabel htmlFor="contact-company" className="sm:w-36 sm:justify-end">Company Name</FieldLabel>
                    <div className="relative flex-1"><Input id="contact-company" value={String(values.company ?? "")} onChange={(event) => setValue("company", event.target.value)} disabled={readonly} className="h-11 pr-10" /><Building2 className="pointer-events-none absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" /></div>
                  </Field>
                  <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4" data-invalid={Boolean(errors.phone)}>
                    <div className="flex sm:w-36 sm:justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<button type="button" aria-label="Phone number type" disabled={readonly} className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none" />}
                        >
                          {phoneType} <ChevronDown className="size-3.5 text-muted-foreground" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-40">
                          {PHONE_TYPES.map((type) => (
                            <DropdownMenuItem key={type} onClick={() => setPhoneType(type)}>
                              <span className="flex-1">{type}</span>
                              {type === phoneType ? <Check className="size-4 text-primary" /> : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex flex-1 flex-col gap-2.5">
                      <div className="flex items-start gap-2">
                        <div className="flex flex-1 flex-col gap-1.5"><InternationalPhoneInput value={String(values.phone ?? "")} onChange={(value) => setValue("phone", value)} invalid={Boolean(errors.phone)} disabled={readonly} /><FieldError>{errors.phone}</FieldError></div>
                        {!readonly ? <Button type="button" variant="ghost" size="icon" className="mt-1 shrink-0 text-muted-foreground" aria-label="Add another phone number" onClick={() => setExtraPhones((current) => [...current, ""])}><PlusCircle className="size-5" /></Button> : null}
                      </div>
                      {extraPhones.map((extra, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <div className="flex flex-1 flex-col gap-1.5">
                            <InternationalPhoneInput
                              id={`contact-phone-extra-${index}`}
                              value={extra}
                              onChange={(value) => {
                                setExtraPhones((current) => current.map((item, i) => (i === index ? value : item)))
                                setErrors((current) => ({ ...current, [`extraPhone-${index}`]: "" }))
                              }}
                              invalid={Boolean(errors[`extraPhone-${index}`])}
                              disabled={readonly}
                            />
                            <FieldError>{errors[`extraPhone-${index}`]}</FieldError>
                          </div>
                          {!readonly ? <Button type="button" variant="ghost" size="icon" className="mt-1 shrink-0 text-muted-foreground" aria-label={`Remove phone number ${index + 2}`} onClick={() => setExtraPhones((current) => current.filter((_, i) => i !== index))}><MinusCircle className="size-5" /></Button> : null}
                        </div>
                      ))}
                    </div>
                  </Field>
                  <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                    <FieldLabel htmlFor="contact-description" className="sm:w-36 sm:justify-end">Description</FieldLabel>
                    <Textarea id="contact-description" value={String(values.description ?? "")} onChange={(event) => setValue("description", event.target.value)} disabled={readonly} rows={2} placeholder="A few words about this contact" className="min-h-11 flex-1 resize-none" />
                  </Field>
                </FieldGroup>
              </section>

              <Collapsible open={addressOpen} onOpenChange={setAddressOpen}>
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-2 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-safe:transition-transform motion-safe:duration-150"><span>Address Information</span><ChevronDown className="motion-safe:transition-transform motion-safe:duration-200 group-data-panel-open:rotate-180" /></CollapsibleTrigger>
                <CollapsibleContent className="data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-safe:transition-[height,opacity] motion-safe:duration-200">
                  <FieldGroup className="gap-5 pt-4">
                    <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                      <FieldLabel htmlFor="contact-street" className="sm:w-36 sm:justify-end">Street</FieldLabel>
                      <Input id="contact-street" value={String(values.street ?? "")} onChange={(event) => setValue("street", event.target.value)} disabled={readonly} className="h-11 flex-1" />
                    </Field>
                    <Field className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
                      <FieldLabel htmlFor="contact-city" className="sm:w-36 sm:justify-end">City</FieldLabel>
                      <Input id="contact-city" value={String(values.city ?? "")} onChange={(event) => setValue("city", event.target.value)} disabled={readonly} className="h-11 flex-1" />
                    </Field>
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={additionalOpen} onOpenChange={setAdditionalOpen}>
                <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-md py-2 text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-safe:transition-transform motion-safe:duration-150"><span>Additional Information</span><ChevronDown className="motion-safe:transition-transform motion-safe:duration-200 group-data-panel-open:rotate-180" /></CollapsibleTrigger>
                <CollapsibleContent className="data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 motion-safe:transition-[height,opacity] motion-safe:duration-200"><FieldGroup className="gap-5 pt-4">{customFields.length ? customFields.map(renderCustomField) : <p className="text-sm text-muted-foreground">No custom fields have been configured.</p>}</FieldGroup></CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>

          <SheetFooter className="flex-row items-center justify-between border-t bg-background px-8 py-3">
            <Button type="button" variant="link" className="h-auto px-0 text-primary" onClick={() => setFieldsEditorOpen(true)}>Customize Fields</Button>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" className="rounded-full px-6" onClick={() => mode === "edit" ? setMode("view") : onOpenChange(false)} disabled={saving}>Cancel</Button>
              {!readonly ? <Button type="submit" className="rounded-full px-6" disabled={saving}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : mode === "create" ? <Check data-icon="inline-start" /> : <Save data-icon="inline-start" />}{saving ? "Saving" : "Save"}</Button> : null}
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
      <EditContactFieldsSheet
        open={fieldsEditorOpen}
        fields={fields}
        preferences={preferences ?? { visible: fields.map((field) => field.id), order: fields.map((field) => field.id), frozen: [], widths: {} }}
        onOpenChange={setFieldsEditorOpen}
        onSaved={onSaved}
      />
    </Sheet>
  )
}

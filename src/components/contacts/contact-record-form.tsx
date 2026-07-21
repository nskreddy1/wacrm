"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"
import { ArrowLeft, Building2, Check, Loader2, Mail, Phone, UserRound } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import type { WorkspaceContact } from "@/lib/data/contacts/types"

const inputClass = "h-11 bg-background"

type ContactValues = { name: string; phone: string; email: string; company: string }

type ContactRecordFormProps = {
  mode: "create" | "edit"
  contact?: WorkspaceContact
}

export function ContactRecordForm({ mode, contact }: ContactRecordFormProps) {
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const [values, setValues] = useState<ContactValues>({
    name: String(contact?.values.name ?? ""),
    phone: String(contact?.values.phone ?? ""),
    email: String(contact?.values.email ?? ""),
    company: String(contact?.values.company ?? ""),
  })
  const [errors, setErrors] = useState<Partial<Record<keyof ContactValues, string>>>({})
  const [saving, setSaving] = useState(false)
  const isEdit = mode === "edit"

  function setValue(field: keyof ContactValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function validate() {
    const next: Partial<Record<keyof ContactValues, string>> = {}
    if (!values.name.trim()) next.name = "Enter the contact’s name."
    if (!values.phone.trim() && !values.email.trim()) {
      next.phone = "Add a phone number or email address."
      next.email = "Add an email address or phone number."
    }
    if (values.email.trim() && !/^\S+@\S+\.\S+$/.test(values.email.trim())) next.email = "Enter a valid email address."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      const response = await fetch("/api/v1/workspace/contacts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: contact?.id, values } : { values }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message ?? "Unable to save contact")
      toast.success(isEdit ? "Contact updated" : "Contact created")
      // Surgically revalidate every cached contacts query instead of
      // `router.refresh()` — the contacts list is client-side SWR, so a
      // full server re-render never updated it and only added latency.
      void mutate(
        (key) => typeof key === "string" && key.startsWith("/api/v1/workspace/contacts"),
        undefined,
        { revalidate: true },
      )
      router.push("/contacts")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save contact")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-full bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
          <Button variant="ghost" size="icon" aria-label="Back to contacts" onClick={() => router.push("/contacts")}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contacts</p>
            <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{isEdit ? "Edit contact" : "Create contact"}</h1>
          </div>
          <Button type="submit" form="contact-record-form" disabled={saving}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
            {saving ? "Saving" : isEdit ? "Save changes" : "Create contact"}
          </Button>
        </div>
      </header>

      <form id="contact-record-form" onSubmit={submit} noValidate className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:items-start">
        <aside className="flex flex-col gap-3 lg:sticky lg:top-6 lg:w-64">
          <div className="flex size-14 items-center justify-center rounded-xl border bg-background shadow-xs"><UserRound className="size-6 text-primary" /></div>
          <div>
            <h2 className="font-semibold text-foreground">Contact record</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Maintain the identity and communication details your team uses across campaigns and conversations.</p>
          </div>
          {isEdit && contact ? <p className="text-xs text-muted-foreground">Last updated {new Date(contact.updatedAt).toLocaleDateString()}</p> : null}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-6 rounded-xl border bg-card p-5 shadow-xs sm:p-6">
          <div>
            <h2 className="text-base font-semibold text-card-foreground">Identity</h2>
            <p className="mt-1 text-sm text-muted-foreground">The primary details used to identify this person.</p>
          </div>
          <div className="flex flex-col gap-5 sm:grid sm:grid-cols-2">
            <label className="flex flex-col gap-2 sm:col-span-2" htmlFor="contact-name">
              <span className="text-sm font-medium text-foreground">Full name <span aria-hidden="true">*</span></span>
              <div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="contact-name" autoFocus autoComplete="name" value={values.name} onChange={(event) => setValue("name", event.target.value)} aria-invalid={Boolean(errors.name)} className={`${inputClass} pl-9`} placeholder="e.g. Priya Sharma" /></div>
              {errors.name ? <span className="text-xs text-destructive">{errors.name}</span> : null}
            </label>
            <label className="flex flex-col gap-2" htmlFor="contact-company">
              <span className="text-sm font-medium text-foreground">Company</span>
              <div className="relative"><Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="contact-company" autoComplete="organization" value={values.company} onChange={(event) => setValue("company", event.target.value)} className={`${inputClass} pl-9`} placeholder="Company or organization" /></div>
            </label>
          </div>

          <Separator />

          <div>
            <h2 className="text-base font-semibold text-card-foreground">Communication</h2>
            <p className="mt-1 text-sm text-muted-foreground">At least one reliable contact method is required.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex flex-col gap-2" htmlFor="contact-phone">
              <span className="text-sm font-medium text-foreground">Phone number</span>
              <div className="relative"><Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="contact-phone" type="tel" autoComplete="tel" inputMode="tel" value={values.phone} onChange={(event) => setValue("phone", event.target.value)} aria-invalid={Boolean(errors.phone)} className={`${inputClass} pl-9`} placeholder="+1 555 000 0000" /></div>
              {errors.phone ? <span className="text-xs text-destructive">{errors.phone}</span> : <span className="text-xs text-muted-foreground">Include the country code for messaging.</span>}
            </label>
            <label className="flex flex-col gap-2" htmlFor="contact-email">
              <span className="text-sm font-medium text-foreground">Email address</span>
              <div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="contact-email" type="email" autoComplete="email" inputMode="email" value={values.email} onChange={(event) => setValue("email", event.target.value)} aria-invalid={Boolean(errors.email)} className={`${inputClass} pl-9`} placeholder="name@company.com" /></div>
              {errors.email ? <span className="text-xs text-destructive">{errors.email}</span> : <span className="text-xs text-muted-foreground">Used for outreach and record matching.</span>}
            </label>
          </div>

          <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => router.push("/contacts")} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}{saving ? "Saving" : isEdit ? "Save changes" : "Create contact"}</Button>
          </div>
        </section>
      </form>
    </main>
  )
}

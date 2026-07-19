"use client"

import { useMemo, useRef, useState } from "react"
import { ArrowRight, Building2, CalendarDays, CircleDollarSign, Contact, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { ActionResult } from "@/lib/pipelines/actions"
import type { PipelineDeal, PipelineSnapshot } from "@/lib/pipelines/domain"
import { dealInputSchema, type DealInput } from "@/lib/pipelines/validation"

function draftFrom(deal: PipelineDeal | null, snapshot: PipelineSnapshot, stageId: string): DealInput {
  return {
    id: deal?.id,
    pipelineId: snapshot.pipeline.id,
    stageId: deal?.stageId ?? stageId,
    contactId: deal?.contactId ?? null,
    assignedTo: deal?.assignedTo ?? null,
    title: deal?.title ?? "",
    value: deal?.value ?? 0,
    currency: deal?.currency ?? "USD",
    company: deal?.company ?? null,
    priority: deal?.priority ?? "normal",
    probability: deal?.probability ?? 20,
    source: deal?.source ?? null,
    activity: deal?.activity ?? null,
    nextStep: deal?.nextStep ?? null,
    description: deal?.description ?? null,
    due: deal?.due ?? null,
    status: deal?.status ?? "open",
    position: deal?.position ?? 0,
  }
}

export function PipelineDealEditor({ open, deal, defaultStageId, snapshot, pending, onOpenChange, onSave }: {
  open: boolean
  deal: PipelineDeal | null
  defaultStageId: string
  snapshot: PipelineSnapshot
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSave: (input: DealInput) => Promise<ActionResult<PipelineDeal>>
}) {
  const [draft, setDraft] = useState(() => draftFrom(deal, snapshot, defaultStageId))
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const stageName = snapshot.stages.find((stage) => stage.id === draft.stageId)?.name ?? "No stage"
  const isCreate = !deal
  const busy = pending || submitting
  const canSubmit = draft.title.trim().length > 0 && draft.currency.trim().length === 3 && !busy
  const formattedValue = useMemo(() => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: draft.currency || "USD", maximumFractionDigits: 0 }).format(draft.value || 0)
    } catch {
      return `${draft.currency || "USD"} ${draft.value || 0}`
    }
  }, [draft.currency, draft.value])

  function update<K extends keyof DealInput>(key: K, value: DealInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    if (error) setError("")
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = dealInputSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the required fields")
      if (!draft.title.trim()) titleRef.current?.focus()
      return
    }
    setSubmitting(true)
    const result = await onSave(parsed.data)
    if (!result.ok) {
      setError(result.error)
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-hidden border-l bg-background p-0 sm:max-w-2xl" showCloseButton>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <SheetHeader className="border-b px-5 py-5 sm:px-7">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>{snapshot.pipeline.name}</span>
              <ArrowRight className="size-3" aria-hidden="true" />
              <span>{stageName}</span>
            </div>
            <SheetTitle className="text-balance text-xl font-semibold tracking-tight">
              {isCreate ? "Create a new deal" : "Edit deal"}
            </SheetTitle>
            <SheetDescription className="text-pretty">
              {isCreate ? "Capture the essentials now. You can add more context as the deal progresses." : "Keep this opportunity accurate and easy for your team to act on."}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-7 px-5 py-6 sm:px-7">
              <section className="flex flex-col gap-4" aria-labelledby="deal-essential-heading">
                <div>
                  <h2 id="deal-essential-heading" className="text-sm font-semibold">Deal essentials</h2>
                  <p className="text-sm text-muted-foreground">Name the opportunity and set its commercial value.</p>
                </div>
                <FieldGroup className="gap-4">
                  <Field data-invalid={!draft.title.trim() && Boolean(error)}>
                    <FieldLabel htmlFor="deal-title">Deal name</FieldLabel>
                    <Input ref={titleRef} id="deal-title" value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="Acme annual contract" autoFocus required aria-invalid={!draft.title.trim() && Boolean(error)} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                    <Field>
                      <FieldLabel htmlFor="deal-value"><CircleDollarSign aria-hidden="true" />Amount</FieldLabel>
                      <Input id="deal-value" type="number" min="0" step="0.01" inputMode="decimal" value={draft.value} onChange={(event) => update("value", Number(event.target.value))} />
                      <FieldDescription>{formattedValue}</FieldDescription>
                    </Field>
                    <Field data-invalid={draft.currency.trim().length !== 3 && Boolean(error)}>
                      <FieldLabel htmlFor="deal-currency">Currency</FieldLabel>
                      <Input id="deal-currency" maxLength={3} value={draft.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} aria-invalid={draft.currency.trim().length !== 3 && Boolean(error)} />
                    </Field>
                  </div>
                </FieldGroup>
              </section>

              <section className="flex flex-col gap-4 border-t pt-6" aria-labelledby="deal-routing-heading">
                <div>
                  <h2 id="deal-routing-heading" className="text-sm font-semibold">Routing</h2>
                  <p className="text-sm text-muted-foreground">Place the deal where the team expects to find it.</p>
                </div>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="deal-stage">Stage</FieldLabel>
                    <Select items={Object.fromEntries(snapshot.stages.map((stage) => [stage.id, stage.name]))} value={draft.stageId} onValueChange={(value) => value && update("stageId", value)}>
                      <SelectTrigger id="deal-stage" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>{snapshot.stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deal-owner"><UserRound aria-hidden="true" />Owner</FieldLabel>
                    <Select items={{ none: "Unassigned", ...Object.fromEntries(snapshot.members.map((member) => [member.id, member.name])) }} value={draft.assignedTo ?? "none"} onValueChange={(value) => value && update("assignedTo", value === "none" ? null : value)}>
                      <SelectTrigger id="deal-owner" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup><SelectItem value="none">Unassigned</SelectItem>{snapshot.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deal-contact"><Contact aria-hidden="true" />Contact</FieldLabel>
                    <Select items={{ none: "No contact", ...Object.fromEntries(snapshot.contacts.map((contact) => [contact.id, contact.name])) }} value={draft.contactId ?? "none"} onValueChange={(value) => value && update("contactId", value === "none" ? null : value)}>
                      <SelectTrigger id="deal-contact" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup><SelectItem value="none">No contact</SelectItem>{snapshot.contacts.map((contact) => <SelectItem key={contact.id} value={contact.id}>{contact.name}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deal-company"><Building2 aria-hidden="true" />Company</FieldLabel>
                    <Input id="deal-company" value={draft.company ?? ""} onChange={(event) => update("company", event.target.value || null)} placeholder="Acme Inc." />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deal-date"><CalendarDays aria-hidden="true" />Expected close</FieldLabel>
                    <Input id="deal-date" type="date" value={draft.due ?? ""} onChange={(event) => update("due", event.target.value || null)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="deal-source">Source</FieldLabel>
                    <Input id="deal-source" value={draft.source ?? ""} onChange={(event) => update("source", event.target.value || null)} placeholder="Referral, campaign, inbound…" />
                  </Field>
                </FieldGroup>
              </section>

              <section className="flex flex-col gap-4 border-t pt-6" aria-labelledby="deal-context-heading">
                <div>
                  <h2 id="deal-context-heading" className="text-sm font-semibold">Context</h2>
                  <p className="text-sm text-muted-foreground">Leave a useful handoff for the next person.</p>
                </div>
                <Field>
                  <FieldLabel htmlFor="deal-description">Notes</FieldLabel>
                  <Textarea id="deal-description" value={draft.description ?? ""} onChange={(event) => update("description", event.target.value || null)} placeholder="Buying intent, constraints, and what matters next…" rows={5} />
                  <FieldDescription>{(draft.description ?? "").length} / 4000</FieldDescription>
                </Field>
              </section>

              {error && <Field data-invalid><FieldError>{error}</FieldError></Field>}
            </div>
          </ScrollArea>

          <SheetFooter className="border-t bg-background/95 px-5 py-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p className="hidden text-xs text-muted-foreground sm:block">Press Esc to cancel</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={!canSubmit}>{busy ? (isCreate ? "Creating…" : "Saving…") : (isCreate ? "Create deal" : "Save changes")}</Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

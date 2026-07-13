"use client"

import { useState } from "react"
import { AlertCircle, CalendarDays, CircleDollarSign, Contact, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { ActionResult } from "@/lib/pipelines/actions"
import type { PipelineDeal, PipelineSnapshot } from "@/lib/pipelines/domain"
import type { DealInput } from "@/lib/pipelines/validation"
import { cn } from "@/lib/utils"

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

export function PipelineDealEditor({ open, deal, defaultStageId, snapshot, pending, onOpenChange, onSave }: { open: boolean; deal: PipelineDeal | null; defaultStageId: string; snapshot: PipelineSnapshot; pending: boolean; onOpenChange: (open: boolean) => void; onSave: (input: DealInput) => Promise<ActionResult<PipelineDeal>> }) {
  const [draft, setDraft] = useState(() => draftFrom(deal, snapshot, defaultStageId))
  const [error, setError] = useState("")
  const selectedStage = snapshot.stages.find((stage) => stage.id === draft.stageId)
  const selectedContact = snapshot.contacts.find((contact) => contact.id === draft.contactId)
  const selectedOwner = snapshot.members.find((member) => member.id === draft.assignedTo)

  async function submit() {
    setError("")
    const result = await onSave(draft)
    if (!result.ok) setError(result.error)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{deal ? deal.title : "Create deal"}</SheetTitle>
          <SheetDescription>Manage the opportunity, owner, value, and next action.</SheetDescription>
        </SheetHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Deal name" htmlFor="deal-title" wide>
                <Input id="deal-title" autoFocus required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Northstar annual plan" aria-invalid={Boolean(error) && !draft.title.trim()} />
              </Field>

              <Field label="Amount" htmlFor="deal-amount" icon={<CircleDollarSign />}>
                <Input id="deal-amount" type="number" min="0" step="0.01" value={draft.value} onChange={(event) => setDraft({ ...draft, value: Number(event.target.value) })} />
              </Field>
              <Field label="Currency" htmlFor="deal-currency">
                <Input id="deal-currency" required maxLength={3} value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} />
              </Field>

              <Field label="Stage" icon={<CalendarDays />}>
                <Select value={draft.stageId} onValueChange={(value) => value && setDraft({ ...draft, stageId: value })}>
                  <SelectTrigger className="w-full"><span className="truncate">{selectedStage?.name ?? "Select a stage"}</span></SelectTrigger>
                  <SelectContent><SelectGroup>{snapshot.stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field label="Closing date" htmlFor="deal-due">
                <Input id="deal-due" type="date" value={draft.due ?? ""} onChange={(event) => setDraft({ ...draft, due: event.target.value || null })} />
              </Field>

              <Field label="Contact" icon={<Contact />}>
                <Select value={draft.contactId ?? "none"} onValueChange={(value) => value && setDraft({ ...draft, contactId: value === "none" ? null : value })}>
                  <SelectTrigger className="w-full"><span className="truncate">{selectedContact?.name ?? "No contact"}</span></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem value="none">No contact</SelectItem>{snapshot.contacts.map((contact) => <SelectItem key={contact.id} value={contact.id}>{contact.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field label="Owner" icon={<UserRound />}>
                <Select value={draft.assignedTo ?? "none"} onValueChange={(value) => value && setDraft({ ...draft, assignedTo: value === "none" ? null : value })}>
                  <SelectTrigger className="w-full"><span className="truncate">{selectedOwner?.name ?? "Unassigned"}</span></SelectTrigger>
                  <SelectContent><SelectGroup><SelectItem value="none">Unassigned</SelectItem>{snapshot.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>

              <Field label="Company" htmlFor="deal-company">
                <Input id="deal-company" value={draft.company ?? ""} onChange={(event) => setDraft({ ...draft, company: event.target.value || null })} placeholder={selectedContact?.company ?? "Company name"} />
              </Field>
              <Field label="Probability" htmlFor="deal-probability">
                <div className="relative"><Input id="deal-probability" type="number" min="0" max="100" value={draft.probability} onChange={(event) => setDraft({ ...draft, probability: Number(event.target.value) })} className="pr-8" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span></div>
              </Field>

              <Field label="Next step" htmlFor="deal-next-step" wide>
                <Input id="deal-next-step" value={draft.nextStep ?? ""} onChange={(event) => setDraft({ ...draft, nextStep: event.target.value || null })} placeholder="What needs to happen next?" />
              </Field>
              <Field label="Description" htmlFor="deal-description" wide>
                <Textarea id="deal-description" rows={4} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value || null })} placeholder="Add context, requirements, or notes…" />
              </Field>
            </div>

            {error && <div role="alert" className="mt-5 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Deal couldn&apos;t be saved</p><p className="mt-0.5 text-pretty">{error}</p></div></div>}
          </div>

          <SheetFooter className="border-t bg-background px-5 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !draft.title.trim() || !draft.stageId}>{pending ? "Saving…" : deal ? "Save changes" : "Create deal"}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, htmlFor, wide, icon, children }: { label: string; htmlFor?: string; wide?: boolean; icon?: React.ReactNode; children: React.ReactNode }) {
  return <div className={cn("flex min-w-0 flex-col gap-2", wide && "sm:col-span-2")}><Label htmlFor={htmlFor} className="flex items-center gap-1.5">{icon && <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>}{label}</Label>{children}</div>
}

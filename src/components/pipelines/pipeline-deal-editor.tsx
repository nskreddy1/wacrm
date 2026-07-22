"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Building2, Contact, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { RecordCollapsible, RecordField, RecordLookup, RecordOwnerPicker, RecordSection, RecordSheet } from "@/components/shared/record-sheet"
import { QuickCreateContact } from "@/components/contacts/quick-create-contact"
import { getDealFieldLayoutAction, listDealItemsAction, saveDealFieldLayoutAction, saveDealItemsAction, type ActionResult } from "@/lib/pipelines/actions"
import type { PipelineDeal, PipelineSnapshot } from "@/lib/pipelines/domain"
import { dealInputSchema, type DealFieldLayout, type DealInput } from "@/lib/pipelines/validation"
import { getCurrencySymbol } from "@/lib/currency"
import { useAuth } from "@/hooks/use-auth"
import { DealFieldsEditor } from "./deal-fields-editor"
import { DealItemsTable, itemTotal, type DraftDealItem } from "./deal-items-table"

function draftFrom(deal: PipelineDeal | null, snapshot: PipelineSnapshot, stageId: string, currency: string): DealInput {
  return {
    id: deal?.id,
    pipelineId: snapshot.pipeline.id,
    stageId: deal?.stageId ?? stageId,
    contactId: deal?.contactId ?? null,
    catalogItemId: deal?.catalogItemId ?? null,
    assignedTo: deal?.assignedTo ?? null,
    title: deal?.title ?? "",
    value: deal?.value ?? 0,
    // Deals always carry the workspace currency (Settings → Deals);
    // saving an old deal migrates it to the global setting.
    currency,
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
    customValues: deal?.customValues ?? {},
  }
}

export function PipelineDealEditor({ open, deal, defaultStageId, defaultSubPipelineId, snapshot, pending, onOpenChange, onSave }: {
  open: boolean
  deal: PipelineDeal | null
  defaultStageId: string
  defaultSubPipelineId?: string
  snapshot: PipelineSnapshot
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSave: (input: DealInput, subPipelineId?: string) => Promise<ActionResult<PipelineDeal>>
}) {
  const { defaultCurrency: workspaceCurrency } = useAuth()
  const [draft, setDraft] = useState(() => draftFrom(deal, snapshot, defaultStageId, workspaceCurrency))
  const [subPipelineId, setSubPipelineId] = useState(() => defaultSubPipelineId ?? snapshot.subPipelines.find((entry) => deal && entry.dealIds.includes(deal.id))?.id ?? snapshot.subPipelines[0]?.id ?? "")
  const [items, setItems] = useState<DraftDealItem[]>([])
  const [extraContacts, setExtraContacts] = useState<{ id: string; name: string }[]>([])
  const [quickContactOpen, setQuickContactOpen] = useState(false)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [layoutPending, setLayoutPending] = useState(false)
  const { data: layout, mutate: mutateLayout } = useSWR(
    open ? ["deal-field-layout", snapshot.pipeline.id] : null,
    async () => {
      const result = await getDealFieldLayoutAction(snapshot.pipeline.id)
      return result.ok ? result.data : { hidden: [], custom: [] }
    },
  )
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Load persisted line items when editing an existing deal
  useEffect(() => {
    let cancelled = false
    if (open && deal?.id) {
      listDealItemsAction(snapshot.pipeline.id, deal.id).then((result) => {
        if (!cancelled && result.ok) setItems(result.data.map((item) => ({ key: item.id, id: item.id, catalogItemId: item.catalogItemId, name: item.name, listPrice: item.listPrice, quantity: item.quantity, discountPct: item.discountPct })))
      })
    } else {
      setItems([])
    }
    return () => { cancelled = true }
  }, [open, deal?.id, snapshot.pipeline.id])

  const hidden = useMemo(() => new Set(layout?.hidden ?? []), [layout])
  const [salesOpen, setSalesOpen] = useState(Boolean(deal && (deal.priority !== "normal" || deal.probability !== 20 || deal.status !== "open" || deal.nextStep || deal.activity)))
  const isCreate = !deal
  const busy = pending || submitting
  const contactOptions = useMemo(() => {
    const known = snapshot.contacts.map((contact) => ({ id: contact.id, label: contact.name }))
    const extras = extraContacts.filter((extra) => !snapshot.contacts.some((contact) => contact.id === extra.id)).map((extra) => ({ id: extra.id, label: extra.name }))
    return [...extras, ...known]
  }, [snapshot.contacts, extraContacts])
  const owners = useMemo(() => snapshot.members.map((member) => ({ userId: member.id, name: member.name })), [snapshot.members])
  // AI-AGENT NOTE — DO NOT DELETE. FUTURE FEATURE: options for the Company
  // lookup (see the commented RecordLookup in the Company Name field below).
  // Currently derived from existing deal companies; swap to the Companies
  // module records once that module exists.
  const companyOptions = useMemo(() => {
    const names = new Set<string>()
    for (const entry of snapshot.deals) if (entry.company) names.add(entry.company)
    if (draft.company) names.add(draft.company)
    return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ id: name, label: name }))
  }, [snapshot.deals, draft.company])
  void companyOptions // referenced by the future-feature company lookup (kept intentionally)

  function update<K extends keyof DealInput>(key: K, value: DealInput[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    if (error) setError("")
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = dealInputSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the required fields")
      return
    }
    setSubmitting(true)
    try {
      const result = await onSave(parsed.data, subPipelineId || undefined)
      if (!result.ok) { setError(result.error); return }
      // Persist the Associated Products line items against the saved deal
      const dealId = result.data?.id ?? deal?.id
      if (dealId) {
        const itemsResult = await saveDealItemsAction({
          pipelineId: snapshot.pipeline.id,
          dealId,
          items: items.map((item, index) => ({ id: item.id, catalogItemId: item.catalogItemId, name: item.name, listPrice: item.listPrice, quantity: item.quantity, discountPct: item.discountPct, position: index })),
        })
        if (!itemsResult.ok) setError(`Deal saved, but the products failed: ${itemsResult.error}`)
      }
    } catch {
      setError("The deal could not be saved. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  async function saveLayout(next: DealFieldLayout) {
    setLayoutPending(true)
    try {
      const result = await saveDealFieldLayoutAction(snapshot.pipeline.id, next)
      if (result.ok) { await mutateLayout(result.data, { revalidate: false }); setFieldsOpen(false) }
    } finally {
      setLayoutPending(false)
    }
  }

  return (
    <>
      <RecordSheet
        open={open}
        title={isCreate ? "Create Deal" : "Edit Deal"}
        description={isCreate ? "Create a deal record" : "Edit this deal record"}
        saving={busy}
        isCreate={isCreate}
        onOpenChange={onOpenChange}
        onSubmit={submit}
        onCustomize={() => setFieldsOpen(true)}
      >
        <RecordSection id="deal-information" title="Deal Information" actions={<RecordOwnerPicker owners={owners} value={draft.assignedTo ?? ""} disabled={false} onChange={(userId) => update("assignedTo", userId || null)} />}>
          <RecordField label="Deal Name" htmlFor="deal-title" error={!draft.title.trim() && error ? error : undefined}>
            <Input id="deal-title" autoFocus value={draft.title} onChange={(event) => update("title", event.target.value)} aria-invalid={!draft.title.trim() && Boolean(error)} className="h-11" />
          </RecordField>
          {!hidden.has("company") && (
            <RecordField label="Company Name" htmlFor="deal-company">
              {/*
                =====================================================================
                AI-AGENT NOTE — DO NOT DELETE THE COMMENTED CODE BELOW.
                FUTURE FEATURE: Company lookup. There is no Companies module yet,
                so Company is a plain text input for now. Once a companies table /
                module exists, replace the <Input> below with this RecordLookup and
                wire `companyOptions` to real company records:

                <RecordLookup
                  id="deal-company"
                  value={draft.company ?? null}
                  options={companyOptions}
                  placeholder="Choose or type a company"
                  icon={<Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  allowCustom
                  onSelect={(companyName) => update("company", companyName)}
                />
                =====================================================================
              */}
              <div className="relative">
                <Input id="deal-company" value={draft.company ?? ""} onChange={(event) => update("company", event.target.value || null)} className="h-11 pr-10" />
                <Building2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              </div>
            </RecordField>
          )}
          {!hidden.has("contact") && (
            <RecordField label="Contact Name" htmlFor="deal-contact">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <RecordLookup
                    id="deal-contact"
                    value={draft.contactId ?? null}
                    options={contactOptions}
                    placeholder="Choose a contact"
                    icon={<Contact className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    createLabel="New Contact"
                    onSelect={(id) => update("contactId", id)}
                    onCreateNew={() => setQuickContactOpen(true)}
                  />
                </div>
                <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label="Quick create contact" onClick={() => setQuickContactOpen(true)}>
                  <Plus className="size-5" />
                </Button>
              </div>
            </RecordField>
          )}
          <RecordField label="Sub-Pipeline & Stage" htmlFor="deal-stage">
            <div className="grid gap-2 sm:grid-cols-2">
              <Select items={Object.fromEntries(snapshot.subPipelines.map((entry) => [entry.id, entry.name]))} value={subPipelineId} onValueChange={(value) => value && setSubPipelineId(value)}>
                <SelectTrigger aria-label="Sub-pipeline" className="h-11 w-full"><SelectValue placeholder="Choose a board" /></SelectTrigger>
                <SelectContent><SelectGroup>{snapshot.subPipelines.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
              <Select items={Object.fromEntries(snapshot.stages.map((stage) => [stage.id, stage.name]))} value={draft.stageId} onValueChange={(value) => value && update("stageId", value)}>
                <SelectTrigger id="deal-stage" aria-label="Stage" className="h-11 w-full"><SelectValue placeholder="Choose a stage" /></SelectTrigger>
                <SelectContent><SelectGroup>{snapshot.stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>
          </RecordField>
          <RecordField label={`Amount (${workspaceCurrency})`} htmlFor="deal-value">
            <div className="relative">
              <Input id="deal-value" type="number" min="0" step="0.01" inputMode="decimal" value={draft.value} onChange={(event) => update("value", Number(event.target.value))} className="h-11 pr-9" />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground" aria-hidden="true">{getCurrencySymbol(workspaceCurrency)}</span>
            </div>
          </RecordField>
          {!hidden.has("due") && (
            <RecordField label="Closing Date" htmlFor="deal-date">
              <Input id="deal-date" type="date" value={draft.due ?? ""} onChange={(event) => update("due", event.target.value || null)} className="h-11" />
            </RecordField>
          )}
          {!hidden.has("source") && (
            <RecordField label="Source" htmlFor="deal-source">
              <Input id="deal-source" value={draft.source ?? ""} onChange={(event) => update("source", event.target.value || null)} placeholder="Referral, campaign, inbound…" className="h-11" />
            </RecordField>
          )}
          {!hidden.has("description") && (
            <RecordField label="Description" htmlFor="deal-description">
              <Textarea id="deal-description" value={draft.description ?? ""} onChange={(event) => update("description", event.target.value || null)} rows={2} placeholder="A few words about this deal" className="min-h-11 resize-none" />
            </RecordField>
          )}
        </RecordSection>

        {(layout?.custom.length ?? 0) > 0 && (
          <RecordSection id="deal-additional" title="Additional Information">
            {layout?.custom.map((field) => (
              <RecordField key={field.id} label={field.label} htmlFor={`deal-custom-${field.id}`}>
                <Input id={`deal-custom-${field.id}`} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={draft.customValues?.[field.id] ?? ""} onChange={(event) => update("customValues", { ...(draft.customValues ?? {}), [field.id]: event.target.value })} className="h-11" />
              </RecordField>
            ))}
          </RecordSection>
        )}

        {!hidden.has("salesDetails") && (
          <RecordCollapsible title="Sales Details" open={salesOpen} onOpenChange={setSalesOpen}>
            <RecordField label="Priority" htmlFor="deal-priority">
              <Select items={{ low: "Low", normal: "Normal", high: "High", hot: "Hot" }} value={draft.priority} onValueChange={(value) => value && update("priority", value as DealInput["priority"])}>
                <SelectTrigger id="deal-priority" className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{(["low", "normal", "high", "hot"] as const).map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </RecordField>
            <RecordField label="Status" htmlFor="deal-status">
              <Select items={{ open: "Open", won: "Won", lost: "Lost" }} value={draft.status} onValueChange={(value) => value && update("status", value as DealInput["status"])}>
                <SelectTrigger id="deal-status" className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{(["open", "won", "lost"] as const).map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </RecordField>
            <RecordField label="Probability (%)" htmlFor="deal-probability">
              <div className="flex items-center gap-3">
                <Input id="deal-probability" type="range" min="0" max="100" step="5" value={draft.probability} onChange={(event) => update("probability", Number(event.target.value))} className="px-0" />
                <span className="w-12 text-right text-sm font-semibold tabular-nums">{draft.probability}%</span>
              </div>
            </RecordField>
            <RecordField label="Next Step" htmlFor="deal-next-step">
              <Input id="deal-next-step" value={draft.nextStep ?? ""} onChange={(event) => update("nextStep", event.target.value || null)} className="h-11" />
            </RecordField>
          </RecordCollapsible>
        )}

        {!hidden.has("catalog") && (
          <DealItemsTable items={items} currency={workspaceCurrency} onChange={(next) => { setItems(next); const total = next.reduce((sum, item) => sum + itemTotal(item), 0); if (total > 0) update("value", Math.round(total * 100) / 100) }} />
        )}

        {error && draft.title.trim() ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </RecordSheet>

      <QuickCreateContact
        open={quickContactOpen}
        onOpenChange={setQuickContactOpen}
        onCreated={(contact) => { setExtraContacts((current) => [...current, contact]); update("contactId", contact.id) }}
      />

      {fieldsOpen && layout && <DealFieldsEditor open={fieldsOpen} pipelineName={snapshot.pipeline.name} layout={layout} pending={layoutPending} onOpenChange={setFieldsOpen} onSave={saveLayout} />}
    </>
  )
}

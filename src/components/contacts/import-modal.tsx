"use client"

import { useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { ArrowLeft, ArrowRight, Check, Download, FileSpreadsheet, Loader2, Upload, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ContactField, ContactValue } from "@/lib/data/contacts/types"
import { validInternationalPhone } from "@/components/contacts/international-phone-input"

const IGNORE = "__ignore__"
type Store = { data: { fields: ContactField[] } }
type CsvData = { headers: string[]; rows: string[][] }
type ImportError = { row: number; message: string; source: string[] }

function parseCsv(text: string): CsvData {
  const rows: string[][] = []
  let row: string[] = [], value = "", quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"' && quoted && text[index + 1] === '"') { value += '"'; index++ }
    else if (char === '"') quoted = !quoted
    else if (char === "," && !quoted) { row.push(value.trim()); value = "" }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = "" }
    else value += char
  }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row)
  return { headers: rows[0] ?? [], rows: rows.slice(1) }
}

function autoMap(headers: string[], fields: ContactField[]) {
  const used = new Set<string>()
  return Object.fromEntries(headers.map((header) => {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, "")
    const match = fields.find((field) => !used.has(field.id) && (field.label.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized || field.id === normalized))
    if (match) used.add(match.id)
    return [header, match?.id ?? IGNORE]
  }))
}

export function ImportModal({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { data } = useSWR<Store>(open ? "/api/v1/workspace/contacts?import=1" : null)
  const fields = data?.data.fields ?? []
  const [step, setStep] = useState(0)
  const [fileName, setFileName] = useState("")
  const [csv, setCsv] = useState<CsvData>({ headers: [], rows: [] })
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: ImportError[] } | null>(null)

  const mappedTargets = Object.values(mapping).filter((value) => value !== IGNORE)
  const duplicateTargets = new Set(mappedTargets.filter((value, index) => mappedTargets.indexOf(value) !== index))
  const hasIdentity = mappedTargets.includes("name") && (mappedTargets.includes("phone") || mappedTargets.includes("email"))
  const preview = csv.rows.slice(0, 8)
  const errors = useMemo(() => csv.rows.flatMap((row, index) => {
    const values = valuesForRow(row)
    const issues: string[] = []
    if (!String(values.name ?? "").trim()) issues.push("name is required")
    if (!String(values.phone ?? "").trim() && !String(values.email ?? "").trim()) issues.push("phone or email is required")
    if (values.phone && !validInternationalPhone(String(values.phone))) issues.push("phone must include a valid country code")
    if (values.email && !/^\S+@\S+\.\S+$/.test(String(values.email))) issues.push("email is invalid")
    return issues.length ? [{ row: index + 2, message: issues.join("; "), source: row }] : []
  }), [csv.rows, mapping])

  function valuesForRow(row: string[]) {
    const values: Record<string, ContactValue> = {}
    csv.headers.forEach((header, index) => { const target = mapping[header]; if (target && target !== IGNORE) values[target] = row[index] ?? "" })
    return values
  }

  async function chooseFile(file?: File) {
    if (!file) return
    if (file.size > 5_000_000) { toast.error("CSV files must be smaller than 5 MB"); return }
    const parsed = parseCsv(await file.text())
    if (!parsed.headers.length || !parsed.rows.length) { toast.error("The CSV does not contain any data rows"); return }
    setFileName(file.name); setCsv(parsed); setMapping(autoMap(parsed.headers, fields)); setStep(1); setResult(null)
  }

  async function runImport() {
    if (errors.length) { toast.error("Resolve invalid rows before importing"); return }
    setImporting(true); setProgress(0)
    let imported = 0, skipped = 0
    const importErrors: ImportError[] = []
    for (let index = 0; index < csv.rows.length; index++) {
      const response = await fetch("/api/v1/workspace/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: valuesForRow(csv.rows[index]) }) })
      const payload = await response.json()
      if (response.ok) imported++
      else if (String(payload.error?.message ?? "").toLowerCase().includes("already exists")) skipped++
      else importErrors.push({ row: index + 2, message: payload.error?.message ?? "Import failed", source: csv.rows[index] })
      setProgress(Math.round(((index + 1) / csv.rows.length) * 100))
    }
    setResult({ imported, skipped, errors: importErrors }); setImporting(false); setStep(3)
    if (imported) { onImported(); toast.success(`${imported} contacts imported`) }
  }

  function downloadErrors() {
    if (!result?.errors.length) return
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
    const text = [["row", "error", ...csv.headers], ...result.errors.map((error) => [String(error.row), error.message, ...error.source])].map((row) => row.map(escape).join(",")).join("\n")
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); link.download = "contact-import-errors.csv"; link.click(); URL.revokeObjectURL(link.href)
  }

  function close(next: boolean) { if (!next && !importing) { setStep(0); setCsv({ headers: [], rows: [] }); setResult(null); setFileName("") } onOpenChange(next) }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-5"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-lg border bg-primary text-primary-foreground"><FileSpreadsheet className="size-5" /></div><div><DialogTitle>Import contacts from CSV</DialogTitle><DialogDescription>Map any spreadsheet columns to core and custom contact fields.</DialogDescription></div></div><div className="mt-4 flex gap-2">{["Upload", "Map fields", "Validate", "Results"].map((label, index) => <Badge key={label} variant={step === index ? "default" : step > index ? "secondary" : "outline"} className="gap-1">{step > index && <Check className="size-3" />}{index + 1}. {label}</Badge>)}</div></DialogHeader>
        <ScrollArea className="min-h-0 flex-1"><div className="p-6">
          {step === 0 && <button type="button" onClick={() => inputRef.current?.click()} className="flex min-h-64 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/20 p-8 text-center transition-colors hover:border-primary hover:bg-muted/40"><div className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground"><Upload /></div><div><p className="font-semibold">Choose a CSV file</p><p className="mt-1 text-sm text-muted-foreground">Up to 5 MB. The first row must contain column headers.</p></div><Badge variant="outline">Browse files</Badge><input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void chooseFile(event.target.files?.[0])} /></button>}
          {step === 1 && <div className="flex flex-col gap-5"><div className="rounded-lg border bg-muted/20 p-4"><p className="font-medium">{fileName}</p><p className="text-sm text-muted-foreground">{csv.rows.length} rows · {csv.headers.length} source columns</p></div><div className="grid gap-3"><div className="grid grid-cols-[1fr_auto_1fr] gap-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"><span>CSV column</span><span /><span>Contact field</span></div>{csv.headers.map((header) => <div key={header} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div className="truncate rounded-md border bg-card px-3 py-2 text-sm font-medium">{header}</div><ArrowRight className="size-4 text-muted-foreground" /><Select value={mapping[header] ?? IGNORE} onValueChange={(value) => setMapping((current) => ({ ...current, [header]: value ?? IGNORE }))}><SelectTrigger className={duplicateTargets.has(mapping[header]) ? "border-destructive" : ""}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value={IGNORE}>Ignore column</SelectItem>{fields.map((field) => <SelectItem key={field.id} value={field.id}>{field.label} · {field.type.replace("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select></div>)}</div>{duplicateTargets.size > 0 && <p className="text-sm text-destructive">Each contact field can only be mapped once.</p>}{!hasIdentity && <p className="text-sm text-destructive">Map Name and at least one of Phone or Email.</p>}</div>}
          {step === 2 && <div className="flex flex-col gap-5"><div className="flex flex-wrap gap-3"><Badge variant="secondary">{csv.rows.length} rows</Badge><Badge variant={errors.length ? "destructive" : "secondary"}>{errors.length ? `${errors.length} invalid` : "Ready to import"}</Badge><Badge variant="outline">{mappedTargets.length} mapped fields</Badge></div><div className="overflow-auto rounded-lg border"><table className="min-w-full text-sm"><thead className="bg-muted"><tr><th className="p-3 text-left">Row</th>{csv.headers.filter((header) => mapping[header] !== IGNORE).map((header) => <th key={header} className="p-3 text-left">{fields.find((field) => field.id === mapping[header])?.label}</th>)}<th className="p-3 text-left">Status</th></tr></thead><tbody>{preview.map((row, index) => { const issue = errors.find((error) => error.row === index + 2); return <tr key={index} className="border-t"><td className="p-3">{index + 2}</td>{csv.headers.filter((header) => mapping[header] !== IGNORE).map((header) => <td key={header} className="max-w-48 truncate p-3">{row[csv.headers.indexOf(header)] || "—"}</td>)}<td className="p-3">{issue ? <span className="text-destructive">{issue.message}</span> : <span className="text-muted-foreground">Valid</span>}</td></tr>})}</tbody></table></div>{csv.rows.length > preview.length && <p className="text-xs text-muted-foreground">Showing the first {preview.length} rows. All {csv.rows.length} rows will be validated and imported.</p>}</div>}
          {step === 3 && result && <div className="flex flex-col items-center gap-5 py-10 text-center"><div className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">{result.errors.length ? <XCircle /> : <Check />}</div><div><h3 className="text-xl font-semibold">Import complete</h3><p className="mt-1 text-sm text-muted-foreground">Your contacts workspace has been refreshed.</p></div><div className="grid w-full max-w-lg grid-cols-3 gap-3"><div className="rounded-lg border p-4"><p className="text-2xl font-semibold">{result.imported}</p><p className="text-xs text-muted-foreground">Imported</p></div><div className="rounded-lg border p-4"><p className="text-2xl font-semibold">{result.skipped}</p><p className="text-xs text-muted-foreground">Duplicates</p></div><div className="rounded-lg border p-4"><p className="text-2xl font-semibold">{result.errors.length}</p><p className="text-xs text-muted-foreground">Failed</p></div></div>{result.errors.length > 0 && <Button variant="outline" onClick={downloadErrors}><Download data-icon="inline-start" /> Download error report</Button>}</div>}
        </div></ScrollArea>
        <DialogFooter className="border-t px-6 py-4"><Button variant="outline" onClick={() => step > 0 && step < 3 ? setStep((current) => current - 1) : close(false)} disabled={importing}>{step > 0 && step < 3 && <ArrowLeft data-icon="inline-start" />}{step > 0 && step < 3 ? "Back" : "Close"}</Button>{step === 1 && <Button onClick={() => setStep(2)} disabled={!hasIdentity || duplicateTargets.size > 0}>Review data <ArrowRight data-icon="inline-end" /></Button>}{step === 2 && <Button onClick={runImport} disabled={errors.length > 0 || importing}>{importing ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Upload data-icon="inline-start" />}{importing ? `Importing ${progress}%` : `Import ${csv.rows.length} contacts`}</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

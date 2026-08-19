'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ContactField, ContactValue } from '@/lib/data/contacts/types';
import {
  toE164,
  isNormalizablePhone,
  DEFAULT_PHONE_COUNTRY,
  type CountryCode,
} from '@/lib/phone/e164';
import { getCountries, getCountryCallingCode } from 'react-phone-number-input';
import en from 'react-phone-number-input/locale/en.json';

const IGNORE = '__ignore__';
const CREATE_PREFIX = '__create__:';
/**
 * Rows sent per bulk-import request. Small enough to stay well under
 * request body and serverless execution limits on a wide CSV, large
 * enough that a typical file is one or two round trips.
 */
const IMPORT_CHUNK_SIZE = 250;
const aliases: Record<string, string[]> = {
  name: ['name', 'fullname', 'contactname', 'customername', 'person'],
  phone: [
    'phone',
    'mobile',
    'mobilenumber',
    'phonenumber',
    'telephone',
    'cell',
    'whatsapp',
    'whatsappnumber',
  ],
  email: ['email', 'emailaddress', 'mail', 'workemail'],
  company: [
    'company',
    'companyname',
    'organization',
    'organisation',
    'business',
    'employer',
  ],
  tags: ['tags', 'tag', 'labels', 'groups', 'segments'],
};
/** Country options for the default-country picker, sorted by name. */
const PHONE_COUNTRIES = getCountries()
  .map((code) => ({
    code: code as CountryCode,
    label: `${en[code] ?? code} (+${getCountryCallingCode(code)})`,
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** `value -> label` map so the Select trigger shows the country name. */
const PHONE_COUNTRY_LABELS = Object.fromEntries(
  PHONE_COUNTRIES.map(({ code, label }) => [code, label])
);

type Store = { data: { fields: ContactField[] } };
type CsvData = { headers: string[]; rows: string[][] };
type ImportError = { row: number; message: string; source: string[] };

function parseCsv(text: string): CsvData {
  const rows: string[][] = [];
  let row: string[] = [],
    value = '',
    quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index++;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return { headers: rows[0] ?? [], rows: rows.slice(1) };
}

function autoMap(headers: string[], fields: ContactField[]) {
  const used = new Set<string>();
  return Object.fromEntries(
    headers.map((header) => {
      const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, '');
      const match = fields.find((field) => {
        if (used.has(field.id)) return false;
        const label = field.label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const knownNames = aliases[field.id] ?? [];
        return (
          label === normalized ||
          field.id === normalized ||
          knownNames.includes(normalized)
        );
      });
      if (match) used.add(match.id);
      return [header, match?.id ?? IGNORE];
    })
  );
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data } = useSWR<Store>(
    open ? '/api/v1/workspace/contacts?import=1' : null
  );
  // Memoised so the `?? []` fallback doesn't mint a new array identity on
  // every render — that identity is a dependency of the auto-mapping effect
  // below, which would otherwise re-run on every keystroke in the modal.
  const fields = useMemo(() => data?.data.fields ?? [], [data]);
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState<CsvData>({ headers: [], rows: [] });
  const [mapping, setMapping] = useState<Record<string, string>>({});
  /**
   * Country assumed for rows whose phone has no country code. Only used
   * as a fallback — a cell that already carries `+…`, or bare digits that
   * parse as a full international number, keeps its own country.
   */
  const [defaultCountry, setDefaultCountry] = useState<CountryCode>(
    DEFAULT_PHONE_COUNTRY
  );
  /**
   * Re-run auto-mapping when the field list arrives after the file was
   * parsed. `fields` is loaded over SWR, so a quick upload can land while
   * it is still empty — `autoMap` then matches nothing and every column
   * falls back to "Ignore column". Keyed on `fieldsKey` so this only fires
   * when the available fields actually change, never on user edits.
   */
  const fieldsKey = fields.map((field) => field.id).join(',');
  const autoMappedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!csv.headers.length || !fields.length) return;
    if (autoMappedFor.current === fieldsKey) return;
    autoMappedFor.current = fieldsKey;
    setMapping((current) => {
      // Preserve any choice the user already made; only fill in columns
      // still sitting at the unmatched default.
      const auto = autoMap(csv.headers, fields);
      const next = { ...auto };
      for (const [header, target] of Object.entries(current)) {
        if (target !== IGNORE) next[header] = target;
      }
      return next;
    });
  }, [csv.headers, fields, fieldsKey]);

  const [importing, setImporting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    errors: ImportError[];
  } | null>(null);

  const mappedTargets = Object.values(mapping).filter(
    (value) => value !== IGNORE
  );
  const duplicateTargets = new Set(
    mappedTargets.filter(
      (value, index) => mappedTargets.indexOf(value) !== index
    )
  );
  const hasIdentity =
    mappedTargets.includes('name') &&
    (mappedTargets.includes('phone') || mappedTargets.includes('email'));
  const preview = csv.rows.slice(0, 8);
  const valuesForRow = useCallback(
    (row: string[]) => {
      const values: Record<string, ContactValue> = {};
      csv.headers.forEach((header, index) => {
        const target = mapping[header];
        if (target && target !== IGNORE) values[target] = row[index] ?? '';
      });
      // Spreadsheets rarely hold clean E.164 — `+` gets eaten by cell
      // formatting, or the column is bare national digits. Canonicalize
      // here so the same value is what we validate AND what we POST,
      // rather than sending the raw cell and failing server-side.
      const raw = String(values.phone ?? '').trim();
      if (raw) {
        const normalized = toE164(raw, defaultCountry);
        if (normalized) values.phone = normalized.e164;
      }
      return values;
    },
    [csv.headers, mapping, defaultCountry]
  );

  const errors = useMemo(
    () =>
      csv.rows.flatMap((row, index) => {
        const values = valuesForRow(row);
        const issues: string[] = [];
        if (!String(values.name ?? '').trim()) issues.push('name is required');
        if (
          !String(values.phone ?? '').trim() &&
          !String(values.email ?? '').trim()
        )
          issues.push('phone or email is required');
        // `valuesForRow` already replaced the cell with E.164 when it could
        // be resolved, so anything still un-normalizable is a real problem
        // — and the message now says how to fix it.
        if (
          values.phone &&
          !isNormalizablePhone(String(values.phone), defaultCountry)
        )
          issues.push(
            `phone is not a valid ${en[defaultCountry] ?? defaultCountry} number — add a country code (e.g. +14155550123) or change the default country`
          );
        if (values.email && !/^\S+@\S+\.\S+$/.test(String(values.email)))
          issues.push('email is invalid');
        return issues.length
          ? [{ row: index + 2, message: issues.join('; '), source: row }]
          : [];
      }),
    [csv.rows, valuesForRow, defaultCountry]
  );

  async function chooseFile(file?: File) {
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error('CSV files must be smaller than 5 MB');
      return;
    }
    const parsed = parseCsv(await file.text());
    if (!parsed.headers.length || !parsed.rows.length) {
      toast.error('The CSV does not contain any data rows');
      return;
    }
    setFileName(file.name);
    setCsv(parsed);
    setMapping(autoMap(parsed.headers, fields));
    // Let the effect above re-map against a newly uploaded file's headers,
    // including when the previous file already consumed this field list.
    autoMappedFor.current = null;
    setStep(1);
    setResult(null);
  }

  async function prepareReview() {
    setPreparing(true);
    try {
      const next = { ...mapping };
      for (const header of csv.headers) {
        const target = next[header];
        if (!target?.startsWith(CREATE_PREFIX)) continue;
        const type = target.slice(CREATE_PREFIX.length);
        const response = await fetch('/api/v1/workspace/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'field',
            field: { label: header, type },
          }),
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error?.message ?? `Unable to create ${header}`
          );
        next[header] = payload.data.id;
      }
      setMapping(next);
      setStep(2);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to prepare import fields'
      );
    } finally {
      setPreparing(false);
    }
  }

  async function runImport() {
    if (errors.length) {
      toast.error('Resolve invalid rows before importing');
      return;
    }
    setImporting(true);
    setProgress(0);
    let imported = 0,
      skipped = 0;
    const importErrors: ImportError[] = [];
    try {
      // Sent in chunks to one bulk endpoint rather than one request per
      // row. The old per-row loop surfaced every already-existing contact
      // as a failed HTTP request, so importing a file of known contacts
      // filled the console with 400s; the server now resolves duplicates
      // before writing and reports them as skips. Chunking keeps any
      // single request well inside body-size and timeout limits while
      // still letting the progress bar advance.
      for (let start = 0; start < csv.rows.length; start += IMPORT_CHUNK_SIZE) {
        const chunk = csv.rows.slice(start, start + IMPORT_CHUNK_SIZE);
        const response = await fetch('/api/v1/workspace/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'import',
            rows: chunk.map((row, offset) => ({
              // +2 maps back to the spreadsheet line the user sees:
              // 1-based, with the header on row 1.
              row: start + offset + 2,
              values: valuesForRow(row),
            })),
          }),
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error?.message ?? 'Import failed');
        imported += payload.data.imported ?? 0;
        skipped += (payload.data.skipped ?? []).length;
        for (const failure of payload.data.errors ?? []) {
          importErrors.push({
            row: failure.row,
            message: failure.message,
            source: csv.rows[failure.row - 2] ?? [],
          });
        }
        setProgress(
          Math.round(
            (Math.min(start + IMPORT_CHUNK_SIZE, csv.rows.length) /
              csv.rows.length) *
              100
          )
        );
      }
    } catch (error) {
      // A whole chunk failed (network drop, auth expiry, oversized body).
      // Report it against the file rather than silently showing 0 rows.
      setImporting(false);
      toast.error(
        error instanceof Error ? error.message : 'Unable to import contacts'
      );
      // Earlier chunks may already have committed, so refresh the table.
      if (imported) onImported();
      return;
    }
    setResult({ imported, skipped, errors: importErrors });
    setImporting(false);
    setStep(3);
    if (imported) {
      onImported();
      toast.success(`${imported} contacts imported`);
    }
  }

  function downloadErrors() {
    if (!result?.errors.length) return;
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const text = [
      ['row', 'error', ...csv.headers],
      ...result.errors.map((error) => [
        String(error.row),
        error.message,
        ...error.source,
      ]),
    ]
      .map((row) => row.map(escape).join(','))
      .join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    link.download = 'contact-import-errors.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function close(next: boolean) {
    if (!next && !importing) {
      setStep(0);
      setCsv({ headers: [], rows: [] });
      setResult(null);
      setFileName('');
      setDefaultCountry(DEFAULT_PHONE_COUNTRY);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {/* Header and footer stay `shrink-0` while the scroll area takes
            `min-h-0 flex-1`, so only the middle section scrolls and the
            footer keeps its place at the bottom of the panel. */}
        <DialogHeader className="shrink-0 border-b px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-lg border">
              <FileSpreadsheet className="size-5" />
            </div>
            <div>
              <DialogTitle>Import contacts from CSV</DialogTitle>
              <DialogDescription>
                Map any spreadsheet columns to core and custom contact fields.
              </DialogDescription>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            {['Upload', 'Map fields', 'Validate', 'Results'].map(
              (label, index) => (
                <Badge
                  key={label}
                  variant={
                    step === index
                      ? 'default'
                      : step > index
                        ? 'secondary'
                        : 'outline'
                  }
                  className="gap-1"
                >
                  {step > index && <Check className="size-3" />}
                  {index + 1}. {label}
                </Badge>
              )
            )}
          </div>
        </DialogHeader>
        {/* Plain overflow container rather than <ScrollArea>: the Base UI
            viewport is `size-full`, so its `height:100%` can't resolve
            against a `flex-1` parent that has no explicit height. It grew
            to full content height (992px in a 437px slot) instead of
            scrolling, which pushed the footer over the last card and made
            the rows below it unreachable. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="p-4 sm:p-6">
            {step === 0 && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="bg-muted/20 hover:border-primary hover:bg-muted/40 flex min-h-64 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center transition-colors"
              >
                <div className="bg-primary text-primary-foreground flex size-12 items-center justify-center rounded-full">
                  <Upload />
                </div>
                <div>
                  <p className="font-semibold">Choose a CSV file</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Up to 5 MB. The first row must contain column headers.
                  </p>
                </div>
                <Badge variant="outline">Browse files</Badge>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => void chooseFile(event.target.files?.[0])}
                />
              </button>
            )}
            {step === 1 && (
              <div className="flex flex-col gap-5">
                <div className="bg-muted/20 rounded-lg border p-4">
                  <p className="font-medium">{fileName}</p>
                  <p className="text-muted-foreground text-sm">
                    {csv.rows.length} rows · {csv.headers.length} source columns
                  </p>
                </div>
                <div className="grid gap-3">
                  {/* The paired column headers only make sense once the rows
                      sit side by side, so they're hidden while stacked. */}
                  <div className="text-muted-foreground hidden grid-cols-[1fr_auto_1fr] gap-3 text-xs font-medium tracking-wide uppercase sm:grid">
                    <span>CSV column</span>
                    <span />
                    <span>Contact field</span>
                  </div>
                  {csv.headers.map((header) => (
                    <div
                      key={header}
                      className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3"
                    >
                      <div className="bg-card truncate rounded-md border px-3 py-2 text-sm font-medium">
                        {header}
                      </div>
                      <ArrowRight className="text-muted-foreground size-4 rotate-90 justify-self-center sm:rotate-0" />
                      <Select
                        value={mapping[header] ?? IGNORE}
                        onValueChange={(value) =>
                          setMapping((current) => ({
                            ...current,
                            [header]: value ?? IGNORE,
                          }))
                        }
                      >
                        <SelectTrigger
                          className={
                            duplicateTargets.has(mapping[header])
                              ? 'border-destructive'
                              : ''
                          }
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value={IGNORE}>
                              Ignore column
                            </SelectItem>
                            {fields.map((field) => (
                              <SelectItem key={field.id} value={field.id}>
                                {field.label} · {field.type.replace('_', ' ')}
                              </SelectItem>
                            ))}
                            <SelectItem value={`${CREATE_PREFIX}text`}>
                              <Plus className="size-3.5" /> Create “{header}” as
                              text
                            </SelectItem>
                            <SelectItem value={`${CREATE_PREFIX}number`}>
                              <Plus className="size-3.5" /> Create “{header}” as
                              number
                            </SelectItem>
                            <SelectItem value={`${CREATE_PREFIX}date`}>
                              <Plus className="size-3.5" /> Create “{header}” as
                              date
                            </SelectItem>
                            <SelectItem value={`${CREATE_PREFIX}checkbox`}>
                              <Plus className="size-3.5" /> Create “{header}” as
                              checkbox
                            </SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                {/* Only meaningful once a phone column is mapped. */}
                {mappedTargets.includes('phone') && (
                  <div className="bg-muted/20 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <label
                        htmlFor="import-default-country"
                        className="text-sm font-medium"
                      >
                        Default country for phone numbers
                      </label>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Applied only to numbers with no country code. Numbers
                        that already start with “+” keep their own country.
                      </p>
                    </div>
                    <Select
                      // Base UI renders the raw value in the trigger unless
                      // it is given a value -> label map, which is why this
                      // showed a bare "IN" instead of the country name.
                      items={PHONE_COUNTRY_LABELS}
                      value={defaultCountry}
                      onValueChange={(value) =>
                        value && setDefaultCountry(value as CountryCode)
                      }
                    >
                      <SelectTrigger
                        id="import-default-country"
                        className="w-full sm:w-72"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {PHONE_COUNTRIES.map(({ code, label }) => (
                            <SelectItem key={code} value={code}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="text-primary size-4" />
                    <h3 className="text-sm font-semibold">Live data preview</h3>
                    <Badge variant="outline">
                      First {Math.min(preview.length, 8)} rows
                    </Badge>
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="min-w-max text-sm">
                      <thead className="bg-muted/60">
                        <tr>
                          {csv.headers.map((header) => (
                            <th
                              key={header}
                              className="min-w-40 border-r p-3 text-left last:border-r-0"
                            >
                              <span className="block font-medium">
                                {header}
                              </span>
                              <span className="text-muted-foreground text-xs font-normal">
                                {mapping[header] === IGNORE
                                  ? 'Ignored'
                                  : mapping[header]?.startsWith(CREATE_PREFIX)
                                    ? 'New custom field'
                                    : (fields.find(
                                        (field) => field.id === mapping[header]
                                      )?.label ?? 'Not mapped')}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, rowIndex) => {
                          // Show mapped values so the phone column reflects
                          // the country code that will actually be stored,
                          // rather than the raw spreadsheet text.
                          const rowValues = valuesForRow(row);
                          return (
                            <tr key={rowIndex} className="border-t">
                              {csv.headers.map((header, columnIndex) => {
                                const target = mapping[header];
                                const value =
                                  target && target !== IGNORE
                                    ? rowValues[target]
                                    : row[columnIndex];
                                return (
                                  <td
                                    key={header}
                                    className="max-w-64 truncate border-r p-3 last:border-r-0"
                                  >
                                    {String(value ?? '') || '—'}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                {duplicateTargets.size > 0 && (
                  <p className="text-destructive text-sm">
                    Each contact field can only be mapped once.
                  </p>
                )}
                {!hasIdentity && (
                  <p className="text-destructive text-sm">
                    Map Name and at least one of Phone or Email.
                  </p>
                )}
              </div>
            )}
            {step === 2 && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap gap-3">
                  <Badge variant="secondary">{csv.rows.length} rows</Badge>
                  <Badge variant={errors.length ? 'destructive' : 'secondary'}>
                    {errors.length
                      ? `${errors.length} invalid`
                      : 'Ready to import'}
                  </Badge>
                  <Badge variant="outline">
                    {mappedTargets.length} mapped fields
                  </Badge>
                </div>
                <div className="overflow-auto rounded-lg border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="p-3 text-left">Row</th>
                        {csv.headers
                          .filter((header) => mapping[header] !== IGNORE)
                          .map((header) => (
                            <th key={header} className="p-3 text-left">
                              {fields.find(
                                (field) => field.id === mapping[header]
                              )?.label ?? header}
                            </th>
                          ))}
                        <th className="p-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, index) => {
                        const issue = errors.find(
                          (error) => error.row === index + 2
                        );
                        // Render the mapped/normalized values, not the raw
                        // cells, so the phone column shows the exact E.164
                        // string that will be written.
                        const rowValues = valuesForRow(row);
                        return (
                          <tr key={index} className="border-t">
                            <td className="p-3">{index + 2}</td>
                            {csv.headers
                              .filter((header) => mapping[header] !== IGNORE)
                              .map((header) => (
                                <td
                                  key={header}
                                  className="max-w-48 truncate p-3"
                                >
                                  {String(
                                    rowValues[mapping[header]] ??
                                      row[csv.headers.indexOf(header)] ??
                                      ''
                                  ) || '—'}
                                </td>
                              ))}
                            <td className="p-3">
                              {issue ? (
                                <span className="text-destructive">
                                  {issue.message}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">
                                  Valid
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {csv.rows.length > preview.length && (
                  <p className="text-muted-foreground text-xs">
                    Showing the first {preview.length} rows. All{' '}
                    {csv.rows.length} rows will be validated and imported.
                  </p>
                )}
              </div>
            )}
            {step === 3 && result && (
              <div className="flex flex-col items-center gap-5 py-10 text-center">
                <div className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-full">
                  {result.errors.length ? <XCircle /> : <Check />}
                </div>
                <div>
                  <h3 className="text-xl font-semibold">Import complete</h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Your contacts workspace has been refreshed.
                  </p>
                </div>
                <div className="grid w-full max-w-lg grid-cols-3 gap-3">
                  <div className="rounded-lg border p-4">
                    <p className="text-2xl font-semibold">{result.imported}</p>
                    <p className="text-muted-foreground text-xs">Imported</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-2xl font-semibold">{result.skipped}</p>
                    <p className="text-muted-foreground text-xs">Duplicates</p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <p className="text-2xl font-semibold">
                      {result.errors.length}
                    </p>
                    <p className="text-muted-foreground text-xs">Failed</p>
                  </div>
                </div>
                {result.errors.length > 0 && (
                  <Button variant="outline" onClick={downloadErrors}>
                    <Download data-icon="inline-start" /> Download error report
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        {/* DialogFooter ships `-mx-4 -mb-4` to bleed into the default
            padded dialog. This dialog is `p-0`, so those negative margins
            pulled the footer outside the panel and it overlapped the last
            rows of content — `m-0` puts it back in flow. */}
        <DialogFooter className="bg-muted/50 m-0 shrink-0 border-t px-4 py-3 sm:px-6 sm:py-4">
          <Button
            variant="outline"
            onClick={() =>
              step > 0 && step < 3
                ? setStep((current) => current - 1)
                : close(false)
            }
            disabled={importing}
          >
            {step > 0 && step < 3 && <ArrowLeft data-icon="inline-start" />}
            {step > 0 && step < 3 ? 'Back' : 'Close'}
          </Button>
          {step === 1 && (
            <Button
              onClick={() => void prepareReview()}
              disabled={!hasIdentity || duplicateTargets.size > 0 || preparing}
            >
              {preparing ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : null}
              {preparing ? 'Creating fields…' : 'Review data'}
              {!preparing && <ArrowRight data-icon="inline-end" />}
            </Button>
          )}
          {step === 2 && (
            <Button
              onClick={runImport}
              disabled={errors.length > 0 || importing}
            >
              {importing ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              {importing
                ? `Importing ${progress}%`
                : `Import ${csv.rows.length} contacts`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

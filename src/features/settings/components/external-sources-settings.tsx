'use client';

// ============================================================
// ExternalSourcesSettings — Settings → External sources
//
// Manage pull-connectors to outside systems (REST endpoint,
// Postgres database, Google Sheet) that can be used as live
// recipient sources in the broadcast wizard. Any member sees the
// roster; admin+ creates/edits/deletes (gated by <RequireRole> here
// and admin-only routes + RLS server-side).
//
// Secrets are write-only: the form shows a blank secret field with
// a "saved" hint when one exists; typing a new value replaces it.
// The plaintext never comes back from the server (same contract as
// API keys, minus the one-time reveal — the user already knows
// their own token/connection string).
// ============================================================

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';
import {
  Database,
  FileSpreadsheet,
  Globe,
  Loader2,
  Pencil,
  Plus,
  PlugZap,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RequireRole } from '@/features/auth/components/require-role';
import { useAuth } from '@/features/auth/hooks/use-auth';
import type {
  ExternalSource,
  ExternalSourceType,
  FetchedRecipient,
  GoogleSheetSourceConfig,
  PostgresSourceConfig,
  RestSourceConfig,
} from '@/features/external-sources/lib/types';
import { getSourceSaveTarget } from '@/features/external-sources/lib/validate';
import { SettingsPanelHead } from './settings-panel-head';

const TYPE_LABEL: Record<ExternalSourceType, string> = {
  rest: 'REST API',
  postgres: 'Postgres',
  google_sheet: 'Google Sheet',
};

const TYPE_ICON: Record<ExternalSourceType, typeof Globe> = {
  rest: Globe,
  postgres: Database,
  google_sheet: FileSpreadsheet,
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

async function fetchSources(url: string): Promise<ExternalSource[]> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to load external sources');
  }
  const data = (await res.json()) as { sources: ExternalSource[] };
  return data.sources;
}

export function ExternalSourcesSettings() {
  const { canEditSettings } = useAuth();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalSource | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // SWR owns fetch/loading/revalidate state — no manual load effect.
  const {
    data: sources = [],
    isLoading: loading,
    mutate,
  } = useSWR('/api/external-sources', fetchSources, {
    onError: (err) => {
      console.error('[ExternalSourcesSettings] load error:', err);
      toast.error(err instanceof Error ? err.message : 'Network error');
    },
  });
  const load = useCallback(() => mutate(), [mutate]);

  async function handleDelete(source: ExternalSource) {
    setDeleting(source.id);
    try {
      const res = await fetch(`/api/external-sources/${source.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to delete source');
        return;
      }
      toast.success(`Deleted "${source.name}"`);
      // Reflect the delete locally without a refetch.
      void mutate((prev) => prev?.filter((s) => s.id !== source.id), {
        revalidate: false,
      });
    } catch (err) {
      console.error('[ExternalSourcesSettings] delete error:', err);
      toast.error('Network error');
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="External sources"
        description="Connect an outside system — a REST endpoint, Postgres database, or Google Sheet — and use it as a live recipient list when sending broadcasts. Recipients are pulled fresh at send time (up to 10,000 per broadcast)."
        action={
          <RequireRole min="admin">
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" />
              New source
            </Button>
          </RequireRole>
        }
      />

      {sources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Database className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">
              No external sources yet.
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {canEditSettings
                ? 'Click New source to connect your backend.'
                : 'Ask an admin to connect one.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {sources.map((s) => {
                const Icon = TYPE_ICON[s.type];
                return (
                  <li
                    key={s.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className="text-muted-foreground size-4 shrink-0" />
                        <span className="text-foreground truncate text-sm font-medium">
                          {s.name}
                        </span>
                        <Badge className="border-border bg-muted text-muted-foreground text-[10px] tracking-wide uppercase">
                          {TYPE_LABEL[s.type]}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        {s.last_tested_at
                          ? `Last tested ${fmtDate(s.last_tested_at)}${
                              s.last_row_count != null
                                ? ` · ${s.last_row_count.toLocaleString()} recipients`
                                : ''
                            }`
                          : 'Never tested'}
                        {' · '}
                        Added {fmtDate(s.created_at)}
                      </p>
                    </div>

                    <RequireRole min="admin">
                      <div className="flex gap-2 self-start sm:self-auto">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditing(s);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(s)}
                          disabled={deleting === s.id}
                          className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                        >
                          {deleting === s.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </div>
                    </RequireRole>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <SourceDialog
        key={editing?.id ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        source={editing}
        onSaved={load}
      />
    </section>
  );
}

// ------------------------------------------------------------
// Create / edit dialog with per-type fields + test connection.
// ------------------------------------------------------------

interface ParamRow {
  index: string;
  field: string;
}

function SourceDialog({
  open,
  onOpenChange,
  source,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: ExternalSource | null;
  onSaved: () => void;
}) {
  const isEdit = Boolean(source);
  const restCfg = (
    source?.type === 'rest' ? source.config : {}
  ) as RestSourceConfig;
  const pgCfg = (
    source?.type === 'postgres' ? source.config : {}
  ) as PostgresSourceConfig;
  const sheetCfg = (
    source?.type === 'google_sheet' ? source.config : {}
  ) as GoogleSheetSourceConfig;

  const [name, setName] = useState(source?.name ?? '');
  const [type, setType] = useState<ExternalSourceType>(source?.type ?? 'rest');

  // REST
  const [restUrl, setRestUrl] = useState(restCfg.url ?? '');
  const [authStyle, setAuthStyle] = useState<'none' | 'bearer' | 'header'>(
    restCfg.authStyle ?? 'none'
  );
  const [authHeader, setAuthHeader] = useState(restCfg.authHeader ?? '');
  const [itemsPath, setItemsPath] = useState(restCfg.itemsPath ?? '');
  const [nextPagePath, setNextPagePath] = useState(restCfg.nextPagePath ?? '');
  // Postgres
  const [query, setQuery] = useState(pgCfg.query ?? '');
  // Google Sheet
  const [sheetUrl, setSheetUrl] = useState(sheetCfg.url ?? '');

  // Secret (write-only)
  const [secret, setSecret] = useState('');

  // Field mapping
  const [phoneField, setPhoneField] = useState(source?.field_map?.phone ?? '');
  const [nameField, setNameField] = useState(source?.field_map?.name ?? '');
  const [paramRows, setParamRows] = useState<ParamRow[]>(
    source?.field_map?.params
      ? Object.entries(source.field_map.params).map(([index, field]) => ({
          index,
          field,
        }))
      : []
  );

  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  // Set when "Test connection" creates the row before the user hits
  // Create — later saves PATCH this id instead of POSTing a duplicate.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    rows: FetchedRecipient[];
    count: number;
    invalid: number;
    capped: boolean;
  } | null>(null);

  function buildPayload() {
    const config =
      type === 'rest'
        ? {
            url: restUrl.trim(),
            authStyle,
            ...(authStyle === 'header'
              ? { authHeader: authHeader.trim() }
              : {}),
            ...(itemsPath.trim() ? { itemsPath: itemsPath.trim() } : {}),
            ...(nextPagePath.trim()
              ? { nextPagePath: nextPagePath.trim() }
              : {}),
          }
        : type === 'postgres'
          ? { query: query.trim() }
          : { url: sheetUrl.trim() };

    const params: Record<string, string> = {};
    for (const row of paramRows) {
      if (row.index.trim() && row.field.trim()) {
        params[row.index.trim()] = row.field.trim();
      }
    }

    return {
      name: name.trim(),
      type,
      config,
      fieldMap: {
        phone: phoneField.trim(),
        ...(nameField.trim() ? { name: nameField.trim() } : {}),
        ...(Object.keys(params).length ? { params } : {}),
      },
      // Only send the secret when the user typed one — undefined
      // leaves the stored secret untouched on PATCH.
      ...(secret.trim() ? { secret: secret.trim() } : {}),
    };
  }

  function validateLocally(): string | null {
    if (!name.trim()) return 'Name is required';
    if (!phoneField.trim()) return 'The phone field mapping is required';
    if (type === 'rest' && !restUrl.trim()) return 'Endpoint URL is required';
    if (type === 'postgres' && !query.trim()) return 'SQL query is required';
    if (type === 'postgres' && !isEdit && !secret.trim())
      return 'Connection string is required';
    if (type === 'google_sheet' && !sheetUrl.trim())
      return 'Sheet URL is required';
    return null;
  }

  async function handleSave() {
    const problem = validateLocally();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSubmitting(true);
    try {
      const target = getSourceSaveTarget(source?.id ?? createdId);
      const res = await fetch(target.url, {
        method: target.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Failed to save source');
        return;
      }
      toast.success(isEdit ? 'Source updated' : 'Source created');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error('[SourceDialog] save error:', err);
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  // Test = save first (create or patch), then hit the preview route.
  // Testing unsaved config would need a parallel "dry run" API; saving
  // first keeps one code path and the row's last_tested stamp honest.
  async function handleTest() {
    const problem = validateLocally();
    if (problem) {
      toast.error(problem);
      return;
    }
    setTesting(true);
    setPreview(null);
    try {
      const target = getSourceSaveTarget(source?.id ?? createdId);
      const saveRes = await fetch(target.url, {
        method: target.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const savePayload = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) {
        toast.error(savePayload.error || 'Failed to save source');
        return;
      }
      const id = (savePayload.source as ExternalSource).id;
      setCreatedId(id);

      const res = await fetch(`/api/external-sources/${id}/preview`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Connection test failed');
        onSaved(); // row may now exist even though the test failed
        return;
      }
      setPreview({
        rows: payload.preview as FetchedRecipient[],
        count: payload.count as number,
        invalid: payload.invalid as number,
        capped: payload.capped as boolean,
      });
      onSaved();
    } catch (err) {
      console.error('[SourceDialog] test error:', err);
      toast.error('Network error');
    } finally {
      setTesting(false);
    }
  }

  const fieldHint =
    type === 'rest'
      ? 'Use dot-paths into each JSON record, e.g. parent.phone'
      : type === 'postgres'
        ? 'Use the column names returned by your query'
        : 'Use the header row values of your sheet';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isEdit ? 'Edit source' : 'New external source'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Recipients are pulled from this source when a broadcast is sent.
            Credentials are encrypted and never shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ext-src-name" className="text-muted-foreground">
              Name
            </Label>
            <Input
              id="ext-src-name"
              value={name}
              maxLength={80}
              placeholder="e.g. School parents database"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Source type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as ExternalSourceType)}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rest">REST API (recommended)</SelectItem>
                <SelectItem value="postgres">Postgres database</SelectItem>
                <SelectItem value="google_sheet">Google Sheet</SelectItem>
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-muted-foreground text-xs">
                Type can&apos;t be changed — create a new source instead.
              </p>
            )}
          </div>

          {type === 'rest' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ext-src-url" className="text-muted-foreground">
                  Endpoint URL
                </Label>
                <Input
                  id="ext-src-url"
                  value={restUrl}
                  placeholder="https://api.yourschool.com/parents?active=true"
                  onChange={(e) => setRestUrl(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Must return JSON. Add query parameters here to filter the
                  audience at the source.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">
                    Authentication
                  </Label>
                  <Select
                    value={authStyle}
                    onValueChange={(v) =>
                      setAuthStyle(v as 'none' | 'bearer' | 'header')
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="bearer">Bearer token</SelectItem>
                      <SelectItem value="header">Custom header</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {authStyle === 'header' && (
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="ext-src-auth-header"
                      className="text-muted-foreground"
                    >
                      Header name
                    </Label>
                    <Input
                      id="ext-src-auth-header"
                      value={authHeader}
                      placeholder="X-API-Key"
                      onChange={(e) => setAuthHeader(e.target.value)}
                    />
                  </div>
                )}
              </div>
              {authStyle !== 'none' && (
                <div className="space-y-1.5">
                  <Label
                    htmlFor="ext-src-secret"
                    className="text-muted-foreground"
                  >
                    {authStyle === 'bearer' ? 'Bearer token' : 'Header value'}
                  </Label>
                  <Input
                    id="ext-src-secret"
                    type="password"
                    value={secret}
                    placeholder={
                      isEdit && source?.has_secret
                        ? 'Saved — type to replace'
                        : 'Paste the token'
                    }
                    onChange={(e) => setSecret(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="ext-src-items"
                    className="text-muted-foreground"
                  >
                    Items path (optional)
                  </Label>
                  <Input
                    id="ext-src-items"
                    value={itemsPath}
                    placeholder="data"
                    onChange={(e) => setItemsPath(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Where the record array lives in the response.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="ext-src-next"
                    className="text-muted-foreground"
                  >
                    Next page path (optional)
                  </Label>
                  <Input
                    id="ext-src-next"
                    value={nextPagePath}
                    placeholder="next"
                    onChange={(e) => setNextPagePath(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Field holding the next page URL, for paginated APIs.
                  </p>
                </div>
              </div>
            </>
          )}

          {type === 'postgres' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ext-src-conn" className="text-muted-foreground">
                  Connection string
                </Label>
                <Input
                  id="ext-src-conn"
                  type="password"
                  value={secret}
                  placeholder={
                    isEdit && source?.has_secret
                      ? 'Saved — type to replace'
                      : 'postgresql://readonly_user:password@host:5432/db'
                  }
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="off"
                />
                <p className="text-muted-foreground text-xs">
                  Use a read-only database user. SSL is required.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="ext-src-query"
                  className="text-muted-foreground"
                >
                  SQL query
                </Label>
                <Textarea
                  id="ext-src-query"
                  value={query}
                  rows={4}
                  placeholder={
                    'SELECT phone, parent_name, student_name\nFROM parents WHERE active = true'
                  }
                  onChange={(e) => setQuery(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">
                  SELECT only. Filter with WHERE to stay under the 10,000-row
                  cap.
                </p>
              </div>
            </>
          )}

          {type === 'google_sheet' && (
            <div className="space-y-1.5">
              <Label htmlFor="ext-src-sheet" className="text-muted-foreground">
                Sheet link
              </Label>
              <Input
                id="ext-src-sheet"
                value={sheetUrl}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                onChange={(e) => setSheetUrl(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Share the sheet as &quot;Anyone with the link can view&quot;.
                The first row must be column headers.
              </p>
            </div>
          )}

          <div className="border-border space-y-3 rounded-md border p-3">
            <div>
              <p className="text-foreground text-sm font-medium">
                Field mapping
              </p>
              <p className="text-muted-foreground text-xs">{fieldHint}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="ext-src-phone"
                  className="text-muted-foreground"
                >
                  Phone field (required)
                </Label>
                <Input
                  id="ext-src-phone"
                  value={phoneField}
                  placeholder="phone"
                  onChange={(e) => setPhoneField(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="ext-src-namef"
                  className="text-muted-foreground"
                >
                  Name field (optional)
                </Label>
                <Input
                  id="ext-src-namef"
                  value={nameField}
                  placeholder="parent_name"
                  onChange={(e) => setNameField(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">
                  Template variables (optional)
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setParamRows((prev) => [
                      ...prev,
                      { index: String(prev.length + 1), field: '' },
                    ])
                  }
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              </div>
              {paramRows.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {'Map source fields to template variables like {{1}}, {{2}}.'}
                </p>
              ) : (
                paramRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={row.index}
                      onChange={(e) =>
                        setParamRows((prev) =>
                          prev.map((r, j) =>
                            j === i ? { ...r, index: e.target.value } : r
                          )
                        )
                      }
                      placeholder="1"
                      className="w-16 text-center"
                      aria-label={`Variable number for mapping ${i + 1}`}
                    />
                    <span className="text-muted-foreground text-xs">←</span>
                    <Input
                      value={row.field}
                      onChange={(e) =>
                        setParamRows((prev) =>
                          prev.map((r, j) =>
                            j === i ? { ...r, field: e.target.value } : r
                          )
                        )
                      }
                      placeholder="student_name"
                      className="flex-1"
                      aria-label={`Source field for mapping ${i + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setParamRows((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label={`Remove mapping ${i + 1}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          {preview && (
            <div className="border-border bg-muted/40 space-y-2 rounded-md border p-3">
              <p className="text-foreground text-sm font-medium">
                {preview.capped
                  ? `Connection works — more than 10,000 rows found`
                  : `Connection works — ${preview.count.toLocaleString()} valid recipient${
                      preview.count === 1 ? '' : 's'
                    }`}
                {preview.invalid > 0 && (
                  <span className="text-muted-foreground font-normal">
                    {' '}
                    ({preview.invalid.toLocaleString()} skipped: missing/invalid
                    phone)
                  </span>
                )}
              </p>
              {preview.capped && (
                <p className="text-xs text-amber-400">
                  Broadcasts from this source will be blocked until it returns
                  10,000 rows or fewer — filter at the source.
                </p>
              )}
              {preview.rows.length > 0 && (
                <ul className="space-y-1">
                  {preview.rows.map((r, i) => (
                    <li
                      key={i}
                      className="text-muted-foreground font-mono text-xs"
                    >
                      +{r.phone}
                      {r.name ? ` · ${r.name}` : ''}
                      {Object.keys(r.params).length > 0 &&
                        ` · ${Object.entries(r.params)
                          .map(([k, v]) => `{{${k}}}=${v}`)
                          .join(' ')}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={testing || submitting}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            Test connection
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={submitting || testing}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : isEdit ? (
                'Save changes'
              ) : (
                'Create source'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

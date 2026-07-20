"use client";

// ============================================================
// AdminPlatform — /admin/platform (platform flags + audit trail).
//
// Two sections:
//   1. Platform settings — the `ai_engine` flag (direct vs
//      langchain), read/written through /api/admin/platform-settings.
//   2. Audit trail — keyset-paginated read of platform_audit_log
//      via /api/admin/audit (the only read surface of the table).
// ============================================================

import { useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import { Loader2, ScrollText, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AiEngine = "direct" | "langchain";

interface AuditEntry {
  id: string;
  actor_id: string;
  account_id: string | null;
  action: string;
  entity: string | null;
  created_at: string;
  actor_name: string | null;
  account_name: string | null;
}

const jsonFetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Request failed");
  return body;
};

export function AdminPlatform() {
  return (
    <div className="flex flex-col gap-8">
      <EngineFlagSection />
      <AuditTrailSection />
    </div>
  );
}

function EngineFlagSection() {
  const { data, isLoading, mutate } = useSWR<{ ai_engine: AiEngine }>(
    "/api/admin/platform-settings",
    jsonFetcher,
  );
  const [saving, setSaving] = useState(false);

  async function setEngine(engine: AiEngine) {
    if (engine === data?.ai_engine) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_engine: engine }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to save setting");
      await mutate({ ai_engine: engine }, { revalidate: false });
      toast.success(`AI engine switched to ${engine}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Platform settings" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <SlidersHorizontal
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="text-sm font-semibold">Platform settings</h2>
      </header>

      <div className="flex flex-col gap-4 rounded-lg border p-4 sm:max-w-lg">
        <div className="grid leading-tight">
          <span className="text-sm font-medium">AI engine</span>
          <span className="text-xs text-muted-foreground">
            Which execution engine powers AI features platform-wide. Other
            instances converge within ~30 seconds.
          </span>
        </div>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <RadioGroup
            value={data?.ai_engine ?? "direct"}
            onValueChange={(v) => {
              if (v === "direct" || v === "langchain") void setEngine(v);
            }}
            className="flex flex-col gap-3"
            aria-label="AI engine"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem
                value="direct"
                id="engine-direct"
                disabled={saving}
              />
              <Label htmlFor="engine-direct" className="grid leading-tight">
                <span>Direct</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Calls model providers directly through the AI SDK.
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem
                value="langchain"
                id="engine-langchain"
                disabled={saving}
              />
              <Label htmlFor="engine-langchain" className="grid leading-tight">
                <span>LangChain</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Routes AI workloads through the LangChain pipeline.
                </span>
              </Label>
            </div>
          </RadioGroup>
        )}

        {saving && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Saving…
          </p>
        )}
      </div>
    </section>
  );
}

function AuditTrailSection() {
  const { data, isLoading, isValidating, size, setSize } = useSWRInfinite<{
    entries: AuditEntry[];
    next_cursor: string | null;
  }>((index, previous) => {
    if (previous && !previous.next_cursor) return null;
    const p = new URLSearchParams();
    if (index > 0 && previous?.next_cursor) {
      p.set("cursor", previous.next_cursor);
    }
    const s = p.toString();
    return `/api/admin/audit${s ? `?${s}` : ""}`;
  }, jsonFetcher);

  const entries = (data ?? []).flatMap((p) => p.entries);
  const nextCursor = data?.[data.length - 1]?.next_cursor ?? null;
  const loading = isLoading || isValidating;

  return (
    <section aria-label="Audit trail" className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <ScrollText
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="text-sm font-semibold">Audit trail</h2>
      </header>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && entries.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No audit entries yet. Super-admin mutations will appear
                  here.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{e.actor_name ?? "Unknown"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.account_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {e.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-52 truncate font-mono text-xs text-muted-foreground">
                    {e.entity ?? "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {nextCursor && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void setSize(size + 1)}
          >
            {loading && (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            )}
            Load more
          </Button>
        </div>
      )}
    </section>
  );
}

"use client";

// ============================================================
// AdminWorkspaces — /admin/workspaces (platform directory).
//
// Server-paginated, searchable list of every tenant workspace
// (keyset cursor on created_at). Clicking a row opens a detail
// sheet: members (read-only), channel status, and the
// provision-agent action (one-time temporary-password reveal).
//
// Data flows through SWR keyed on the API routes; mutations call
// the route then `mutate()` so the cache stays canonical.
// ============================================================

import { useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import { Copy, Loader2, Search, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
  owner_name: string | null;
  member_count: number;
  active_channels: string[];
}

interface WorkspaceDetail {
  workspace: { id: string; name: string; created_at: string };
  members: {
    user_id: string;
    full_name: string | null;
    email: string | null;
    account_role: string;
    created_at: string;
  }[];
  channels: {
    channel: string;
    provider: string;
    masked_preview: string | null;
    is_active: boolean;
    verified_at: string | null;
    updated_at: string;
  }[];
}

const jsonFetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Request failed");
  return body;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminWorkspaces() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keyset pagination via SWR Infinite: page N's key derives from
  // page N-1's next_cursor, so "Load more" is just setSize(size + 1).
  const { data, isLoading, isValidating, size, setSize } = useSWRInfinite<{
    workspaces: WorkspaceRow[];
    next_cursor: string | null;
  }>(
    (index, previous) => {
      if (previous && !previous.next_cursor) return null; // reached the end
      const p = new URLSearchParams();
      if (query) p.set("q", query);
      if (index > 0 && previous?.next_cursor) {
        p.set("cursor", previous.next_cursor);
      }
      const s = p.toString();
      return `/api/admin/workspaces${s ? `?${s}` : ""}`;
    },
    jsonFetcher,
  );

  const rows = (data ?? []).flatMap((p) => p.workspaces);
  const nextCursor = data?.[data.length - 1]?.next_cursor ?? null;
  const loading = isLoading || isValidating;

  function submitSearch() {
    setQuery(search.trim());
    void setSize(1);
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Workspace directory">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitSearch();
        }}
      >
        <div className="relative w-full max-w-sm">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workspaces by name…"
            className="pl-8"
            aria-label="Search workspaces"
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Active channels</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-8 text-center text-muted-foreground"
                >
                  No workspaces match this search.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((w) => (
                <TableRow
                  key={w.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(w.id)}
                >
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {w.owner_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {w.member_count}
                  </TableCell>
                  <TableCell>
                    {w.active_channels.length === 0 ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {w.active_channels.map((c) => (
                          <Badge key={c} variant="secondary">
                            {c}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(w.created_at)}
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

      <WorkspaceDetailSheet
        workspaceId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </section>
  );
}

function WorkspaceDetailSheet({
  workspaceId,
  onClose,
}: {
  workspaceId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, mutate } = useSWR<WorkspaceDetail>(
    workspaceId ? `/api/admin/workspaces/${workspaceId}` : null,
    jsonFetcher,
  );
  const [provisionOpen, setProvisionOpen] = useState(false);

  return (
    <Sheet open={workspaceId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-balance">
            {data?.workspace.name ?? "Workspace"}
          </SheetTitle>
          <SheetDescription>
            {data
              ? `Created ${formatDate(data.workspace.created_at)} · ${data.members.length} member${data.members.length === 1 ? "" : "s"}`
              : "Loading workspace details…"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-5/6" />
            </div>
          ) : data ? (
            <>
              <section aria-label="Members" className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Members</h3>
                  <Button size="sm" onClick={() => setProvisionOpen(true)}>
                    <UserPlus className="size-4" aria-hidden="true" />
                    Provision agent
                  </Button>
                </div>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.members.map((m) => (
                        <TableRow key={m.user_id}>
                          <TableCell>
                            <span className="grid leading-tight">
                              <span className="truncate font-medium">
                                {m.full_name || m.email || "Unknown"}
                              </span>
                              {m.full_name && m.email && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {m.email}
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{m.account_role}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(m.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section aria-label="Channels" className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Channels</h3>
                {data.channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No channels configured yet. Use the Channels tab to add
                    provider credentials for this workspace.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {data.channels.map((c) => (
                      <li
                        key={c.channel}
                        className="flex items-center justify-between gap-2 rounded-lg border p-3"
                      >
                        <span className="grid leading-tight">
                          <span className="text-sm font-medium capitalize">
                            {c.channel}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {c.provider}
                            {c.masked_preview ? ` · ${c.masked_preview}` : ""}
                          </span>
                        </span>
                        <Badge variant={c.is_active ? "default" : "secondary"}>
                          {c.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Could not load this workspace.
            </p>
          )}
        </div>

        {workspaceId && (
          <ProvisionAgentDialog
            workspaceId={workspaceId}
            open={provisionOpen}
            onOpenChange={setProvisionOpen}
            onProvisioned={() => mutate()}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ProvisionAgentDialog({
  workspaceId,
  open,
  onOpenChange,
  onProvisioned,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/admin/workspaces/${workspaceId}/provision-agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, full_name: fullName }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to provision the agent");
      }
      setTempPassword(body.temporary_password as string);
      onProvisioned();
      toast.success("Agent provisioned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function reset(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setEmail("");
      setFullName("");
      setTempPassword(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provision agent</DialogTitle>
          <DialogDescription>
            Creates a new user in this workspace with the agent role. The
            temporary password is shown once — hand it to the agent and ask
            them to change it immediately.
          </DialogDescription>
        </DialogHeader>

        {tempPassword ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Agent created. This temporary password will not be shown again:
            </p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
              <code className="flex-1 font-mono text-sm break-all">
                {tempPassword}
              </code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Copy temporary password"
                onClick={() => {
                  navigator.clipboard.writeText(tempPassword);
                  toast.success("Copied to clipboard");
                }}
              >
                <Copy className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => reset(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-name">Full name</Label>
              <Input
                id="agent-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Agent"
                required
                maxLength={120}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="agent-email">Email</Label>
              <Input
                id="agent-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@company.com"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => reset(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                Create agent
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

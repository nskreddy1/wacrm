'use client';

// ============================================================
// Super-admin AI support request triage.
//
// Access is enforced server-side (SUPER_ADMIN_EMAILS allowlist on the
// API); this page just renders the 403 as a friendly "not authorized"
// state, so there is no client-side allowlist to drift out of sync.
// ============================================================

import { useState } from 'react';
import useSWR from 'swr';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Headset,
  Loader2,
  ShieldAlert,
  StickyNote,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const STATUSES = ['pending', 'in_progress', 'resolved'] as const;
type Status = (typeof STATUSES)[number];

interface AdminRequest {
  id: string;
  account_id: string;
  user_id: string | null;
  topic: string;
  message: string;
  contact_info: string | null;
  status: Status;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  accounts: { name: string | null } | null;
}

const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

const STATUS_CLASS: Record<Status, string> = {
  pending:
    'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent',
  in_progress:
    'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-transparent',
  resolved:
    'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent',
};

const TOPIC_LABEL: Record<string, string> = {
  setup_bot: 'Set up a bot for me',
  improve_replies: 'Improve reply quality',
  connect_provider: 'Connect an AI provider',
  other: 'Other',
};

async function fetchRequests(url: string) {
  const res = await fetch(url);
  if (res.status === 403 || res.status === 401) {
    const err = new Error('forbidden');
    err.name = 'Forbidden';
    throw err;
  }
  if (!res.ok) throw new Error('Failed to load requests');
  return (await res.json()) as { requests: AdminRequest[] };
}

export default function AiRequestsAdminPage() {
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/support-requests${query}`,
    fetchRequests,
  );

  const requests = data?.requests ?? [];

  if (error?.name === 'Forbidden') {
    return (
      <PageContainer>
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <ShieldAlert className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Super admin access required
          </p>
          <p className="max-w-sm text-sm text-muted-foreground text-pretty">
            This page is only available to platform operators on the
            super-admin allowlist.
          </p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <Headset className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                AI support requests
              </h1>
              <p className="text-sm text-muted-foreground">
                Setup-help requests from all accounts, newest first.
              </p>
            </div>
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter((v as 'all' | Status) ?? 'all')}
          >
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Failed to load requests. Refresh to try again.
          </p>
        ) : requests.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {statusFilter === 'all'
              ? 'No support requests yet.'
              : `No ${STATUS_LABEL[statusFilter as Status].toLowerCase()} requests.`}
          </p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} onUpdated={() => mutate()} />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

function RequestCard({
  request,
  onUpdated,
}: {
  request: AdminRequest;
  onUpdated: () => void;
}) {
  const [notes, setNotes] = useState(request.admin_notes ?? '');
  const [notesOpen, setNotesOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/support-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast.success('Request updated');
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {request.accounts?.name ?? 'Unknown account'}
              </span>
              <Badge variant="outline" className="text-xs font-normal">
                {TOPIC_LABEL[request.topic] ?? request.topic}
              </Badge>
              <Badge className={cn('text-xs', STATUS_CLASS[request.status])}>
                {STATUS_LABEL[request.status]}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(request.created_at), {
                addSuffix: true,
              })}
              {request.contact_info ? ` · ${request.contact_info}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={request.status}
              onValueChange={(v) => {
                if (v && v !== request.status) void patch({ status: v });
              }}
            >
              <SelectTrigger
                className="h-8 w-36 text-xs"
                aria-label="Update status"
                disabled={saving}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {saving && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {request.message}
        </p>

        <div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setNotesOpen((o) => !o)}
          >
            <StickyNote className="mr-1.5 h-3.5 w-3.5" />
            {request.admin_notes ? 'Edit notes' : 'Add notes'}
          </Button>
          {!notesOpen && request.admin_notes && (
            <p className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {request.admin_notes}
            </p>
          )}
          {notesOpen && (
            <div className="mt-2 space-y-2">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal triage notes (not visible to the account)"
                rows={3}
                maxLength={4000}
                disabled={saving}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={async () => {
                    await patch({ admin_notes: notes });
                    setNotesOpen(false);
                  }}
                >
                  Save notes
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setNotes(request.admin_notes ?? '');
                    setNotesOpen(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

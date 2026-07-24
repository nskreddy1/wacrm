'use client';

import { memo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Loader2,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================
// Reusable agent-UI primitives for the helper widget.
//
// Design language (modern enterprise copilot — Intercom Fin /
// Linear-style): assistant text renders flat on the panel
// background, user messages get a compact primary bubble, tool
// activity is a quiet left-rail step list, and write approvals
// are structured cards with a readable field summary instead of
// raw JSON.
// ============================================================

/** Human labels for every tool the agent can use. */
export const TOOL_LABELS: Record<string, string> = {
  get_workspace_overview: 'Reading workspace overview',
  list_contacts: 'Listing contacts',
  get_contact_details: 'Reading contact details',
  search_contacts: 'Searching contacts',
  get_pipeline_summary: 'Reading pipeline summary',
  list_deals: 'Reading deals',
  list_recent_conversations: 'Reading recent conversations',
  get_conversation_messages: 'Reading conversation messages',
  list_upcoming_appointments: 'Reading appointments',
  list_broadcasts: 'Reading broadcasts',
  list_templates: 'Reading templates',
  list_automations: 'Reading workflows',
  list_tasks: 'Reading tasks',
  list_support_tickets: 'Reading support tickets',
  get_ai_agent_status: 'Checking AI agent status',
  create_contact: 'Create a contact',
  create_task: 'Create a task',
  create_support_ticket: 'Create a support ticket',
  add_contact_note: 'Add a contact note',
  create_workflow: 'Create a workflow',
  activate_workflow: 'Activate a workflow',
};

export const WRITE_TOOLS = new Set([
  'create_contact',
  'create_task',
  'create_support_ticket',
  'add_contact_note',
  'create_workflow',
  'activate_workflow',
]);

export function toolNameFromPart(type: string): string | null {
  return type.startsWith('tool-') ? type.slice(5) : null;
}

// ------------------------------------------------------------
// Message text
// ------------------------------------------------------------

export const MessageText = memo(function MessageText({
  role,
  text,
}: {
  role: string;
  text: string;
}) {
  if (role === 'user') {
    return (
      <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  // Assistant: flat text, no bubble — reads like a person, not a bot.
  return (
    <div className="text-foreground max-w-full text-sm leading-relaxed whitespace-pre-wrap">
      {text}
    </div>
  );
});

// ------------------------------------------------------------
// Tool activity step (quiet rail row)
// ------------------------------------------------------------

export const ToolStep = memo(function ToolStep({
  toolName,
  state,
  output,
}: {
  toolName: string;
  state: string;
  output?: unknown;
}) {
  const label = TOOL_LABELS[toolName] ?? toolName;
  const isWrite = WRITE_TOOLS.has(toolName);
  const running =
    state === 'input-streaming' ||
    state === 'input-available' ||
    state === 'approval-responded';
  const denied = state === 'output-denied';
  const done = state === 'output-available';

  // Result link (e.g. create_workflow returns open_url) — surfaces
  // the created artifact as a first-class action, not buried JSON.
  const openUrl =
    done && output && typeof output === 'object' && 'open_url' in output
      ? String((output as { open_url: unknown }).open_url)
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <span
          className={cn(
            'flex size-4.5 shrink-0 items-center justify-center rounded-full border',
            done
              ? 'border-primary/30 bg-primary/10 text-primary'
              : denied
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-muted'
          )}
        >
          {running ? (
            <Loader2 className="size-2.5 animate-spin" aria-hidden />
          ) : done ? (
            <Check className="size-2.5" aria-hidden />
          ) : (
            <Wrench className="size-2.5" aria-hidden />
          )}
        </span>
        <span className="truncate">
          {label}
          {denied
            ? ' — denied'
            : isWrite && running
              ? ' — awaiting approval'
              : running
                ? '…'
                : ''}
        </span>
      </div>
      {openUrl ? (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="ml-6 h-7 w-fit gap-1 rounded-full px-3 text-xs"
        >
          <Link href={openUrl}>
            Open workflow
            <ArrowUpRight className="size-3" aria-hidden />
          </Link>
        </Button>
      ) : null}
    </div>
  );
});

// ------------------------------------------------------------
// Approval card for write tools
// ------------------------------------------------------------

/** Render tool input as readable field rows; long/nested values get
 *  compacted so the card stays scannable. */
function summarizeInput(input: unknown): { k: string; v: string }[] {
  if (!input || typeof input !== 'object') return [];
  return Object.entries(input as Record<string, unknown>)
    .slice(0, 8)
    .map(([k, v]) => {
      let text: string;
      if (typeof v === 'string') text = v;
      else if (Array.isArray(v))
        text =
          v.length <= 4 && v.every((x) => typeof x === 'string')
            ? v.join(', ')
            : `${v.length} items`;
      else if (v && typeof v === 'object') text = 'details…';
      else text = String(v);
      if (text.length > 90) text = `${text.slice(0, 90)}…`;
      return { k: k.replaceAll('_', ' '), v: text };
    });
}

export function ApprovalCard({
  toolName,
  input,
  onRespond,
}: {
  toolName: string;
  input: unknown;
  onRespond: (approved: boolean) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const label = TOOL_LABELS[toolName] ?? toolName;
  const rows = summarizeInput(input);

  return (
    <div className="border-border bg-card w-full rounded-xl border shadow-xs">
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <span className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded-md">
          <ShieldCheck className="size-3.5" aria-hidden />
        </span>
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground ml-auto text-[10px] font-medium tracking-wide uppercase">
          Needs approval
        </span>
      </div>

      {rows.length > 0 ? (
        <dl className="mt-2.5 flex flex-col gap-1 px-3.5">
          {rows.map(({ k, v }) => (
            <div key={k} className="flex items-baseline gap-2 text-xs">
              <dt className="text-muted-foreground w-24 shrink-0 truncate capitalize">
                {k}
              </dt>
              <dd className="text-foreground min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {input != null ? (
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-muted-foreground hover:text-foreground mt-1.5 flex items-center gap-1 px-3.5 text-[11px] transition-colors"
        >
          <ChevronDown
            className={cn('size-3 transition-transform', showRaw && 'rotate-180')}
            aria-hidden
          />
          {showRaw ? 'Hide details' : 'Show details'}
        </button>
      ) : null}
      {showRaw ? (
        <pre className="app-scrollbar bg-muted mx-3.5 mt-1.5 max-h-28 overflow-auto rounded-md px-2 py-1.5 text-[11px]">
          {JSON.stringify(input, null, 2)}
        </pre>
      ) : null}

      <div className="border-border mt-3 flex gap-2 border-t px-3.5 py-2.5">
        <Button
          type="button"
          size="sm"
          className="h-7 rounded-full px-3.5 text-xs"
          onClick={() => onRespond(true)}
        >
          <Check data-icon="inline-start" aria-hidden />
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 rounded-full px-3.5 text-xs"
          onClick={() => onRespond(false)}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}

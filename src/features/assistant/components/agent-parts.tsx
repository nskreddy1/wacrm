'use client';

import { memo, useState } from 'react';
import Link from 'next/link';
import { MessageContent } from '@/components/prompt-kit/message';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Loader2,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isWriteTool, toolLabel } from '../lib/tool-catalog';
import { cn } from '@/lib/utils';

// ============================================================
// Reusable agent-UI primitives for the helper widget.
//
// Design language (modern enterprise copilot, following the
// conventions assistant-ui established): assistant text renders
// flat on the panel background, user messages get a compact muted
// bubble aligned right by the parent grid, tool activity is a quiet
// left-rail step list, and write approvals are structured cards with
// a readable field summary instead of raw JSON.
// ============================================================

// Labels and write classification come from the shared tool catalog —
// see `lib/tool-catalog.ts`. They were previously duplicated here and had
// drifted out of sync with the server registry: six tools rendered as raw
// snake_case names, and three approval-gated writes were not recognised as
// writes, so their steps never showed "awaiting approval".
export { TOOL_LABELS, WRITE_TOOLS } from '../lib/tool-catalog';

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
    // A quiet `muted` bubble rather than a saturated brand fill. The
    // user's own words don't need emphasising — right-alignment and
    // shape already distinguish them — and a block of inverted text on a
    // strong accent is the heaviest thing on screen in a panel this
    // narrow. This matches how assistant-ui styles user turns.
    //
    // `markdown` is deliberately off: literal user text should never be
    // reinterpreted as markup, so asterisks and underscores they typed
    // stay visible instead of silently turning into emphasis.
    //
    // Note there is no `Message` flex wrapper: right-alignment is the
    // parent grid's job (see assistant-widget). Nesting a shrink-to-fit
    // flex row around a word-breaking bubble is exactly what collapsed
    // short messages like "hi" to one character per line.
    return (
      <MessageContent
        markdown={false}
        className="bg-muted text-foreground w-fit max-w-full rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap"
      >
        {text}
      </MessageContent>
    );
  }

  // Assistant: flat markdown on the panel background, no bubble — reads
  // like a person, not a bot. prompt-kit's Markdown parses into blocks
  // with marked and memoizes each one, so blocks already rendered don't
  // re-parse on every streamed token.
  return (
    <MessageContent
      markdown
      className="text-foreground max-w-full min-w-0 bg-transparent p-0 text-sm leading-relaxed"
    >
      {text}
    </MessageContent>
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
  const label = toolLabel(toolName);
  const isWrite = isWriteTool(toolName);
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
        // Base UI's Button merges into a child via `render`, so the real
        // Button styles and states apply to an actual Next.js <Link>
        // rather than being re-approximated with hand-written classes.
        // nativeButton={false} acknowledges the element really is an
        // <a>; without it Base UI warns that native button semantics
        // were dropped. Navigation belongs in a link anyway.
        <Button
          size="sm"
          variant="outline"
          className="ml-6 w-fit rounded-full"
          nativeButton={false}
          render={<Link href={openUrl} />}
        >
          Open workflow
          <ArrowUpRight data-icon="inline-end" aria-hidden />
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
  const label = toolLabel(toolName);
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

'use client';

import { useMemo, useState } from 'react';
import {
  CheckCheck,
  ChevronDown,
  Paperclip,
  Search,
  Send,
  Smile,
  Star,
  Timer,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

/**
 * Channel identity. Two accent hues only — everything else in this view is
 * a neutral or the theme primary, which keeps the palette inside budget
 * while still letting a channel be recognised at a glance.
 */
const CHANNEL = {
  whatsapp: { label: 'WhatsApp', dot: 'bg-emerald-500' },
  sms: { label: 'SMS', dot: 'bg-sky-500' },
} as const;

type ChannelId = keyof typeof CHANNEL;

/**
 * Channels the workspace has switched on. In the real implementation this
 * is `channel_connections` filtered to `is_enabled` — the inbox shows a
 * channel only when it is actually activated, so an unconfigured channel
 * never appears as an empty tab.
 */
const ENABLED: ChannelId[] = ['whatsapp', 'sms'];

type Thread = {
  id: string;
  name: string;
  channel: ChannelId;
  preview: string;
  time: string;
  unread: number;
  assignee: string | null;
  /** Hours left in WhatsApp's 24h free-text window; null = not applicable. */
  windowHrs: number | null;
};

const THREADS: Thread[] = [
  {
    id: '1',
    name: 'Priya Nair',
    channel: 'whatsapp',
    preview: 'Perfect — can you ship to the Bangalore office instead?',
    time: '2m',
    unread: 2,
    assignee: null,
    windowHrs: 23,
  },
  {
    id: '2',
    name: 'Daniel Osei',
    channel: 'sms',
    preview: 'Order #4471 confirmed. Thanks for the quick turnaround.',
    time: '18m',
    unread: 0,
    assignee: 'RA',
    windowHrs: null,
  },
  {
    id: '3',
    name: 'Mei Lin',
    channel: 'whatsapp',
    preview: 'Sent the signed PO across — let me know if it came through.',
    time: '1h',
    unread: 1,
    assignee: 'RA',
    windowHrs: 4,
  },
  {
    id: '4',
    name: 'Tomás Rivera',
    channel: 'sms',
    preview: 'Do you still have the 40cm variant in stock?',
    time: '3h',
    unread: 0,
    assignee: null,
    windowHrs: null,
  },
  {
    id: '5',
    name: 'Aisha Bello',
    channel: 'whatsapp',
    preview: 'Thanks! That answers it.',
    time: 'Yesterday',
    unread: 0,
    assignee: 'RA',
    windowHrs: null,
  },
];

const MESSAGES = [
  {
    id: 'm1',
    from: 'them' as const,
    body: 'Hi — I placed order #4482 this morning but used my home address.',
    time: '09:14',
  },
  {
    id: 'm2',
    from: 'us' as const,
    body: 'Morning Priya! I can still change that, it has not shipped yet.',
    time: '09:16',
  },
  {
    id: 'm3',
    from: 'them' as const,
    body: 'Perfect — can you ship to the Bangalore office instead?',
    time: '09:18',
  },
];

export function UnifiedInboxPreview() {
  const [channelFilter, setChannelFilter] = useState<ChannelId | 'all'>('all');
  const [activeId, setActiveId] = useState('1');

  const visible = useMemo(
    () =>
      channelFilter === 'all'
        ? THREADS
        : THREADS.filter((t) => t.channel === channelFilter),
    [channelFilter]
  );

  const active = THREADS.find((t) => t.id === activeId) ?? THREADS[0];

  return (
    <div className="bg-background flex h-dvh flex-col">
      {/* Preview-only banner. Not part of the proposed design. */}
      <div className="border-border bg-muted/40 flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Badge variant="secondary">Design preview</Badge>
        <p className="text-muted-foreground text-xs">
          Static sample data. The live inbox at /inbox is untouched.
        </p>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ── Pane 1: conversation list ─────────────────────────── */}
        <div className="border-border flex w-80 shrink-0 flex-col border-r">
          <div className="flex flex-col gap-3 px-4 pt-4 pb-3">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-semibold tracking-tight">Inbox</h1>
              <Button variant="ghost" size="sm">
                Open
                <ChevronDown data-icon="inline-end" />
              </Button>
            </div>

            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
              <Input placeholder="Search conversations" className="ps-9" />
            </div>

            {/* Channel filter. Renders only enabled channels, so the row
                stays honest about what the workspace can receive. */}
            <div className="flex items-center gap-1">
              <FilterChip
                active={channelFilter === 'all'}
                onClick={() => setChannelFilter('all')}
              >
                All
              </FilterChip>
              {ENABLED.map((id) => (
                <FilterChip
                  key={id}
                  active={channelFilter === id}
                  onClick={() => setChannelFilter(id)}
                >
                  <span className={cn('size-1.5 rounded-full', CHANNEL[id].dot)} />
                  {CHANNEL[id].label}
                </FilterChip>
              ))}
            </div>
          </div>

          <Separator />

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col">
              {visible.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveId(t.id)}
                  className={cn(
                    'hover:bg-muted/60 focus-visible:ring-ring/50 relative flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
                    t.id === activeId && 'bg-muted'
                  )}
                >
                  {/* Active rail — a 2px edge reads as selection without
                      boxing the row in a card. */}
                  {t.id === activeId && (
                    <span className="bg-primary absolute start-0 top-0 h-full w-0.5" />
                  )}
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        CHANNEL[t.channel].dot
                      )}
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-sm font-medium">
                      {t.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {t.time}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ps-3.5">
                    <span
                      className={cn(
                        'flex-1 truncate text-xs',
                        t.unread > 0
                          ? 'text-foreground font-medium'
                          : 'text-muted-foreground'
                      )}
                    >
                      {t.preview}
                    </span>
                    {t.unread > 0 && (
                      <span className="bg-primary text-primary-foreground flex size-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
                        {t.unread}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ps-3.5">
                    <span className="text-muted-foreground text-[11px]">
                      {CHANNEL[t.channel].label}
                    </span>
                    {t.assignee ? (
                      <span className="text-muted-foreground text-[11px]">
                        · {t.assignee}
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-600 dark:text-amber-500">
                        · Unassigned
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* ── Pane 2: thread ────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-border flex shrink-0 items-center gap-3 border-b px-5 py-3">
            <Avatar size="sm">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {active.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{active.name}</p>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    CHANNEL[active.channel].dot
                  )}
                  aria-hidden
                />
                <span className="text-muted-foreground text-xs">
                  {CHANNEL[active.channel].label}
                </span>
              </div>
            </div>

            {/* Service-window countdown. WhatsApp only — outside 24h you
                must switch to an approved template, so the agent needs to
                see the clock before composing, not after a send fails. */}
            {active.windowHrs !== null && (
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Timer className="size-3.5" />
                {active.windowHrs}h left to reply freely
              </div>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Star">
              <Star />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 px-5 py-6">
              {MESSAGES.map((m) => (
                <div
                  key={m.id}
                  // Percentage alone lets bubbles run to an unreadable
                  // line length on wide screens, so cap the measure too.
                  className={cn(
                    'flex max-w-[min(68%,34rem)] flex-col gap-1',
                    m.from === 'us' && 'self-end'
                  )}
                >
                  <div
                    className={cn(
                      'rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                      m.from === 'us'
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted text-foreground rounded-bl-md'
                    )}
                  >
                    {m.body}
                  </div>
                  <div
                    className={cn(
                      'text-muted-foreground flex items-center gap-1 text-[11px]',
                      m.from === 'us' && 'justify-end'
                    )}
                  >
                    {m.time}
                    {m.from === 'us' && <CheckCheck className="size-3" />}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-border shrink-0 border-t p-3">
            <div className="border-input focus-within:ring-ring/40 flex items-end gap-2 rounded-xl border px-3 py-2 focus-within:ring-2">
              <Button variant="ghost" size="icon-sm" aria-label="Attach file">
                <Paperclip />
              </Button>
              <textarea
                rows={1}
                placeholder={`Reply on ${CHANNEL[active.channel].label}…`}
                className="placeholder:text-muted-foreground max-h-32 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none"
              />
              <Button variant="ghost" size="icon-sm" aria-label="Add emoji">
                <Smile />
              </Button>
              <Button size="icon-sm" aria-label="Send message">
                <Send />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Pane 3: contact context ───────────────────────────── */}
        <div className="border-border hidden w-72 shrink-0 flex-col border-s xl:flex">
          <div className="flex flex-col items-center gap-3 px-5 py-6">
            <Avatar className="size-14">
              <AvatarFallback className="bg-primary/10 text-primary text-base font-semibold">
                {active.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col items-center gap-0.5">
              <p className="text-sm font-medium">{active.name}</p>
              <p className="text-muted-foreground text-xs">+91 9845 21 8890</p>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-4 px-5 py-5">
            <Meta label="Lifetime value" value="₹1,84,200" />
            <Meta label="Orders" value="12" />
            <Meta label="Owner" value="Unassigned" muted />
          </div>

          <Separator />

          {/* Cross-channel history is the point of a unified inbox: the
              same person, every channel, one timeline. */}
          <div className="flex flex-col gap-3 px-5 py-5">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Also reached you on
            </p>
            <div className="flex flex-col gap-2">
              <ChannelRow channel="sms" note="2 conversations" />
              <ChannelRow channel="whatsapp" note="Active now" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

function Meta({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span
        className={cn(
          'text-xs font-medium',
          muted && 'text-muted-foreground font-normal'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ChannelRow({
  channel,
  note,
}: {
  channel: ChannelId;
  note: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn('size-1.5 rounded-full', CHANNEL[channel].dot)}
        aria-hidden
      />
      <span className="flex-1 text-xs">{CHANNEL[channel].label}</span>
      <span className="text-muted-foreground text-[11px]">{note}</span>
    </div>
  );
}

'use client';

import { useRef, useState, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import {
  ArrowUp,
  Loader2,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ApprovalCard,
  MessageText,
  ShimmeringText,
  ThinkingSteps,
  type ThinkingStepData,
  toolNameFromPart,
} from './agent-parts';

// ============================================================
// Platform helper agent — floating copilot panel.
//
// Transparency model (user requirement):
//   - Every tool the agent uses renders inline as a quiet step
//     row with live state.
//   - Read tools run without asking. Write tools surface an
//     Approve / Deny card — nothing is written until the user
//     explicitly grants access in the chat.
// ============================================================

/** Quick-start prompts shown on the empty state. */
const SUGGESTIONS: { label: string; icon?: 'workflow' }[] = [
  { label: 'Create a welcome workflow for new contacts', icon: 'workflow' },
  { label: 'Summarize my pipeline' },
  { label: 'How many contacts do I have?' },
  { label: 'What appointments are coming up?' },
];

type RenderItem =
  | { kind: 'text'; key: string; text: string }
  | {
      kind: 'approval';
      key: string;
      toolName: string;
      input: unknown;
      approvalId: string;
    }
  | {
      kind: 'thinking';
      key: string;
      steps: ThinkingStepData[];
      active: boolean;
    };

/** Twenty CRM's transcript shape: contiguous tool activity collapses
 *  into one "thinking steps" group; text parts break groups; approval
 *  cards always stand alone — a pending write must never be hidden
 *  inside a collapsed rail where the user could miss it. */
function groupMessageParts(
  message: { id: string; role: string; parts: unknown[] },
  busy: boolean
): RenderItem[] {
  const items: RenderItem[] = [];

  for (let i = 0; i < message.parts.length; i++) {
    const part = message.parts[i] as Record<string, unknown> & {
      type: string;
    };

    if (part.type === 'text') {
      const text = typeof part.text === 'string' ? part.text : '';
      if (text) items.push({ kind: 'text', key: `${message.id}-${i}`, text });
      continue;
    }

    const toolName = toolNameFromPart(part.type);
    if (!toolName || typeof part.state !== 'string') continue;

    // Pending write approval → standalone card, outside any group.
    const approval = part.approval as
      | { id: string; isAutomatic?: boolean }
      | undefined;
    if (part.state === 'approval-requested' && approval && !approval.isAutomatic) {
      items.push({
        kind: 'approval',
        key: `${message.id}-${i}`,
        toolName,
        input: 'input' in part ? part.input : null,
        approvalId: approval.id,
      });
      continue;
    }

    const step: ThinkingStepData = {
      key: `${message.id}-${i}`,
      toolName,
      state: part.state,
      output: 'output' in part ? part.output : undefined,
    };
    const last = items[items.length - 1];
    if (last?.kind === 'thinking') {
      last.steps.push(step);
    } else {
      items.push({
        kind: 'thinking',
        key: `${message.id}-${i}-group`,
        steps: [step],
        active: false,
      });
    }
  }

  // A thinking group is "live" only when it's the transcript's last item
  // and the agent is still running — then its summary shimmers with the
  // current tool label instead of the step count.
  const lastItem = items[items.length - 1];
  if (busy && lastItem?.kind === 'thinking') lastItem.active = true;

  return items;
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [unconfigured, setUnconfigured] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, addToolApprovalResponse, error } =
    useChat({
      transport: new DefaultChatTransport({ api: '/api/assistant/chat' }),
      sendAutomaticallyWhen:
        lastAssistantMessageIsCompleteWithApprovalResponses,
      onError: (err) => {
        if (err.message.includes('assistant_not_configured')) {
          setUnconfigured(true);
        }
      },
    });

  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, open]);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void sendMessage({ text });
  }

  return (
    <>
      {/* Launcher — hidden while the docked panel is open (the panel
          covers this spot and carries its own close button). */}
      {!open ? (
        <Button
          type="button"
          size="icon"
          aria-label="Open Mira, your CRM copilot"
          onClick={() => setOpen(true)}
          className="fixed right-20 bottom-4 z-40 size-12 rounded-full shadow-lg"
        >
          <Sparkles className="size-5" />
        </Button>
      ) : null}

      {/* Panel — Twenty CRM's "Ask AI" pattern: a full-height rail docked
          to the right edge (not a floating bubble), so long agent sessions
          read like a workspace surface instead of a chat toy. */}
      {open ? (
        <div
          role="dialog"
          aria-label="Mira — CRM copilot chat"
          className="border-border bg-background animate-in slide-in-from-right fixed inset-y-0 right-0 z-50 flex w-[min(420px,100vw)] flex-col overflow-hidden border-l shadow-[-16px_0_48px_-24px_rgba(0,0,0,0.35)] duration-200"
        >
          {/* Title bar */}
          <div className="border-border flex items-center gap-2.5 border-b px-4 py-3">
            <span className="bg-primary/10 relative flex size-8 items-center justify-center rounded-lg">
              <Sparkles className="text-primary size-4" aria-hidden />
              <span
                className="border-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 bg-emerald-500"
                aria-hidden
              />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-sm leading-tight font-semibold">Mira</span>
              <span className="text-muted-foreground text-[11px]">
                Your CRM copilot · writes need your approval
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              className="ml-auto size-7"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Transcript */}
          <div
            ref={scrollRef}
            className="app-scrollbar flex-1 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 ? (
              /* Twenty's empty state: everything gravity-settles to the
                 bottom next to the composer, so the eye lands where typing
                 happens. Suggestions are quiet rows, not bordered cards —
                 they read as actions, not content. */
              <div className="flex h-full flex-col justify-end gap-4 px-1 pb-2">
                <div className="flex flex-col gap-1.5">
                  <h2 className="text-sm font-semibold text-balance">
                    What can I help you with?
                  </h2>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    I can read your whole workspace and build workflows end
                    to end. Anything that changes data asks for your approval
                    first.
                  </p>
                </div>
                <div className="flex flex-col">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => {
                        if (!busy) void sendMessage({ text: s.label });
                      }}
                      className="text-foreground hover:bg-muted/60 -mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[13px] transition-colors"
                    >
                      {s.icon === 'workflow' ? (
                        <Workflow
                          className="text-primary size-3.5 shrink-0"
                          aria-hidden
                        />
                      ) : (
                        <Sparkles
                          className="text-muted-foreground size-3.5 shrink-0"
                          aria-hidden
                        />
                      )}
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex flex-col gap-2.5',
                      message.role === 'user' ? 'items-end' : 'items-start'
                    )}
                  >
                    {groupMessageParts(
                      message,
                      busy &&
                        message.id === messages[messages.length - 1]?.id
                    ).map((item) => {
                      if (item.kind === 'text') {
                        return (
                          <MessageText
                            key={item.key}
                            role={message.role}
                            text={item.text}
                          />
                        );
                      }
                      if (item.kind === 'approval') {
                        return (
                          <ApprovalCard
                            key={item.key}
                            toolName={item.toolName}
                            input={item.input}
                            onRespond={(approved) =>
                              addToolApprovalResponse({
                                id: item.approvalId,
                                approved,
                              })
                            }
                          />
                        );
                      }
                      return (
                        <ThinkingSteps
                          key={item.key}
                          steps={item.steps}
                          active={item.active}
                        />
                      );
                    })}
                  </div>
                ))}
                {busy && messages[messages.length - 1]?.role !== 'assistant' ? (
                  <div className="flex min-h-6 items-center text-xs">
                    <ShimmeringText>Thinking…</ShimmeringText>
                  </div>
                ) : null}
              </div>
            )}

            {unconfigured ? (
              <div className="border-border bg-muted/50 text-muted-foreground mt-3 rounded-lg border p-3 text-xs leading-relaxed">
                The helper agent is not set up yet. A platform admin needs to
                add an API key in the Admin console under Platform settings.
              </div>
            ) : error && !unconfigured ? (
              <div className="border-destructive/30 bg-destructive/10 text-destructive mt-3 rounded-lg border p-3 text-xs leading-relaxed">
                Something went wrong. Please try again.
              </div>
            ) : null}
          </div>

          {/* Composer — Twenty's tall block: the textarea sits on top and
              an action row lives INSIDE the frame at the bottom, so the
              whole rect reads as one input surface. Focus lights up the
              border, matching their blue-ring treatment. */}
          <form
            className="px-3 pt-1 pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="border-border bg-card focus-within:border-primary flex flex-col gap-2 rounded-xl border px-3 pt-2.5 pb-2 transition-colors">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="Ask, search or make anything…"
                aria-label="Message the helper agent"
                rows={2}
                className="text-foreground placeholder:text-muted-foreground max-h-36 min-h-12 flex-1 resize-none bg-transparent text-sm leading-6 outline-none"
                disabled={busy && messages.length === 0}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-[11px]">
                  Enter to send · Shift+Enter for a new line
                </span>
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send"
                  disabled={!input.trim() || busy}
                  className="size-7 shrink-0 rounded-full"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ArrowUp className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

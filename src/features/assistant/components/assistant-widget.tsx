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
  ToolStep,
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
      {/* Launcher */}
      <Button
        type="button"
        size="icon"
        aria-label={open ? 'Close helper agent' : 'Open helper agent'}
        onClick={() => setOpen((v) => !v)}
        className="fixed right-20 bottom-4 z-40 size-12 rounded-full shadow-lg"
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>

      {/* Panel */}
      {open ? (
        <div
          role="dialog"
          aria-label="Helper agent chat"
          className="border-border bg-background fixed right-4 bottom-20 z-50 flex h-[min(600px,calc(100dvh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-[0_24px_64px_-16px_rgba(0,0,0,0.4)]"
        >
          {/* Header */}
          <div className="border-border flex items-center gap-2.5 border-b px-4 py-3">
            <span className="bg-primary/10 relative flex size-8 items-center justify-center rounded-lg">
              <Sparkles className="text-primary size-4" aria-hidden />
              <span
                className="border-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 bg-emerald-500"
                aria-hidden
              />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-sm leading-tight font-semibold">
                Copilot
              </span>
              <span className="text-muted-foreground text-[11px]">
                Reads freely · writes need your approval
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
              <div className="flex h-full flex-col justify-end gap-5 px-1 pb-2">
                <div className="flex flex-col gap-2">
                  <h2 className="text-lg font-semibold text-balance">
                    How can I help?
                  </h2>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    I can read your whole workspace and build workflows for
                    you end to end. Anything that changes data asks for your
                    approval first.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() => {
                        if (!busy) void sendMessage({ text: s.label });
                      }}
                      className="border-border bg-card text-foreground hover:border-primary/40 hover:bg-muted/60 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition-colors"
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
                    {message.parts.map((part, i) => {
                      if (part.type === 'text') {
                        if (!part.text) return null;
                        return (
                          <MessageText
                            key={`${message.id}-${i}`}
                            role={message.role}
                            text={part.text}
                          />
                        );
                      }

                      const toolName = toolNameFromPart(part.type);
                      if (!toolName || !('state' in part)) return null;
                      const key = `${message.id}-${i}`;

                      // Approval card for write tools
                      if (
                        part.state === 'approval-requested' &&
                        'approval' in part &&
                        part.approval &&
                        !part.approval.isAutomatic
                      ) {
                        const approvalId = part.approval.id;
                        return (
                          <ApprovalCard
                            key={key}
                            toolName={toolName}
                            input={'input' in part ? part.input : null}
                            onRespond={(approved) =>
                              addToolApprovalResponse({
                                id: approvalId,
                                approved,
                              })
                            }
                          />
                        );
                      }

                      return (
                        <ToolStep
                          key={key}
                          toolName={toolName}
                          state={part.state}
                          output={'output' in part ? part.output : undefined}
                        />
                      );
                    })}
                  </div>
                ))}
                {busy && messages[messages.length - 1]?.role !== 'assistant' ? (
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                    Thinking…
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

          {/* Composer — pill input with inline send, copilot style */}
          <form
            className="px-3 pt-1 pb-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="border-border bg-card focus-within:border-primary/50 flex items-end gap-1.5 rounded-2xl border px-3 py-2 transition-colors">
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
                placeholder="Ask or build anything…"
                aria-label="Message the helper agent"
                rows={1}
                className="text-foreground placeholder:text-muted-foreground max-h-28 min-h-6 flex-1 resize-none bg-transparent text-sm leading-6 outline-none"
                disabled={busy && messages.length === 0}
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send"
                disabled={!input.trim() || busy}
                className="size-7 shrink-0 rounded-full"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

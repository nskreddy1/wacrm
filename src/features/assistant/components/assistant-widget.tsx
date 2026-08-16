'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import { ArrowUp, Sparkles, Workflow, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from '@/components/prompt-kit/chat-container';
import { TextShimmerLoader } from '@/components/prompt-kit/loader';
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from '@/components/prompt-kit/prompt-input';
import { PromptSuggestion } from '@/components/prompt-kit/prompt-suggestion';
import { ScrollButton } from '@/components/prompt-kit/scroll-button';
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

  // Autoscroll is handled by ChatContainerRoot (prompt-kit wraps
  // use-stick-to-bottom), which pins to the bottom only while the user
  // is already there. The previous scrollTo-on-every-message effect
  // yanked the view down mid-read whenever a token arrived — this
  // sticks during streaming but releases the moment the user scrolls up
  // to re-read something, and ScrollButton offers the way back.

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
        aria-label={open ? 'Close Mira' : 'Open Mira, your CRM copilot'}
        onClick={() => setOpen((v) => !v)}
        className="fixed right-20 bottom-4 z-40 size-12 rounded-full shadow-lg"
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>

      {/* Panel */}
      {open ? (
        <div
          role="dialog"
          aria-label="Mira — CRM copilot chat"
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
          <ChatContainerRoot className="app-scrollbar relative min-h-0 flex-1">
            <ChatContainerContent className="px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col justify-end gap-5 px-1 pb-2">
                <div className="flex flex-col gap-2">
                  <h2 className="text-lg font-semibold text-balance">
                    {"Hi, I'm Mira"}
                  </h2>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    I can read your whole workspace and build workflows for
                    you end to end — from a simple welcome reply to multi-step
                    sequences. Anything that changes data asks for your
                    approval first.
                  </p>
                </div>
                {/* prompt-kit's PromptSuggestion in its plain (non-
                    highlight) form: a real Button, so focus rings,
                    disabled state and the press affordance all come from
                    the project's own button variants rather than being
                    re-approximated on a bare <button>. */}
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <PromptSuggestion
                      key={s.label}
                      variant="outline"
                      size="lg"
                      disabled={busy}
                      onClick={() => {
                        if (!busy) void sendMessage({ text: s.label });
                      }}
                      className="bg-card hover:border-primary/40 hover:bg-muted/60 h-auto w-full justify-start gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-[13px] font-normal whitespace-normal"
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
                    </PromptSuggestion>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      // A two-column grid, not flex + items-end. Flex
                      // alignment makes each child shrink-to-fit, so a
                      // bubble that may break long words collapses to its
                      // one-character min-content width. Here the track
                      // sizing owns the alignment and the content column
                      // keeps a sane width regardless.
                      //
                      // User: an empty gutter of at least 48px absorbs the
                      // slack and the bubble sits right, capped at 85% so
                      // long turns still read as a bubble rather than a
                      // full-width block. Assistant: single full-width
                      // column, flush left.
                      'grid content-start gap-2.5',
                      message.role === 'user'
                        ? 'grid-cols-[minmax(48px,1fr)_auto] justify-items-end [&>*]:col-start-2 [&>*]:max-w-[85%]'
                        : 'grid-cols-1 justify-items-start'
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
                      if (
                        !toolName ||
                        !('state' in part) ||
                        typeof part.state !== 'string'
                      )
                        return null;
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
                {/* prompt-kit's shimmer loader. A sweeping gradient over
                    the word itself reads as "working" without the
                    spinner's implication that a single discrete request
                    is pending — the agent may be several tool calls in.
                    aria-live announces it once to screen readers. */}
                {busy && messages[messages.length - 1]?.role !== 'assistant' ? (
                  <div aria-live="polite" className="text-xs">
                    <TextShimmerLoader text="Thinking" size="sm" />
                  </div>
                ) : null}
              </div>
            )}

              <ChatContainerScrollAnchor />
            </ChatContainerContent>

            {/* Pinned to the bottom of the scroll viewport — near the
                composer rather than floating over the middle of the
                transcript. It reads isAtBottom from use-stick-to-bottom's
                context, so it must stay inside ChatContainerRoot; it
                fades out and goes inert once the user is at the latest
                turn. The wrapper is pointer-events-none so the invisible
                state can't swallow clicks on the message beneath it. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <ScrollButton
                aria-label="Scroll to latest message"
                className="pointer-events-auto size-8 shadow-md"
              />
            </div>
          </ChatContainerRoot>

          {/* Status notices live outside the scroll area: a persistent
              condition ("not configured", "request failed") shouldn't
              scroll out of sight while the user reads back through the
              transcript. */}
          {unconfigured ? (
            <div className="border-border bg-muted/50 text-muted-foreground mx-3 mb-1 rounded-lg border p-3 text-xs leading-relaxed">
              The helper agent is not set up yet. A platform admin needs to add
              an API key in the Admin console under Platform settings.
            </div>
          ) : error ? (
            <div className="border-destructive/30 bg-destructive/10 text-destructive mx-3 mb-1 rounded-lg border p-3 text-xs leading-relaxed">
              Something went wrong. Please try again.
            </div>
          ) : null}

          {/* Composer — prompt-kit PromptInput. It owns the autosizing
              textarea (grows to maxHeight then scrolls), Enter-to-send
              with Shift+Enter for newlines, and click-anywhere-to-focus
              on the whole pill. */}
          <PromptInput
            value={input}
            onValueChange={setInput}
            onSubmit={submit}
            isLoading={busy}
            maxHeight={112}
            className="border-border bg-card focus-within:border-primary/50 mx-3 mt-1 mb-3 rounded-2xl px-3 py-2 shadow-none transition-colors"
          >
            <PromptInputTextarea
              placeholder="Ask or build anything…"
              aria-label="Message the helper agent"
              className="text-foreground placeholder:text-muted-foreground min-h-6 bg-transparent text-sm leading-6"
            />
            <PromptInputActions className="justify-end pt-1">
              <PromptInputAction tooltip="Send message">
                <Button
                  type="button"
                  size="icon-sm"
                  aria-label="Send"
                  disabled={!input.trim() || busy}
                  onClick={submit}
                  className="rounded-full"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>
        </div>
      ) : null}
    </>
  );
}

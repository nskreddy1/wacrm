'use client';

import { useCallback, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import { ArrowUp, History, Sparkles, Workflow, X } from 'lucide-react';
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
import { AssistantHistory } from './assistant-history';
import type { AssistantSessionSummary } from '../lib/sessions';

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

  // History state. `sessionId` is the thread the next turn is recorded
  // into; it's held in a ref as well as state because `submit` needs
  // the freshly-created id synchronously, before a re-render.
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<AssistantSessionSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    addToolApprovalResponse,
    error,
  } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/assistant/chat',
      // Attach the thread id to every outgoing turn so the server knows
      // where to persist it. `prepareSendMessagesRequest` reads the ref
      // at send time — a captured value would be stale for the very
      // first message of a brand-new thread.
      prepareSendMessagesRequest: ({ body, messages: outgoing }) => ({
        body: { ...body, messages: outgoing, sessionId: sessionIdRef.current },
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
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

  /** Point both the ref and the state at a thread. */
  function useSession(id: string | null) {
    sessionIdRef.current = id;
    setSessionId(id);
  }

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/assistant/sessions');
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: AssistantSessionSummary[] };
      setSessions(data.sessions ?? []);
    } catch {
      // History is non-critical; the panel shows an empty list rather
      // than an error state the user can't act on.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  /**
   * Ensure a thread exists before the first turn is sent.
   *
   * Created eagerly (rather than lazily server-side) so the id is known
   * to both sides from turn one, and titled from the opening message so
   * the history list never shows an untitled row.
   */
  async function ensureSession(firstMessage: string): Promise<string | null> {
    if (sessionIdRef.current) return sessionIdRef.current;
    try {
      const res = await fetch('/api/assistant/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ firstMessage }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { session?: AssistantSessionSummary };
      if (!data.session) return null;
      useSession(data.session.id);
      setSessions((prev) => [data.session as AssistantSessionSummary, ...prev]);
      return data.session.id;
    } catch {
      // Fall through unrecorded: failing to create a history row must
      // not block the user from getting an answer.
      return null;
    }
  }

  /** Send, creating the thread first if this is the opening message. */
  async function send(text: string) {
    await ensureSession(text);
    void sendMessage({ text });
  }

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void send(text);
  }

  /** Start a fresh thread: clear the transcript and drop the id. */
  function startNewChat() {
    useSession(null);
    setMessages([]);
    setInput('');
    setShowHistory(false);
  }

  /** Reopen a stored thread, restoring its tool steps along with text. */
  async function openSession(id: string) {
    setShowHistory(false);
    try {
      const res = await fetch(`/api/assistant/sessions/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        session?: { id: string; messages: UIMessage[] };
      };
      if (!data.session) return;
      useSession(data.session.id);
      setMessages(data.session.messages);
    } catch {
      // Leave the current transcript untouched on failure.
    }
  }

  async function removeSession(id: string) {
    // Optimistic: the row disappears immediately, and the request is
    // idempotent server-side so a failure can't strand a phantom row.
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (sessionIdRef.current === id) startNewChat();
    try {
      await fetch(`/api/assistant/sessions/${id}`, { method: 'DELETE' });
    } catch {
      // Ignore — the next refresh reconciles.
    }
  }

  /** Load the list when the drawer opens, so it's never stale. */
  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next) void refreshHistory();
  }

  return (
    <>
      {/* Launcher — a vertical tab on the right edge, not a second
          round button next to team chat's. Two identical floating
          circles at the bottom read as one control pair and give no
          clue which is which; an edge tab is a distinct, labelled
          affordance, and it frees the bottom-right corner for team
          chat alone.

          Hidden while the panel is open: the panel has its own close
          button, so keeping a toggle underneath it is redundant. */}
      {!open ? (
        <button
          type="button"
          aria-label="Open Mira, your CRM copilot"
          onClick={() => setOpen(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring focus-visible:ring-offset-background fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl py-4 pr-1.5 pl-2 shadow-lg transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Sparkles className="size-4 shrink-0" aria-hidden />
          {/* The product name, set with real vertical writing-mode
              rather than stacked letters, so the glyphs stay kerned as
              one word and read cleanly down the right edge. */}
          <span
            className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl]"
            aria-hidden
          >
            Mira
          </span>
        </button>
      ) : null}

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
            {/* One history control, not a separate "new chat" icon
                beside it — "New chat" lives at the top of the drawer
                this opens. aria-expanded ties the button to the state
                it controls. */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={showHistory ? 'Hide chat history' : 'Chat history'}
              aria-expanded={showHistory}
              className={cn('ml-auto size-7', showHistory && 'bg-muted')}
              onClick={toggleHistory}
            >
              <History className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              className="size-7"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Transcript. `relative` also anchors the history drawer,
              which covers this region while open. */}
          <ChatContainerRoot className="app-scrollbar relative min-h-0 flex-1">
            {showHistory ? (
              <AssistantHistory
                sessions={sessions}
                activeSessionId={sessionId}
                loading={historyLoading}
                onSelect={openSession}
                onNewChat={startNewChat}
                onDelete={removeSession}
              />
            ) : null}

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
                        // Through `send`, not sendMessage directly, so a
                        // conversation started from a suggestion is
                        // recorded like any other.
                        if (!busy) void send(s.label);
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

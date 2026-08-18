'use client';

import { useCallback, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import {
  ArrowUp,
  History,
  MessageSquarePlus,
  Sparkles,
  Square,
  Workflow,
  X,
} from 'lucide-react';
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
import { ScrollButton } from '@/components/prompt-kit/scroll-button';
import { PromptSuggestion } from '@/components/prompt-kit/prompt-suggestion';
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

/**
 * Where the open thread id is remembered between panel opens.
 *
 * `sessionStorage`, not `localStorage`, is the whole point: the
 * conversation must survive closing the panel and navigating or
 * reloading the app, and must NOT survive closing the tab. That is
 * exactly sessionStorage's lifetime, so the browser enforces the policy
 * and we don't need an expiry of our own. It is also per-tab, so two
 * tabs are two independent conversations rather than one fighting over
 * shared state.
 */
const ACTIVE_SESSION_KEY = 'mira:active-session';

function rememberSession(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ACTIVE_SESSION_KEY, id);
    else sessionStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch {
    // Private-mode / storage-disabled: the chat still works for as long
    // as the panel stays mounted, it just won't survive a reload.
  }
}

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
  /** Guards the one-time restore so reopening never refetches. */
  const restoredRef = useRef(false);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
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

  // Classified once per render rather than per reference in the JSX.
  const errorNotice = error ? describeError(error) : null;

  // Autoscroll is handled by ChatContainerRoot (prompt-kit wraps
  // use-stick-to-bottom), which pins to the bottom only while the user
  // is already there. The previous scrollTo-on-every-message effect
  // yanked the view down mid-read whenever a token arrived — this
  // sticks during streaming but releases the moment the user scrolls up
  // to re-read something, and ScrollButton offers the way back.

  /**
   * Point the ref, the state and sessionStorage at a thread.
   *
   * Named plainly rather than `useSession` — it is a setter called from
   * event handlers, and a `use` prefix would declare it a hook and make
   * every conditional call a rules-of-hooks violation.
   */
  function setActiveSession(id: string | null) {
    sessionIdRef.current = id;
    setSessionId(id);
    rememberSession(id);
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
   * Send immediately. The thread id is minted locally, not fetched.
   *
   * This used to `await` a POST to /api/assistant/sessions before
   * calling `sendMessage`, which put a whole round trip — auth, two
   * rate-limit checks, an INSERT — in front of the user's own message
   * appearing. Until it resolved the panel was completely inert: no
   * bubble, no loader, no sign the keystroke had registered. On a cold
   * serverless route or a bad connection that dead air is most of the
   * wait people describe, and it happened before a single token was
   * even requested from the model.
   *
   * A v4 uuid is unique without asking anyone, so the client names the
   * thread itself and sends in the same tick. The server creates the row
   * on first save (see `saveAssistantTurn`), which also kills the
   * opposite failure: a session created by the POST whose stream then
   * never started, leaving an empty thread in history.
   */
  function send(text: string) {
    if (!sessionIdRef.current) setActiveSession(crypto.randomUUID());
    void sendMessage({ text });
  }

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    send(text);
  }

  /** Start a fresh thread: clear the transcript and drop the id. */
  function startNewChat() {
    setActiveSession(null);
    setMessages([]);
    setInput('');
    setShowHistory(false);
  }

  /** Reopen a stored thread, restoring its tool steps along with text. */
  async function openSession(id: string) {
    setShowHistory(false);
    try {
      const res = await fetch(`/api/assistant/sessions/${id}`);
      if (!res.ok) {
        // A thread that no longer exists (deleted elsewhere, or aged
        // out by the retention job) must not stay pinned as the active
        // session, or every reopen retries the same dead id.
        if (res.status === 404 && sessionIdRef.current === id) {
          setActiveSession(null);
        }
        return;
      }
      const data = (await res.json()) as {
        session?: { id: string; messages: UIMessage[] };
      };
      if (!data.session) return;
      setActiveSession(data.session.id);
      setMessages(data.session.messages);
    } catch {
      // Leave the current transcript untouched on failure.
    }
  }

  /**
   * Open the panel, restoring the tab's conversation the first time.
   *
   * Restoring lazily on first open — rather than in an effect on mount —
   * keeps the cost with the user who actually wants the copilot: someone
   * who never opens it never pays for the fetch. The transcript comes
   * from the server rather than a second client-side copy, so there is
   * one source of truth for what was said.
   */
  function openPanel() {
    setOpen(true);
    if (restoredRef.current) return;
    restoredRef.current = true;

    // Only restore into an empty panel. If the component stayed mounted
    // (the common case — navigating between pages keeps the layout
    // alive) the live transcript is already the newer one.
    if (messages.length > 0 || sessionIdRef.current) return;

    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(ACTIVE_SESSION_KEY);
    } catch {
      stored = null;
    }
    if (stored) void openSession(stored);
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
          onClick={openPanel}
          // Neutral surface with the brand colour spent only on the
          // icon. A full primary-filled tab competed with every other
          // accent on the page; a card-coloured tab reads as part of the
          // chrome and lets one small mark carry the identity.
          className="bg-card/95 text-foreground border-border hover:bg-muted focus-visible:ring-ring focus-visible:ring-offset-background fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl border border-r-0 py-4 pr-1.5 pl-2 shadow-lg backdrop-blur transition-[background-color,transform] duration-[var(--duration-press)] ease-[var(--ease-out)] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Sparkles className="text-primary size-4 shrink-0" aria-hidden />
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
          className="border-border bg-background mira-panel fixed right-4 bottom-20 z-50 flex h-[min(600px,calc(100dvh-7rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border shadow-[0_24px_64px_-16px_rgba(0,0,0,0.4)]"
        >
          {/* Header — name only. The subtitle used to spell out the
              approval model on every open; that belongs in the moment a
              write is actually proposed, where the approval card already
              says it, not as standing furniture. */}
          <div className="border-border flex items-center gap-2.5 border-b px-4 py-3">
            <span className="bg-primary/10 flex size-7 shrink-0 items-center justify-center rounded-md">
              <Sparkles className="text-primary size-3.5" aria-hidden />
            </span>
            <span className="text-sm leading-none font-semibold tracking-tight">
              Mira
            </span>
            {/* New chat sits in the header, not inside the history
                drawer. Starting a fresh thread is a top-level action —
                burying it one click inside "history" made the common
                case depend on opening a list the user didn't ask for.
                Disabled when the panel is already an unused blank
                thread, so the control can't appear to do nothing. */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="New chat"
              disabled={messages.length === 0 && !sessionId}
              className="ml-auto size-7"
              onClick={startNewChat}
            >
              <MessageSquarePlus className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={showHistory ? 'Hide chat history' : 'Chat history'}
              aria-expanded={showHistory}
              className={cn('size-7', showHistory && 'bg-muted')}
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

          {/* Body. This wrapper — not the scroll container — is what the
              history drawer is positioned against.

              The drawer used to live inside ChatContainerRoot, which is
              itself the `overflow-y-auto` element. An absolutely
              positioned child of a scroll container is laid out against
              its padding box and therefore SCROLLS WITH THE CONTENT, so
              the drawer drifted as the transcript moved and its own
              overflow-y-auto nested a second scrollbar inside the first.
              Hoisting it one level up gives exactly one scroll region on
              screen at a time: the transcript, or the history list. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {showHistory ? (
              <AssistantHistory
                sessions={sessions}
                activeSessionId={sessionId}
                loading={historyLoading}
                onSelect={openSession}
                onDelete={removeSession}
              />
            ) : null}

            <ChatContainerRoot className="app-scrollbar min-h-0 flex-1">
              <ChatContainerContent className="px-4 py-4">
            {messages.length === 0 ? (
              // `justify-end` with no `h-full`: the old h-full forced the
              // empty state to the full scroll height, which produced a
              // scrollbar on a panel that had nothing to scroll. The
              // flex parent already fills the space.
              <div className="flex flex-1 flex-col justify-end gap-4 px-1 pb-1">
                {/* One line, no pitch. The capability list that used to
                    sit here described the product to someone already
                    inside it, and pushed the actionable suggestions
                    below the fold. The suggestions ARE the explanation:
                    they show what Mira does by offering to do it. */}
                <h2 className="text-muted-foreground text-xs font-medium">
                  How can I help?
                </h2>
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
                        if (!busy) send(s.label);
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
                      'flex flex-col gap-2.5',
                      message.role === 'user'
                        ? 'items-end [&>*]:max-w-[85%]'
                        : 'items-start'
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

              {/* Jump to latest. The scroll container deliberately
                  releases its bottom-pin as soon as the user scrolls up
                  mid-stream (so it never yanks the viewport away from
                  something they're reading) — but until now there was
                  nothing to get back with, leaving the user to scroll
                  manually while tokens kept landing off-screen.

                  It has to live inside ChatContainerRoot, because it
                  reads `isAtBottom` from the stick-to-bottom context and
                  hides itself when the view is already at the bottom.

                  That puts an absolutely-positioned box inside the
                  `overflow-y-auto` element — the same shape as the
                  history-drawer trap noted above. It's safe here only
                  because ChatContainerRoot is `position: static`, so the
                  containing block resolves to the `relative` body
                  wrapper and the button pins to the panel instead of
                  scrolling away with the transcript. Adding `relative`
                  to ChatContainerRoot would silently reintroduce that
                  bug. */}
              <ScrollButton
                aria-label="Jump to latest"
                className="absolute bottom-3 left-1/2 size-8 -translate-x-1/2 shadow-md"
              />
            </ChatContainerRoot>
          </div>

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
            // Cause on the first line, the way out on the second. role
            //="alert" because this appears after the user has committed
            // to an action and is waiting on its outcome.
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive mx-3 mb-1 rounded-lg border p-3 text-xs leading-relaxed"
            >
              <span className="font-medium">{errorNotice?.cause}</span>{' '}
              <span className="text-destructive/80">
                {errorNotice?.recovery}
              </span>
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
              {/* One control, two jobs. While a reply streams the send
                  button becomes Stop rather than going disabled.
                  Disabling it was the only option before, which left the
                  user watching a reply they could already tell was wrong
                  with no way to interrupt it — the composer's single
                  affordance was inert for the whole generation.

                  It stays the same button in the same place so the
                  target never moves under the pointer, and reverts the
                  instant streaming ends: a Stop button that outlives the
                  stream is a lie about what's still running. */}
              {busy ? (
                <PromptInputAction tooltip="Stop generating">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="secondary"
                    aria-label="Stop generating"
                    onClick={() => void stop()}
                    className="rounded-full"
                  >
                    {/* Square, not a spinner: this is the action, not a
                        status. The shimmer above already reports that
                        work is in progress. */}
                    <Square className="size-3 fill-current" />
                  </Button>
                </PromptInputAction>
              ) : (
                <PromptInputAction tooltip="Send message">
                  <Button
                    type="button"
                    size="icon-sm"
                    aria-label="Send"
                    disabled={!input.trim()}
                    onClick={submit}
                    className="rounded-full"
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                </PromptInputAction>
              )}
            </PromptInputActions>
          </PromptInput>
        </div>
      ) : null}
    </>
  );
}

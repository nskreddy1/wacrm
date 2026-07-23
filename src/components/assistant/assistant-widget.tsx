'use client'

import { useRef, useState, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai'
import {
  Bot,
  Check,
  ChevronDown,
  Loader2,
  Search,
  SendHorizonal,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// ============================================================
// Platform helper agent — floating widget.
//
// Transparency model (user requirement):
//   - Every tool the agent uses is shown inline in the transcript
//     ("tools used" chips with live state).
//   - Read tools run without asking. Write tools surface an
//     Approve / Deny card — nothing is written until the user
//     explicitly grants access in the chat.
// ============================================================

const TOOL_LABELS: Record<string, string> = {
  search_contacts: 'Searching contacts',
  list_recent_conversations: 'Reading recent conversations',
  list_deals: 'Reading deals',
  list_upcoming_appointments: 'Reading appointments',
  get_ai_agent_status: 'Checking AI agent status',
  create_support_ticket: 'Create a support ticket',
  add_contact_note: 'Add a contact note',
}

const WRITE_TOOLS = new Set(['create_support_ticket', 'add_contact_note'])

function toolNameFromPart(type: string): string | null {
  return type.startsWith('tool-') ? type.slice(5) : null
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [unconfigured, setUnconfigured] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status, addToolApprovalResponse, error } =
    useChat({
      transport: new DefaultChatTransport({ api: '/api/assistant/chat' }),
      sendAutomaticallyWhen:
        lastAssistantMessageIsCompleteWithApprovalResponses,
      onError: (err) => {
        if (err.message.includes('assistant_not_configured')) {
          setUnconfigured(true)
        }
      },
    })

  const busy = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, open])

  function submit() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    void sendMessage({ text })
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
          className="fixed right-4 bottom-20 z-50 flex h-[min(540px,calc(100dvh-7rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Bot className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold leading-tight">
                Helper Agent
              </span>
              <span className="text-xs text-muted-foreground">
                Read access to your workspace - writes need your approval
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Minimize"
              className="ml-auto size-7"
              onClick={() => setOpen(false)}
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>

          {/* Transcript */}
          <div
            ref={scrollRef}
            className="app-scrollbar flex-1 overflow-y-auto px-4 py-3"
          >
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Search className="size-6 text-muted-foreground" aria-hidden />
                <p className="max-w-[26ch] text-sm leading-relaxed text-muted-foreground">
                  Ask me anything about your inbox, contacts, deals,
                  appointments, or how to use the platform.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex flex-col gap-2',
                      message.role === 'user' ? 'items-end' : 'items-start',
                    )}
                  >
                    {message.parts.map((part, i) => {
                      if (part.type === 'text') {
                        if (!part.text) return null
                        return (
                          <div
                            key={`${message.id}-${i}`}
                            className={cn(
                              'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed',
                              message.role === 'user'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted text-foreground',
                            )}
                          >
                            {part.text}
                          </div>
                        )
                      }

                      const toolName = toolNameFromPart(part.type)
                      if (!toolName || !('state' in part)) return null
                      const label = TOOL_LABELS[toolName] ?? toolName
                      const isWrite = WRITE_TOOLS.has(toolName)
                      const key = `${message.id}-${i}`

                      // Approval card for write tools
                      if (
                        part.state === 'approval-requested' &&
                        'approval' in part &&
                        part.approval &&
                        !part.approval.isAutomatic
                      ) {
                        return (
                          <div
                            key={key}
                            className="w-full max-w-[95%] rounded-lg border border-border bg-card p-3 shadow-xs"
                          >
                            <div className="flex items-center gap-2">
                              <Wrench
                                className="size-3.5 text-muted-foreground"
                                aria-hidden
                              />
                              <span className="text-sm font-semibold">
                                {label}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              This is a write action. Allow the agent to
                              proceed?
                            </p>
                            {'input' in part && part.input ? (
                              <pre className="app-scrollbar mt-2 max-h-24 overflow-auto rounded-md bg-muted px-2 py-1.5 text-xs">
                                {JSON.stringify(part.input, null, 2)}
                              </pre>
                            ) : null}
                            <div className="mt-2.5 flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  addToolApprovalResponse({
                                    id: part.approval.id,
                                    approved: true,
                                  })
                                }
                              >
                                <Check data-icon="inline-start" aria-hidden />
                                Allow
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  addToolApprovalResponse({
                                    id: part.approval.id,
                                    approved: false,
                                  })
                                }
                              >
                                Deny
                              </Button>
                            </div>
                          </div>
                        )
                      }

                      // Tool-usage chip (visible for every tool the agent uses)
                      const running =
                        part.state === 'input-streaming' ||
                        part.state === 'input-available' ||
                        part.state === 'approval-responded'
                      const denied = part.state === 'output-denied'
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
                        >
                          {running ? (
                            <Loader2
                              className="size-3 animate-spin"
                              aria-hidden
                            />
                          ) : (
                            <Wrench className="size-3" aria-hidden />
                          )}
                          <span>
                            {label}
                            {denied
                              ? ' - denied'
                              : part.state === 'output-available'
                                ? ' - done'
                                : isWrite && running
                                  ? ' - awaiting approval'
                                  : '...'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ))}
                {busy &&
                messages[messages.length - 1]?.role !== 'assistant' ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                    Thinking...
                  </div>
                ) : null}
              </div>
            )}

            {unconfigured ? (
              <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                The helper agent is not set up yet. A platform admin needs to
                add an API key in the Admin console under Platform settings.
              </div>
            ) : error && !unconfigured ? (
              <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
                Something went wrong. Please try again.
              </div>
            ) : null}
          </div>

          {/* Composer */}
          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Ask the helper agent..."
              aria-label="Message the helper agent"
              disabled={busy && messages.length === 0}
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={!input.trim() || busy}
            >
              <SendHorizonal className="size-4" />
            </Button>
          </form>
        </div>
      ) : null}
    </>
  )
}

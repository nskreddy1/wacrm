"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Hash, SendHorizonal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { useTeamChat, TeamConversation } from "@/hooks/use-team-chat";
import type { PresenceRow, PresenceStatus } from "@/lib/presence";
import { presenceLabel } from "@/lib/presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { cn } from "@/lib/utils";

import { MemberAvatar } from "./member-avatar";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

/** Open thread: header, message list with day separators, composer. */
export function TeamChatConversation({
  conversation,
  chat,
  getPresence,
  getRow,
  now,
}: {
  conversation: TeamConversation;
  chat: ReturnType<typeof useTeamChat>;
  getPresence: (userId: string) => PresenceStatus;
  getRow: (userId: string) => PresenceRow | undefined;
  now: number;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { title, dmUserId } = chat.describeConversation(conversation);

  // Keep the newest message in view as messages stream in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages.length]);

  async function submit() {
    const body = draft.trim();
    if (!body || chat.sending) return;
    setDraft("");
    await chat.sendMessage(body);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to chats"
          onClick={chat.closeConversation}
        >
          <ArrowLeft />
        </Button>
        {conversation.kind === "channel" ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <Hash className="size-4 text-muted-foreground" />
          </span>
        ) : (
          <div className="relative shrink-0">
            <MemberAvatar
              name={title}
              avatarUrl={dmUserId ? chat.memberById.get(dmUserId)?.avatar_url ?? null : null}
              className="size-8"
            />
            {dmUserId && (
              <PresenceDot
                status={getPresence(dmUserId)}
                className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background"
              />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.kind === "channel"
              ? `${conversation.member_ids.length} members`
              : dmUserId
                ? presenceLabel(getPresence(dmUserId), getRow(dmUserId)?.last_seen_at, now)
                : ""}
          </p>
        </div>
      </header>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {chat.loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : chat.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground text-pretty">
            No messages yet. Say hello!
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {chat.messages.map((message, index) => {
              const mine = message.sender_id === chat.myId;
              const sender = chat.memberById.get(message.sender_id);
              const prev = chat.messages[index - 1];
              const newDay =
                !prev ||
                new Date(prev.created_at).toDateString() !==
                  new Date(message.created_at).toDateString();
              const showSender =
                !mine &&
                conversation.kind === "channel" &&
                (!prev || prev.sender_id !== message.sender_id || newDay);
              return (
                <li key={message.id} className="flex flex-col">
                  {newDay && (
                    <div className="my-2 flex items-center gap-2" aria-hidden="true">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-xs text-muted-foreground">
                        {dayFormat.format(new Date(message.created_at))}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  )}
                  {showSender && (
                    <span className="mb-0.5 pl-1 text-xs font-medium text-muted-foreground">
                      {sender?.full_name || sender?.email || "Teammate"}
                    </span>
                  )}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-1.5 text-sm leading-relaxed",
                      mine
                        ? "self-end bg-primary text-primary-foreground"
                        : "self-start bg-muted text-foreground",
                    )}
                  >
                    <p className="break-words whitespace-pre-wrap">{message.body}</p>
                    <p
                      className={cn(
                        "mt-0.5 text-right text-[10px]",
                        mine ? "text-primary-foreground/70" : "text-muted-foreground",
                      )}
                    >
                      {timeFormat.format(new Date(message.created_at))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <footer className="border-t p-2">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={`Message ${title}`}
            aria-label={`Message ${title}`}
            rows={1}
            className="max-h-28 min-h-9 flex-1 resize-none"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={!draft.trim() || chat.sending}
          >
            <SendHorizonal />
          </Button>
        </form>
      </footer>
    </div>
  );
}

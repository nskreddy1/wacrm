"use client";

import { useMemo, useState } from "react";
import { Hash, MessageSquare, Plus, Search, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { useTeamChat } from "@/hooks/use-team-chat";
import { presenceLabel } from "@/lib/presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { cn } from "@/lib/utils";

import { TeamChatConversation } from "./team-chat-conversation";
import { TeamChatCreateChannel } from "./team-chat-create-channel";
import { MemberAvatar } from "./member-avatar";

type Tab = "chats" | "contacts";

/**
 * Floating team-chat launcher + slide-up panel (Bigin/Slack style).
 * Mounted once in the dashboard shell so it's available on every page.
 */
export function TeamChatWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chats");
  const [query, setQuery] = useState("");
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);

  const { user, profile } = useAuth();
  const chat = useTeamChat(open);
  const { getPresence, getRow, now } = usePresence(open);

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chat.conversations;
    return chat.conversations.filter((c) =>
      chat.describeConversation(c).title.toLowerCase().includes(q),
    );
  }, [chat, query]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chat.members;
    return chat.members.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q),
    );
  }, [chat.members, query]);

  const active = chat.activeId
    ? chat.conversations.find((c) => c.id === chat.activeId) ?? null
    : null;

  const myPresence = user ? getPresence(user.id) : "offline";

  return (
    <>
      {/* Launcher */}
      <Button
        type="button"
        size="icon"
        aria-label={open ? "Close team chat" : "Open team chat"}
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 bottom-4 z-40 size-12 rounded-full shadow-lg"
      >
        {open ? <X className="size-5" /> : <MessageSquare className="size-5" />}
        {!open && chat.totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-destructive-foreground">
            {chat.totalUnread > 99 ? "99+" : chat.totalUnread}
          </span>
        )}
      </Button>

      {/* Panel */}
      {open && (
        <section
          aria-label="Team chat"
          className="fixed right-4 bottom-20 z-40 flex h-[min(560px,calc(100dvh-7rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
        >
          {active ? (
            <TeamChatConversation
              conversation={active}
              chat={chat}
              getPresence={getPresence}
              getRow={getRow}
              now={now}
            />
          ) : (
            <>
              {/* Header: me + status */}
              <header className="flex items-center gap-3 border-b px-4 py-3">
                <div className="relative">
                  <MemberAvatar
                    name={profile?.full_name ?? "Me"}
                    avatarUrl={profile?.avatar_url ?? null}
                    className="size-9"
                  />
                  <PresenceDot
                    status={myPresence}
                    className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-background"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{profile?.full_name ?? "Me"}</p>
                  <p className="text-xs text-muted-foreground">
                    {presenceLabel(myPresence, getRow(user?.id ?? "")?.last_seen_at, now)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New channel"
                  onClick={() => setChannelDialogOpen(true)}
                >
                  <Plus />
                </Button>
              </header>

              {/* Search */}
              <div className="border-b px-3 py-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search contacts & chats"
                    className="h-9 pl-8"
                    aria-label="Search contacts and chats"
                  />
                </div>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === "chats" ? (
                  filteredConversations.length === 0 ? (
                    <EmptyState />
                  ) : (
                    <ul className="flex flex-col">
                      {filteredConversations.map((conv) => {
                        const { title, dmUserId } = chat.describeConversation(conv);
                        const unreadCount = chat.unread.get(conv.id) ?? 0;
                        return (
                          <li key={conv.id}>
                            <button
                              type="button"
                              onClick={() => void chat.openConversation(conv.id)}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted"
                            >
                              {conv.kind === "channel" ? (
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                                  <Hash className="size-4 text-muted-foreground" />
                                </span>
                              ) : (
                                <div className="relative shrink-0">
                                  <MemberAvatar
                                    name={title}
                                    avatarUrl={dmUserId ? chat.memberById.get(dmUserId)?.avatar_url ?? null : null}
                                    className="size-9"
                                  />
                                  {dmUserId && (
                                    <PresenceDot
                                      status={getPresence(dmUserId)}
                                      className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background"
                                    />
                                  )}
                                </div>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{title}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {conv.last_message_text ?? "No messages yet"}
                                </span>
                              </span>
                              {unreadCount > 0 && (
                                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
                                  {unreadCount > 99 ? "99+" : unreadCount}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : (
                  <ul className="flex flex-col">
                    {filteredMembers.length === 0 ? (
                      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No teammates found.
                      </p>
                    ) : (
                      filteredMembers.map((member) => (
                        <li key={member.user_id}>
                          <button
                            type="button"
                            onClick={() => void chat.openDm(member.user_id)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted"
                          >
                            <div className="relative shrink-0">
                              <MemberAvatar
                                name={member.full_name || member.email || "?"}
                                avatarUrl={member.avatar_url}
                                className="size-9"
                              />
                              <PresenceDot
                                status={getPresence(member.user_id)}
                                className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background"
                              />
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {member.full_name || member.email}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {presenceLabel(
                                  getPresence(member.user_id),
                                  getRow(member.user_id)?.last_seen_at,
                                  now,
                                )}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>

              {/* Tabs */}
              <nav className="grid grid-cols-2 border-t" aria-label="Chat sections">
                <TabButton
                  label="Chats"
                  icon={<MessageSquare className="size-4" />}
                  selected={tab === "chats"}
                  onClick={() => setTab("chats")}
                />
                <TabButton
                  label="Contacts"
                  icon={<Users className="size-4" />}
                  selected={tab === "contacts"}
                  onClick={() => setTab("contacts")}
                />
              </nav>
            </>
          )}
        </section>
      )}

      <TeamChatCreateChannel
        open={channelDialogOpen}
        onOpenChange={setChannelDialogOpen}
        members={chat.members}
        onCreate={chat.createChannel}
      />
    </>
  );
}

function TabButton({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors",
        selected ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-muted">
        <MessageSquare className="size-7 text-muted-foreground" />
      </span>
      <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
        The conversations you have with people and teams will appear here. Open{" "}
        <em>Contacts</em> to message a teammate.
      </p>
    </div>
  );
}
